"use client";

import dynamic from "next/dynamic";
import type { CitationTarget } from "@/lib/types";

const PdfCanvas = dynamic(() => import('./PdfCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-900/60 p-4 text-sm text-slate-400">
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
    <section className="flex h-full min-h-0 flex-col">
      {/* Panel header for the document preview column. */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Document preview</h2>
        {documentId ? (
          <span className="min-w-0 truncate text-xs text-slate-400" title={documentId}>
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
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-900/60 p-4">
          <p className="text-sm text-slate-400">Select a document to preview it here.</p>
        </div>
      )}
    </section>
  );
}
