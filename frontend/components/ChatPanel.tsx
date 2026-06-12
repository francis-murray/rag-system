"use client";

import type { FormEvent } from "react";
import type { CitedChunk, LlmUsage, QueryResponse } from "@/lib/types";

type ChatPanelProps = {
  title: string;
  error: string;
  lastQuestion: string;
  result: QueryResponse | null;
  isLoading: boolean;
  streamedAnswer: string;
  progressMessages: string[];
  usage: LlmUsage | null;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCitationClick: (chunk: CitedChunk) => void;
};

export function ChatPanel({
  title,
  error,
  lastQuestion,
  result,
  isLoading,
  streamedAnswer,
  progressMessages,
  usage,
  input,
  onInputChange,
  onSubmit,
  onCitationClick,
}: ChatPanelProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">{title}</h2>
      {/* Scrollable conversation area: error, user message, assistant output, and loading state. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {/* Global request/stream error display. */}
        {error ? (
          <section className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100">
            <p>{error}</p>
          </section>
        ) : null}

        {/* Latest user message shown as the right-aligned "You" bubble. */}
        {lastQuestion ? (
          <article className="ml-auto max-w-[95%] rounded-2xl border border-sky-500/40 bg-sky-500/20 p-4 shadow-lg">
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-300">You</p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-100">
              {lastQuestion}
            </p>
          </article>
        ) : null}

        {/* Final assistant result (with optional citations) once the stream completes. */}
        {result ? (
          <article className="mr-auto max-w-[95%] rounded-2xl border border-slate-600 bg-slate-800/80 p-4 shadow-lg">
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-300">Assistant</p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-100">
              {result.answer}
            </p>

            {result.cited_chunks.length > 0 ? (
              <div className="mt-4 space-y-2">
                <h2 className="text-xs font-semibold text-slate-300">Citations</h2>
                <div className="space-y-2">
                  {result.cited_chunks.map((chunk) => (





                    <button
                      type="button"
                      key={`${chunk.document_id}-${chunk.citation_index}`}
                      onClick={() => onCitationClick(chunk)}
                      className="block w-full rounded-lg border border-slate-600/70 bg-slate-900/50 p-3 text-left transition-colors hover:border-sky-400/60 hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    >
                      <p className="text-xs font-medium text-sky-300">
                        [{chunk.citation_index}] {chunk.source} (page {chunk.page + 1})
                      </p>
                      <p className="mt-1 text-xs text-slate-300">{chunk.content}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {usage ? (
              <p className="mt-4 text-xs text-slate-400">
                Usage: Input tokens: {usage.input_tokens.toLocaleString()} · Output tokens:{" "}
                {usage.output_tokens.toLocaleString()} · Total tokens:{" "}
                {usage.total_tokens.toLocaleString()}
              </p>
            ) : null}
          </article>
        ) : !isLoading && !lastQuestion ? (
          /* First-load empty state before any question is submitted. */
          <div className="rounded-xl border border-dashed border-slate-600 p-6 text-sm text-slate-300">
            To get started, upload one or more PDFs and ask a question about them in the chat box below.
          </div>
        ) : null}

        {/* In-progress assistant response while waiting for final result payload. */}
        {isLoading ? (
          <div className="mr-auto max-w-[95%] rounded-2xl border border-slate-600 bg-slate-800/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
              Assistant
            </p>
            {streamedAnswer ? (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-100">
                {streamedAnswer}
              </p>
            ) : (
              <div className="mt-1 space-y-1 text-sm text-slate-400">
                {progressMessages.map((message, idx) => (
                  <p key={`${message}-${idx}`}>{message}</p>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Persistent input composer anchored below the scrollable conversation feed. */}
      <form
        onSubmit={onSubmit}
        autoComplete="off"
        className="mt-4 rounded-2xl border border-slate-700/60 bg-slate-900/85 p-3 backdrop-blur"
      >
        <label htmlFor="question-input" className="sr-only">
          Ask a question
        </label>
        <div className="flex min-w-0 items-center gap-2">
          <input
            id="question-input"
            name="question-input"
            type="text"
            autoComplete="off"
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder="Ask about your documents..."
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30"
          />
          <button
            type="submit"
            disabled={isLoading || input.trim().length === 0}
            className="shrink-0 whitespace-nowrap rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-sky-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
