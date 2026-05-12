"use client";

import { useReducer, useState } from "react";
import type { FormEvent } from "react";
import { QueryResponse, StreamEvent } from "@/lib/types";

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

type StreamAction =
  | { type: "reset" }
  | { type: "event"; event: StreamEvent };

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


  async function handleSubmitFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsUploading(true)

    const form = event.currentTarget
    const formData = new FormData(form)

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData
      });

      // optional: handle non-2xx
      if (!response.ok) {
        // Try to parse backend error JSON; fallback to null if body is empty or invalid JSON.
        const errorBody = await response.json().catch(() => null);
        console.error("Upload failed:", response.status, errorBody);
      }
      form.reset(); // clears <input type="file"> back to “No file chosen”
      
    } catch {
      // Network failure, server down, or unexpected runtime issue.
      console.error("Network error while uploading file.");

    } finally {
      setIsUploading(false)
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
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6">
      {/* Page heading / intro area */}
      <header className="mb-4 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 backdrop-blur">
        <p className="text-sm text-sky-300">RAG System</p>
        <h1 className="text-xl font-semibold text-slate-50 sm:text-2xl">
          Query your PDF knowledge base
        </h1>
      </header>

      {/* Main content area where error, result, or empty state is shown */}
      <section className="flex-1 space-y-4 rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
        {/* Only render this error box when `error` has a value */}
        {streamState.error ? (
          <section className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100">
            <p>{streamState.error}</p>
          </section>
        ) : null}

        {lastQuestion ? (
          <article className="ml-auto max-w-[95%] rounded-2xl border border-sky-500/40 bg-sky-500/20 p-4 shadow-lg">
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-300">
              You
            </p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-100">
              {lastQuestion}
            </p>
          </article>
        ) : null}

        {/* Finished reply (after the last stream message). Not the same box as the "loading" assistant area. */}
        {streamState.result ? (
          <article className="mr-auto max-w-[95%] rounded-2xl border border-slate-600 bg-slate-800/80 p-4 shadow-lg">
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-300">
              Assistant
            </p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-100">
              {streamState.result.answer}
            </p>

            {/* Render citations only if backend returned at least one chunk */}
            {streamState.result.cited_chunks.length > 0 ? (
              <div className="mt-4 space-y-2">
                <h2 className="text-xs font-semibold text-slate-300">
                  Citations
                </h2>
                <div className="space-y-2">
                  {/* `map` turns each citation object into visible JSX */}
                  {streamState.result.cited_chunks.map((chunk) => (
                    <article
                      key={`${chunk.document_id}-${chunk.citation_index}`}
                      className="rounded-lg border border-slate-600/70 bg-slate-900/50 p-3"
                    >
                      <p className="text-xs font-medium text-sky-300">
                        [{chunk.citation_index}] {chunk.source} (page {chunk.page + 1})
                      </p>
                      <p className="mt-1 text-xs text-slate-300">
                        {chunk.content}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
        ) : !isLoading && !lastQuestion ? (
          <div className="rounded-xl border border-dashed border-slate-600 p-6 text-sm text-slate-300">
            Ask a question about your documents in the chat box below.
          </div>
        ) : null}

        {/* Waiting on the server: show status lines until the first answer characters arrive, then only the growing answer. */}
        {isLoading ? (
          <div className="mr-auto max-w-[95%] rounded-2xl border border-slate-600 bg-slate-800/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
              Assistant
            </p>
            {streamState.streamedAnswer ? (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-100">
                {streamState.streamedAnswer}
              </p>
            ) : (
              <div className="mt-1 space-y-1 text-sm text-slate-400">
                {streamState.progressMessages.map((message, idx) => (
                  <p key={`${message}-${idx}`}>{message}</p>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>
      

      {/* File Upload Form */}
      <form 
        onSubmit={handleSubmitFile}
        className="sticky bottom-0 mt-4 rounded-2xl border border-slate-700/60 bg-slate-900/85 p-3 backdrop-blur"
      >
        <label htmlFor="upload-file-input" className="sr-only">
          Choose a file to upload
        </label>
        <div className="flex items-center gap-2">
          <input
            id="upload-file-input"
            name="file"
            type="file"
            required
            className="min-h-11 flex-1 cursor-pointer rounded-xl border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30"
          />
          <button 
            type="submit"
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-sky-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isUploading}
          >
            {isUploading ? "Uploading..." : "Upload File"}
          </button>
        </div>
      </form>

      {/* Input form: this is a "controlled input" because value comes from state */}
      {/* Typing triggers `setInput`; submit triggers `handleSubmit` with an event. */}
      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        className="sticky bottom-0 mt-4 rounded-2xl border border-slate-700/60 bg-slate-900/85 p-3 backdrop-blur"
      >
        <label htmlFor="question-input" className="sr-only">
          Ask a question
        </label>
        <div className="flex items-center gap-2">
          <input
            id="question-input"
            name="question-input"
            type="text"
            autoComplete="off"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about your documents..."
            className="min-h-11 flex-1 rounded-xl border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30"
          />
          <button
            type="submit"
            disabled={isLoading || input.trim().length === 0}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-sky-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </main>
  );
}
