"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { CitedChunk, LlmUsage, QueryResponse } from "@/lib/types";

/** Format a duration for display: milliseconds below 1s, otherwise seconds with one decimal. */
function formatDurationMs(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${ms}ms`;
}

/**
 * Elapsed milliseconds between two cumulative stream timestamps from `timings_ms`.
 * Returns null when either key is missing or the difference is not positive.
 */
function computeDurationMs(
  timingsMs: Record<string, number>,
  startKey: string,
  endKey: string,
): number | null {
  const startMs = timingsMs[startKey];
  const endMs = timingsMs[endKey];
  if (startMs == null || endMs == null) {
    return null;
  }
  const ms = endMs - startMs;
  return ms > 0 ? ms : null;
}

/** End-to-end duration and optional step breakdown for the timing footer. */
function buildTimingDisplay(
  timingsMs: Record<string, number>,
): { total: string; steps: string | null } | null {
  const steps: string[] = [];

  // Vector search: from retrieval start until rerank begins (or until total if rerank never ran).
  const retrieval =
    computeDurationMs(timingsMs, "retrieval", "rerank") ??
    computeDurationMs(timingsMs, "retrieval", "total");
  if (retrieval != null) {
    steps.push(`Retrieval ${formatDurationMs(retrieval)}`);
  }

  // Cross-encoder rerank + top-k selection: from rerank start until inference (or total if LLM skipped).
  const rerankEndMs = timingsMs.inference ?? timingsMs.total;
  if (timingsMs.rerank != null && rerankEndMs != null) {
    const rerankMs = rerankEndMs - timingsMs.rerank;
    if (rerankMs > 0) {
      steps.push(`Rerank ${formatDurationMs(rerankMs)}`);
    }
  }

  // LLM until first visible answer text (first delta).
  const generate = computeDurationMs(timingsMs, "inference", "first_token_ms");
  if (generate != null) {
    steps.push(`Generate ${formatDurationMs(generate)}`);
  }

  // Remaining answer text streamed after the first delta.
  const stream = computeDurationMs(timingsMs, "first_token_ms", "total");
  if (stream != null) {
    steps.push(`Stream ${formatDurationMs(stream)}`);
  }

  if (timingsMs.total == null) {
    return steps.length > 0 ? { total: steps.join(" · "), steps: null } : null;
  }

  return {
    total: formatDurationMs(timingsMs.total),
    steps: steps.length > 0 ? steps.join(" · ") : null,
  };
}

const CITATION_PREVIEW_WORDS = 20;

/**
 * Builds a citation preview from the first N words of content.
 *
 * @param content Full citation content text.
 * @param maxWords Maximum number of words to include in the preview.
 * @returns The preview text and whether the content was truncated.
 */
function truncateCitationContent(
  content: string,
  maxWords = CITATION_PREVIEW_WORDS,
): { preview: string; truncated: boolean } {
  // Trim leading/trailing whitespace, split on any whitespace, and remove empty entries.
  const words = content.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return { preview: content, truncated: false };
  }
  return {
    preview: words.slice(0, maxWords).join(" "),
    truncated: true,
  };
}

/**
 * Splits a cited chunk into a display subtitle and body text.
 *
 * @param chunk Cited chunk that may contain heading metadata.
 * @returns A subtitle from headings (if present) and normalized body text.
 */
function citationParts(chunk: CitedChunk): { subtitle: string | null; body: string } {
  const headings = chunk.headings ?? [];
  if (headings.length === 0) {
    return { subtitle: null, body: chunk.content };
  }

  const subtitle = headings.join(" › ");
  // Docling contextualize() prepends headings to chunk text, joined by newlines.
  // Strip that prefix so we can show the subtitle and body separately in the UI.
  const prefix = headings.join("\n");
  let body = chunk.content;
  if (body.startsWith(prefix)) {
    body = body.slice(prefix.length).replace(/^\n+/, "");
  }
  return { subtitle, body };
}

type ChatPanelProps = {
  title: string;
  error: string;
  lastQuestion: string;
  result: QueryResponse | null;
  isLoading: boolean;
  streamedAnswer: string;
  progressMessages: string[];
  usage: LlmUsage | null;
  timingsMs: Record<string, number> | null;
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
  timingsMs,
  input,
  onInputChange,
  onSubmit,
  onCitationClick,
}: ChatPanelProps) {
  const timingDisplay = timingsMs ? buildTimingDisplay(timingsMs) : null;
  const [usageDetailsOpen, setUsageDetailsOpen] = useState(false);
  const [timingDetailsOpen, setTimingDetailsOpen] = useState(false);

  useEffect(() => {
    setUsageDetailsOpen(false);
  }, [usage?.total_tokens]);

  useEffect(() => {
    setTimingDetailsOpen(false);
  }, [timingDisplay?.total]);

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
                  {result.cited_chunks.map((chunk) => {
                    const citationKey = `${chunk.document_id}-${chunk.citation_index}`;
                    const { subtitle, body } = citationParts(chunk);
                    const { preview, truncated } = truncateCitationContent(body);

                    return (
                      <button
                        key={citationKey}
                        type="button"
                        onClick={() => onCitationClick(chunk)}
                        className="w-full rounded-lg border border-slate-600/70 bg-slate-900/50 p-3 text-left transition-colors hover:border-sky-500/40 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                      >
                        <span className="text-xs font-medium text-sky-300">
                          [{chunk.citation_index}] {chunk.source} (page{" "}
                          {chunk.page + 1})
                        </span>
                        <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-300">
                          {subtitle ? (
                            <>
                              <span className="font-medium text-slate-400">{subtitle}</span>
                              <span className="text-slate-500"> — </span>
                            </>
                          ) : null}
                          {preview}
                          {truncated ? (
                            <span className="text-slate-500"> [...]</span>
                          ) : null}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {usage || timingsMs?.total != null ? (
              <div className="mt-4 space-y-1 text-xs text-slate-400">
                {usage ? (
                  <p>
                    <span className="font-semibold text-slate-300">Usage:</span>{" "}
                    {usage.total_tokens.toLocaleString()} tokens
                    {usageDetailsOpen
                      ? ` (Input tokens: ${usage.input_tokens.toLocaleString()} · Output tokens: ${usage.output_tokens.toLocaleString()})`
                      : null}{" "}
                    <span className="italic text-slate-400">
                      (
                      <button
                        type="button"
                        onClick={() => setUsageDetailsOpen((open) => !open)}
                        className="italic text-sky-400 hover:text-sky-300 hover:underline"
                      >
                        {usageDetailsOpen ? "hide details" : "show details"}
                      </button>
                      )
                    </span>
                  </p>
                ) : null}
                {timingDisplay ? (
                  <p>
                    <span className="font-semibold text-slate-300">Timing:</span>{" "}
                    {timingDisplay.total}
                    {timingDisplay.steps ? (
                      <>
                        {timingDetailsOpen ? ` (${timingDisplay.steps})` : null}{" "}
                        <span className="italic text-slate-400">
                          (
                          <button
                            type="button"
                            onClick={() => setTimingDetailsOpen((open) => !open)}
                            className="italic text-sky-400 hover:text-sky-300 hover:underline"
                          >
                            {timingDetailsOpen ? "hide details" : "show details"}
                          </button>
                          )
                        </span>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
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
