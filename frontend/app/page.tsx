"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { QueryResponse } from "@/lib/types";

const INITIAL_LOADING_MESSAGE = "Starting retrieval pipeline...";

// Stream event contract produced by backend `/query/stream`.
type StreamStatusEvent = { type: "status"; message: string };
type StreamResultEvent = { type: "result"; data: QueryResponse };
type StreamErrorEvent = { type: "error"; message: string };
type StreamEvent = StreamStatusEvent | StreamResultEvent | StreamErrorEvent;

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
  // `result` starts as null, then becomes backend data after a successful request.
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState<string[]>([
    INITIAL_LOADING_MESSAGE,
  ]);

  // Runs when the user submits the form.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Prevent the browser's default full-page form submit.
    event.preventDefault();

    const trimmedQuestion = input.trim();
    if (!trimmedQuestion) return;

    // Clear textbox immediately after submit starts.
    setInput("");

    // Reset prior response/error before making a new request.
    setError("");
    setResult(null);
    setLoadingMessages([INITIAL_LOADING_MESSAGE]);
    setIsLoading(true);
    setLastQuestion(trimmedQuestion);

    try {
      // Stream live progress events, then parse the final result event.
      const response = await fetch("/api/query/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmedQuestion }),
      });

      // Non-2xx responses go to the error box instead of result UI.
      if (!response.ok) {
        const data = await response.json();
        setError(getErrorMessage(data));
        return;
      }

      if (!response.body) {
        setError("No response stream was returned.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      // Carries partial text between chunks when a JSON line is split mid-chunk.
      let buffer = "";

      // Read chunks incrementally; each chunk may contain 0..N newline-delimited events.
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

          if (event.type === "status") {
            // Append statuses so users can see the full thought pipeline history.
            setLoadingMessages((current) => {
              // Guard against duplicate consecutive events.
              if (current[current.length - 1] === event.message) return current;
              return [...current, event.message];
            });
          } else if (event.type === "result") {
            setResult(event.data);
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }

      // Parse one trailing event if stream ended without a final newline.
      if (buffer.trim()) {
        const event = JSON.parse(buffer) as StreamEvent;
        if (event.type === "status") {
          setLoadingMessages((current) => {
            if (current[current.length - 1] === event.message) return current;
            return [...current, event.message];
          });
        } else if (event.type === "result") {
          setResult(event.data);
        } else if (event.type === "error") {
          setError(event.message);
        }
      }
    } catch {
      // Network failure, server down, or unexpected runtime issue.
      setError("Could not reach the server. Please try again.");
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
        {error ? (
          <section className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100">
            <p>{error}</p>
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

        {/* If we have a result, render it; otherwise show the empty state */}
        {result ? (
          <article className="mr-auto max-w-[95%] rounded-2xl border border-slate-600 bg-slate-800/80 p-4 shadow-lg">
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-300">
              Assistant
            </p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-100">{result.answer}</p>

            {/* Render citations only if backend returned at least one chunk */}
            {result.cited_chunks.length > 0 ? (
              <div className="mt-4 space-y-2">
                <h2 className="text-xs font-semibold text-slate-300">
                  Citations
                </h2>
                <div className="space-y-2">
                  {/* `map` turns each citation object into visible JSX */}
                  {result.cited_chunks.map((chunk) => (
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
            Ask your first question to query the backend `/query` endpoint.
          </div>
        ) : null}

        {/* Loading indicator shown while waiting for backend response */}
        {isLoading ? (
          <div className="mr-auto max-w-[95%] rounded-2xl border border-slate-600 bg-slate-800/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
              Assistant
            </p>
            <div className="mt-1 space-y-1 text-sm text-slate-400">
              {loadingMessages.map((message, idx) => (
                <p key={`${message}-${idx}`}>{message}</p>
              ))}
            </div>
          </div>
        ) : null}
      </section>

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
