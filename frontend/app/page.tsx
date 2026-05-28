"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { DocumentItem, DocumentsResponse, QueryResponse, StreamEvent } from "@/lib/types";
import { FileExplorerPanel } from "@/components/FileExplorerPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { DocumentViewer } from "@/components/DocumentViewer";
  
const INITIAL_LOADING_MESSAGE = "Starting retrieval pipeline...";

// Desktop layout: fixed side panels, a bounded flexible viewer, and narrow drag gutters.
const HANDLE_WIDTH = 10;
const MIN_LEFT_WIDTH = 220;
const MIN_RIGHT_WIDTH = 220;
const MIN_CENTER_WIDTH = 260;
const DEFAULT_LEFT_WIDTH = 320;
const DEFAULT_RIGHT_WIDTH = 320;

type ResizeSide = "left" | "right";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

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

// Keep enough room for the opposite side panel, both gutters, and the viewer's minimum width.
function getMaxSideWidth(
  contentWidth: number,
  columnGap: number,
  oppositeSideWidth: number
): number {
  return (
    contentWidth -
    oppositeSideWidth -
    HANDLE_WIDTH * 2 -
    MIN_CENTER_WIDTH -
    columnGap * 4
  );
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
  const [files, setFiles] = useState<DocumentItem[]>([]);
  // Resizable 3-column layout on desktop (explorer | viewer | chat); widths reset on refresh.
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const mainRef = useRef<HTMLElement | null>(null);

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

  // Desktop drag gutters resize the fixed side panels while preserving the viewer minimum.
  function startResize(side: ResizeSide, event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const onMove = (moveEvent: MouseEvent) => {
      const main = mainRef.current;
      if (!main) return;

      const bounds = getGridBounds(main);

      if (side === "left") {
        const maxLeftWidth = getMaxSideWidth(
          bounds.contentWidth,
          bounds.columnGap,
          rightWidth
        );
        const nextWidth = moveEvent.clientX - bounds.left;
        setLeftWidth(
          clamp(nextWidth, MIN_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, maxLeftWidth))
        );
        return;
      }

      const maxRightWidth = getMaxSideWidth(
        bounds.contentWidth,
        bounds.columnGap,
        leftWidth
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

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        console.error("Upload failed:", response.status, errorBody);
        return;
      }

      // Resetting the form clears the file input after a successful upload.
      form.reset();
      setFiles(await fetchFiles());
    } catch {
      // Network failure, server down, or unexpected runtime issue.
      console.error("Network error while uploading file.");
    } finally {
      setIsUploading(false);
    }
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

  // explorer | gutter | bounded viewer | gutter | chat
  const desktopColumns = `${leftWidth}px ${HANDLE_WIDTH}px minmax(${MIN_CENTER_WIDTH}px, 1fr) ${HANDLE_WIDTH}px ${rightWidth}px`;
  const layoutStyle = {
    "--desktop-columns": desktopColumns,
  } as CSSProperties;

  return (
    <main
      ref={mainRef}
      className="mx-auto grid h-[100dvh] w-full max-w-none gap-4 overflow-hidden px-2 py-4 sm:px-3 lg:grid-cols-[var(--desktop-columns)] lg:grid-rows-[auto_1fr]"
      style={layoutStyle}
    >
      {/* Header spans all grid columns on desktop (five tracks including gutters). */}
      <header
        className="rounded-2xl border border-slate-700/60 bg-slate-900/70 px-4 py-1.5 backdrop-blur lg:col-span-5"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-sky-300">RAG System</p>
      </header>

      {/* Left column: uploaded document list + upload form. */}
      <FileExplorerPanel
        documents={files}
        isUploading={isUploading}
        onUploadSubmit={handleSubmitFile}
      />

      <div
        role="separator"
        aria-label="Resize file explorer"
        onMouseDown={(event) => startResize("left", event)}
        className="hidden min-h-0 rounded-md bg-slate-700/60 transition hover:bg-slate-500 lg:block lg:cursor-col-resize"
      />

      {/* Middle column: document preview panel. */}
      <section className="min-h-0 min-w-0 rounded-2xl border border-slate-700/60 bg-slate-900/50 p-4">
        <DocumentViewer />
      </section>

      <div
        role="separator"
        aria-label="Resize chat panel"
        onMouseDown={(event) => startResize("right", event)}
        className="hidden min-h-0 rounded-md bg-slate-700/60 transition hover:bg-slate-500 lg:block lg:cursor-col-resize"
      />

      {/* Right column: chat conversation and message composer. */}
      <ChatPanel
        title="Assistant chat"
        error={streamState.error}
        lastQuestion={lastQuestion}
        result={streamState.result}
        isLoading={isLoading}
        streamedAnswer={streamState.streamedAnswer}
        progressMessages={streamState.progressMessages}
        input={input}
        onInputChange={setInput}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
