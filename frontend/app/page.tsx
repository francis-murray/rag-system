"use client";

import { useEffect, useReducer, useState } from "react";
import type { FormEvent } from "react";
import { DocumentItem, DocumentsResponse, QueryResponse, StreamEvent } from "@/lib/types";
import { FileExplorerPanel } from "@/components/FileExplorerPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { DocumentViewer } from "@/components/DocumentViewer";
  
const INITIAL_LOADING_MESSAGE = "Starting retrieval pipeline...";

// Everything the UI needs while the answer streams in: status lines, growing text, final result, errors.
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

// Turns one server event into the next screen state. Only read `state` / `action` and return a new object
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

  // Start from the old state, then record this line's id + sequence. The branches below add type-specific fields.
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
    // Another piece of the assistant reply—glue it onto what we already showed while waiting.
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
  // `useState` creates values that React remembers between renders.
  const [input, setInput] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  // `streamState` holds streaming UI data; `dispatchStream` applies each parsed line from the server.
  const [streamState, dispatchStream] = useReducer(streamReducer, INITIAL_STREAM_STATE);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<DocumentItem[]>([]);

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

      // optional: handle non-2xx
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        console.error("Upload failed:", response.status, errorBody);
        return;
      }

      form.reset(); // clears <input type="file"> back to “No file chosen”
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
        // Pretend the server sent a `failed` event
        dispatchStream({
          type: "event",
          event: {
            type: "failed",
            stream_version: 1,
            request_id: "local",
            sequence: Number.MAX_SAFE_INTEGER,
            timestamp_ms: Date.now(),
            code: "internal_error",
            message: getErrorMessage(data),
          },
        });
        return;
      }

      if (!response.body) {
        // Same fake `failed` event as above
        dispatchStream({
          type: "event",
          event: {
            type: "failed",
            stream_version: 1,
            request_id: "local",
            sequence: Number.MAX_SAFE_INTEGER,
            timestamp_ms: Date.now(),
            code: "internal_error",
            message: "No response stream was returned.",
          },
        });
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
      dispatchStream({
        type: "event",
        event: {
          type: "failed",
          stream_version: 1,
          request_id: "local",
          sequence: Number.MAX_SAFE_INTEGER,
          timestamp_ms: Date.now(),
          code: "internal_error",
          message: "Could not reach the server. Please try again.",
        },
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="mx-auto grid h-[100dvh] w-full max-w-none gap-4 overflow-hidden px-2 py-4 sm:px-3 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.6fr)_minmax(220px,0.8fr)] lg:grid-rows-[auto_1fr]">
      {/* Page heading spans the full app width. */}
      <header className="flex items-center rounded-2xl border border-slate-700/60 bg-slate-900/70 px-4 py-1.5 backdrop-blur lg:col-span-3">
        <p className="text-xs font-medium uppercase tracking-wide text-sky-300">RAG System</p>
      </header>

      {/* Left column: uploaded document list + upload form. */}
      <FileExplorerPanel
        documents={files}
        isUploading={isUploading}
        onUploadSubmit={handleSubmitFile}
      />

      {/* Middle column: document preview panel. */}
      <section className="min-h-0 min-w-0 rounded-2xl border border-slate-700/60 bg-slate-900/50 p-4">
        <DocumentViewer />
      </section>

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
