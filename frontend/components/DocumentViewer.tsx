"use client";

import dynamic from "next/dynamic";
import type { CitationTarget } from "@/lib/types";

const PdfCanvas = dynamic(() => import('./PdfCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg bg-slate-900/55 p-3 text-sm text-slate-400">
      Loading viewer...
    </div>
  ),
});

type DocumentViewerProps = {
  documentId: string | null;
  citationTarget: CitationTarget | null;
  resetNonce: number;
};

export function DocumentViewer({ documentId, citationTarget, resetNonce }: DocumentViewerProps) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-sky-400/20 bg-slate-900/55 p-3 shadow-[0_10px_30px_rgba(2,6,23,0.35)] backdrop-blur-xl">
      {/* Panel header for the document preview column. */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
          Preview
        </h2>
        {documentId ? (
          <span className="min-w-0 truncate text-xs text-slate-500" title={documentId}>
            {documentId}
          </span>
        ) : null}
      </div>
      {/* Placeholder body. */}
      {documentId ? (
        <PdfCanvas
          key={documentId}
          fileUrl={`/api/documents/${encodeURIComponent(documentId)}/file`}
          citationTarget={citationTarget}
          resetNonce={resetNonce}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg bg-slate-900/55 p-3">
          <p className="text-sm text-slate-400">Select a document to preview it here.</p>
        </div>
      )}
    </section>
  );
}
