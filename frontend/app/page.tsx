"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { CitationTarget, CitedChunk, DocumentItem, DocumentsResponse, LlmUsage, QueryResponse, StreamEvent, UploadResponse, UploadStreamEvent } from "@/lib/types";
import { FileExplorerPanel } from "@/components/FileExplorerPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { DocumentViewer } from "@/components/DocumentViewer";
import { ThemeToggle } from "@/components/ThemeToggle";

const INITIAL_LOADING_MESSAGE = "Starting retrieval pipeline...";

// Desktop layout: resizable explorer, preview, and chat columns with drag gutters.
const HANDLE_WIDTH = 4;
const MIN_LEFT_WIDTH = 220;
const MIN_RIGHT_WIDTH = 220;
const MIN_CENTER_WIDTH = 260;
const DEFAULT_LEFT_WIDTH = 272;
const LAPTOP_RIGHT_WIDTH = 420;
const WIDE_RIGHT_WIDTH = 560;
const WIDE_VIEWPORT_MIN = 1536;
const DEFAULT_WIDE_CENTER_WIDTH = 760;
// Approximate main horizontal padding and column gaps for wide-layout presets.
const LAYOUT_HORIZONTAL_OVERHEAD = 48;

/** Remaining width for the center panel after side panels, gutters, and grid gaps. */
function getAvailableCenterWidth(
  contentWidth: number,
  columnGap: number,
  leftWidth: number,
  rightWidth: number,
): number {
  return contentWidth - leftWidth - rightWidth - HANDLE_WIDTH * 2 - columnGap * 4;
}

type ResizeSide = "left" | "right";
type ThemeMode = "dark" | "light";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Grid content box and column gap for drag-resize math on the main layout element. */
function getGridBounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const paddingLeft = parseFloat(style.paddingLeft);
  const paddingRight = parseFloat(style.paddingRight);
  const columnGap = parseFloat(style.columnGap) || 0;

  return {
    left: rect.left + paddingLeft,
    right: rect.right - paddingRight,
    contentWidth: element.clientWidth - paddingLeft - paddingRight,
    columnGap,
  };
}

// Keep enough room for the opposite side panel, both gutters, and the center panel minimum width.
function getMaxSideWidth(
  contentWidth: number,
  columnGap: number,
  oppositeSideWidth: number,
  centerReserve: number
): number {
  return (
    contentWidth -
    oppositeSideWidth -
    HANDLE_WIDTH * 2 -
    centerReserve -
    columnGap * 4
  );
}

/** Initial center and chat widths for viewports at or above `WIDE_VIEWPORT_MIN`. */
function getWideLayoutWidths(viewportWidth: number) {
  const available =
    viewportWidth - DEFAULT_LEFT_WIDTH - HANDLE_WIDTH * 2 - LAYOUT_HORIZONTAL_OVERHEAD;
  const maxCenterWidth = Math.max(MIN_CENTER_WIDTH, available - MIN_RIGHT_WIDTH);
  const centerWidth = clamp(
    Math.min(DEFAULT_WIDE_CENTER_WIDTH, available - WIDE_RIGHT_WIDTH),
    MIN_CENTER_WIDTH,
    maxCenterWidth,
  );
  const rightWidth = available - centerWidth;
  return { centerWidth, rightWidth };
}

/** Picks laptop vs wide layout mode and the matching initial panel widths. */
function getResponsiveLayout(viewportWidth: number) {
  const isWide = viewportWidth >= WIDE_VIEWPORT_MIN;
  if (!isWide) {
    return { isWide, rightWidth: LAPTOP_RIGHT_WIDTH, centerWidth: null as number | null };
  }
  const { centerWidth, rightWidth } = getWideLayoutWidths(viewportWidth);
  return { isWide, rightWidth, centerWidth };
}

// Everything the UI needs while an answer streams in.
// The server sends one small JSON object per line; shapes are defined in @/lib/types.
type StreamState = {
  requestId: string | null;
  lastSequence: number;
  progressMessages: string[];
  streamedAnswer: string;
  result: QueryResponse | null;
  error: string;
  timingsMs: Record<string, number> | null;
  usage: LlmUsage | null;
};

type StreamAction = { type: "reset" } | { type: "event"; event: StreamEvent };

const INITIAL_STREAM_STATE: StreamState = {
  requestId: null,
  lastSequence: 0,
  progressMessages: [INITIAL_LOADING_MESSAGE],
  streamedAnswer: "",
  result: null,
  error: "",
  timingsMs: null,
  usage: null,
};

// Applies one NDJSON stream event to the visible chat state.
function streamReducer(state: StreamState, action: StreamAction): StreamState {
  if (action.type === "reset") {
    return INITIAL_STREAM_STATE;
  }

  const event = action.event;
  // Update the version number in the types and server together when the format changes.
  if (event.stream_version !== 1) {
    return { ...state, error: "Unsupported stream version." };
  }

  // If we already know which question this stream belongs to, ignore lines tagged with a different id
  // (can happen if two requests overlap or a stray chunk arrives late).
  if (state.requestId !== null && event.request_id !== state.requestId) {
    return state;
  }

  // Each line has a rising `sequence` number; skip repeats or anything that arrived out of order.
  if (event.sequence <= state.lastSequence) {
    return state;
  }

  // Record the accepted event first; each branch below adds type-specific fields.
  const nextState = {
    ...state,
    requestId: event.request_id,
    lastSequence: event.sequence,
  };

  if (event.type === "start") {
    return nextState;
  }

  if (event.type === "progress") {
    if (nextState.progressMessages[nextState.progressMessages.length - 1] === event.message) {
      return nextState;
    }
    return {
      ...nextState,
      progressMessages: [...nextState.progressMessages, event.message],
    };
  }

  if (event.type === "delta") {
    if (!event.delta) {
      return nextState;
    }
    // Append the next streamed answer fragment.
    return {
      ...nextState,
      streamedAnswer: `${nextState.streamedAnswer}${event.delta}`,
    };
  }

  if (event.type === "complete") {
    // Server is done: here is the final answer, sources to cite, and optional timing map for the footer.
    return {
      ...nextState,
      result: event.data,
      streamedAnswer: event.data.answer,
      timingsMs: event.timings_ms,
      usage: event.usage ?? event.data.usage ?? null,
    };
  }

  if (event.type === "failed") {
    // Hard stop: show the message in the red error box.
    return {
      ...nextState,
      error: event.message,
    };
  }

  return nextState;
}

// Normalize known backend error shapes into a user-facing message.
function getErrorMessage(data: unknown): string {
  if (typeof data === "object" && data !== null && "detail" in data) {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return "Request failed.";
}

export default function Home() {
  const [input, setInput] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  // `streamState` holds streaming UI data; `dispatchStream` applies each parsed line from the server.
  const [streamState, dispatchStream] = useReducer(streamReducer, INITIAL_STREAM_STATE);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressMessages, setUploadProgressMessages] = useState<string[]>([]);
  const [files, setFiles] = useState<DocumentItem[]>([]);
  // Resizable 3-column layout on desktop (explorer | preview | chat); widths reset on refresh.
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(LAPTOP_RIGHT_WIDTH);
  const [wideCenterWidth, setWideCenterWidth] = useState<number | null>(null);
  const [isWideLayout, setIsWideLayout] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  // Set when a citation card is clicked; PdfCanvas scrolls to chunk.page.
  const [citationTarget, setCitationTarget] = useState<CitationTarget | null>(null);
  // Updated on each explorer click so the viewer resets to page 1,
  // even when the same document is selected again.
  const [viewerResetNonce, setViewerResetNonce] = useState(0);
  const [theme, setTheme] = useState<ThemeMode>("dark");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("ui-theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("ui-theme", theme);
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(theme);
  }, [theme]);

  // Widen chat on large displays with a sensible default split; keep laptop defaults on smaller viewports.
  useEffect(() => {
    let wasWide = window.innerWidth >= WIDE_VIEWPORT_MIN;

    function applyLayoutPreset() {
      const { isWide, rightWidth: presetRightWidth, centerWidth } = getResponsiveLayout(
        window.innerWidth
      );
      setIsWideLayout(isWide);
      setWideCenterWidth(centerWidth);
      setRightWidth(presetRightWidth);
    }

    applyLayoutPreset();

    function onResize() {
      const isWide = window.innerWidth >= WIDE_VIEWPORT_MIN;
      if (isWide === wasWide) return;
      wasWide = isWide;
      applyLayoutPreset();
    }

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /**
   * Fetches the current list of uploaded documents from the backend.
   *
   * @param signal Optional AbortSignal used to cancel the request if the component unmounts.
   * @returns A promise resolving to an array of document metadata items.
   * @throws Error if the backend returns a non-2xx response.
   */
  async function fetchFiles(signal?: AbortSignal): Promise<DocumentItem[]> {
    const response = await fetch("/api/documents", {
      method: "GET",
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(
        `Getting files failed: ${response.status} ${JSON.stringify(errorBody)}`
      );
    }

    const data: DocumentsResponse = await response.json();
    return data.documents;
  }

  /**
   * Loads the current document list when the component mounts.
   *
   * Uses AbortController to cancel the in-flight request if the component
   * unmounts before the fetch completes, preventing unnecessary work.
   */
  useEffect(() => {
    const controller = new AbortController();

    void fetchFiles(controller.signal)
      .then(setFiles)
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error(err);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  /** Pushes a synthetic `failed` event for client-side request/stream failures. */
  function dispatchLocalFailure(message: string) {
    dispatchStream({
      type: "event",
      event: {
        type: "failed",
        stream_version: 1,
        request_id: "local",
        sequence: Number.MAX_SAFE_INTEGER,
        timestamp_ms: Date.now(),
        code: "internal_error",
        message,
      },
    });
  }

  // Desktop drag gutters resize columns while preserving each panel's minimum width.
  function startResize(side: ResizeSide, event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const onMove = (moveEvent: MouseEvent) => {
      const main = mainRef.current;
      if (!main) return;

      const bounds = getGridBounds(main);

      if (side === "left") {
        if (isWideLayout) {
          const maxLeftWidth =
            bounds.contentWidth -
            rightWidth -
            HANDLE_WIDTH * 2 -
            MIN_CENTER_WIDTH -
            bounds.columnGap * 4;
          const nextLeftWidth = clamp(
            moveEvent.clientX - bounds.left,
            MIN_LEFT_WIDTH,
            Math.max(MIN_LEFT_WIDTH, maxLeftWidth),
          );
          const nextCenterWidth = Math.max(
            MIN_CENTER_WIDTH,
            getAvailableCenterWidth(
              bounds.contentWidth,
              bounds.columnGap,
              nextLeftWidth,
              rightWidth,
            ),
          );
          setLeftWidth(nextLeftWidth);
          setWideCenterWidth(nextCenterWidth);
          return;
        }

        const maxLeftWidth = getMaxSideWidth(
          bounds.contentWidth,
          bounds.columnGap,
          rightWidth,
          MIN_CENTER_WIDTH
        );
        const nextWidth = moveEvent.clientX - bounds.left;
        setLeftWidth(
          clamp(nextWidth, MIN_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, maxLeftWidth))
        );
        return;
      }

      if (isWideLayout) {
        const maxCenterWidth = Math.max(
          MIN_CENTER_WIDTH,
          getAvailableCenterWidth(
            bounds.contentWidth,
            bounds.columnGap,
            leftWidth,
            MIN_RIGHT_WIDTH,
          ),
        );
        const nextCenterWidth = clamp(
          moveEvent.clientX -
            bounds.left -
            leftWidth -
            HANDLE_WIDTH -
            bounds.columnGap * 2,
          MIN_CENTER_WIDTH,
          maxCenterWidth,
        );
        const nextRightWidth =
          bounds.contentWidth -
          leftWidth -
          nextCenterWidth -
          HANDLE_WIDTH * 2 -
          bounds.columnGap * 4;
        setWideCenterWidth(nextCenterWidth);
        setRightWidth(nextRightWidth);
        return;
      }

      const maxRightWidth = getMaxSideWidth(
        bounds.contentWidth,
        bounds.columnGap,
        leftWidth,
        MIN_CENTER_WIDTH
      );
      const nextWidth = bounds.right - moveEvent.clientX;
      setRightWidth(
        clamp(nextWidth, MIN_RIGHT_WIDTH, Math.max(MIN_RIGHT_WIDTH, maxRightWidth))
      );
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function handleSubmitFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsUploading(true);
    setUploadProgressMessages([]);

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch("/api/upload/stream", {
        method: "POST",
        body: formData,
      });

      if (!response.ok || !response.body) {
        const errorBody = await response.json().catch(() => null);
        console.error("Upload failed:", response.status, errorBody);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Read NDJSON chunks from the upload stream and update UI per event.
      while (true) {
        // Pause here until the server sends the next chunk (or closes the stream).
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        // One chunk can contain several NDJSON lines; handle each event in order.
        for (const line of lines) {
          if (!line.trim()) continue;
          const uploadEvent = JSON.parse(line) as UploadStreamEvent;

          if (uploadEvent.type === "progress") {
            setUploadProgressMessages((prev) => {
              if (prev[prev.length - 1] === uploadEvent.message) return prev;
              return [...prev, uploadEvent.message];
            });
          } else if (uploadEvent.type === "complete") {
            setUploadProgressMessages((prev) => [...prev, "All set — this document is searchable."]);
            form.reset();
            setFiles(await fetchFiles());
            handleSelectDocument(uploadEvent.document_id);
          } else if (uploadEvent.type === "failed") {
            setUploadProgressMessages((prev) => [...prev, `Error: ${uploadEvent.message}`]);
          }
        }
      }
    } catch {
      // Network failure, server down, or unexpected runtime issue.
      console.error("Network error while uploading file.");
    } finally {
      setIsUploading(false);
      // Leave the full upload progress log on screen briefly, then clear it.
      setTimeout(() => setUploadProgressMessages([]), 5000);
    }
  }

  function handleCitationClick(chunk: CitedChunk) {
    setSelectedDocumentId(chunk.document_id);
    // nonce changes every click so PdfCanvas re-scrolls even to the same page.
    setCitationTarget({ chunk, nonce: Date.now() });
  }

  // Explorer selection: open the doc at page 1, not wherever a citation left off.
  function handleSelectDocument(documentId: string) {
    setSelectedDocumentId(documentId);
    setCitationTarget(null); // prevent a stale citation from re-scrolling
    setViewerResetNonce(Date.now()); // new value triggers scroll-to-top in PdfCanvas
  }

  // Runs when the user submits the form.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Prevent the browser's default full-page form submit.
    event.preventDefault();

    const trimmedQuestion = input.trim();
    if (!trimmedQuestion) return;

    // Clear textbox immediately after submit starts.
    setInput("");

    // Reset prior response/error before making a new request.
    dispatchStream({ type: "reset" });
    setIsLoading(true);
    setLastQuestion(trimmedQuestion);

    try {
      // Response body arrives in chunks; each *complete line* is one JSON message (newline-separated).
      const response = await fetch("/api/query/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmedQuestion }),
      });

      // Non-2xx responses go to the error box instead of result UI.
      if (!response.ok) {
        const data = await response.json();
        dispatchLocalFailure(getErrorMessage(data));
        return;
      }

      if (!response.body) {
        dispatchLocalFailure("No response stream was returned.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      // Bytes may split in the middle of a line—keep leftovers here until we see a full newline.
      let buffer = "";

      // Read the download in pieces; each piece can contain zero, one, or many full JSON lines.
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Flush any remaining decoded bytes after stream completion.
          buffer += decoder.decode();
          break;
        }

        // Decode bytes into text, append to buffer, then split by NDJSON newlines.
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep only the last (possibly incomplete) line for the next iteration.
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          dispatchStream({ type: "event", event });
        }
      }

      // Parse one trailing event if stream ended without a final newline.
      if (buffer.trim()) {
        const event = JSON.parse(buffer) as StreamEvent;
        dispatchStream({ type: "event", event });
      }
    } catch {
      // Network failure, server down, or unexpected runtime issue.
      dispatchLocalFailure("Could not reach the server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  // explorer | gutter | preview | gutter | chat
  const centerTrack =
    isWideLayout && wideCenterWidth !== null
      ? `minmax(${MIN_CENTER_WIDTH}px, ${wideCenterWidth}px)`
      : `minmax(${MIN_CENTER_WIDTH}px, 1fr)`;
  const desktopColumns = `${leftWidth}px ${HANDLE_WIDTH}px ${centerTrack} ${HANDLE_WIDTH}px ${rightWidth}px`;
  const layoutStyle = {
    "--desktop-columns": desktopColumns,
  } as CSSProperties;
  const isDark = theme === "dark";

  return (
    <main
      ref={mainRef}
      className={`mx-auto grid h-[100dvh] min-w-0 max-w-full grid-cols-1 gap-2 overflow-x-hidden px-2 pb-2 pt-2 sm:px-3 lg:grid-cols-[var(--desktop-columns)] lg:grid-rows-[auto_1fr] lg:gap-x-1 lg:gap-y-1 lg:overflow-hidden ${
        isDark
          ? "bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_45%),linear-gradient(to_bottom,_rgba(15,23,42,0.98),_rgba(2,6,23,0.98))]"
          : "bg-slate-100"
      }`}
      style={layoutStyle}
    >
      {/* Header spans all grid columns on desktop (five tracks including gutters). */}
      <header
        className={`min-w-0 rounded-2xl border px-4 py-2.5 lg:col-span-5 ${
          isDark
            ? "border-sky-400/20 bg-slate-900/65 shadow-[0_10px_30px_rgba(2,6,23,0.45)] backdrop-blur-xl"
            : "border-slate-300 bg-white shadow-sm"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <p
            className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${
              isDark ? "text-sky-200/90" : "text-slate-700"
            }`}
          >
            RAG System
          </p>
          <ThemeToggle
            isDark={isDark}
            onToggle={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          />
        </div>
      </header>

      {/* Left column: uploaded document list + upload form. */}
      <FileExplorerPanel
        isDark={isDark}
        documents={files}
        selectedDocumentId={selectedDocumentId}
        onSelectDocument={handleSelectDocument}
        isUploading={isUploading}
        uploadProgressMessages={uploadProgressMessages}
        onUploadSubmit={handleSubmitFile}
      />

      <div
        role="separator"
        aria-label="Resize file explorer"
        onMouseDown={(event) => startResize("left", event)}
        className={`hidden min-h-0 w-1 min-w-1 max-w-1 shrink-0 transition duration-200 ease-out lg:block lg:cursor-col-resize ${
          isDark ? "bg-slate-700 hover:bg-slate-500" : "bg-slate-400 hover:bg-slate-500"
        }`}
      />

      {/* Middle column: document preview panel. */}
      <section className="min-h-0 min-w-0 lg:h-full">
        <DocumentViewer
          isDark={isDark}
          documentId={selectedDocumentId}
          citationTarget={citationTarget}
          resetNonce={viewerResetNonce}
        />
      </section>

      <div
        role="separator"
        aria-label="Resize chat panel"
        onMouseDown={(event) => startResize("right", event)}
        className={`hidden min-h-0 w-1 min-w-1 max-w-1 shrink-0 transition duration-200 ease-out lg:block lg:cursor-col-resize ${
          isDark ? "bg-slate-700 hover:bg-slate-500" : "bg-slate-400 hover:bg-slate-500"
        }`}
      />

      {/* Right column: chat conversation and message composer. */}
      <ChatPanel
        isDark={isDark}
        title="Assistant chat"
        error={streamState.error}
        lastQuestion={lastQuestion}
        result={streamState.result}
        isLoading={isLoading}
        streamedAnswer={streamState.streamedAnswer}
        progressMessages={streamState.progressMessages}
        usage={streamState.usage}
        timingsMs={streamState.timingsMs}
        input={input}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        onCitationClick={handleCitationClick}
      />
    </main>
  );
}
