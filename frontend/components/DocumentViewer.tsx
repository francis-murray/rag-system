"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import type { CitationTarget } from "@/lib/types";

const PdfCanvas = dynamic(() => import("./PdfCanvas"), {
  ssr: false,
});

type DocumentViewerProps = {
  isDark: boolean;
  documentId: string | null;
  citationTarget: CitationTarget | null;
  resetNonce: number;
};

function PdfLoadingFallback({ isDark }: { isDark: boolean }) {
  return (
    <div
      className={`flex min-h-0 flex-1 items-center justify-center rounded-lg p-3 text-sm ${
        isDark ? "bg-slate-900/55 text-slate-400" : "bg-slate-100 text-slate-500"
      }`}
    >
      Loading viewer...
    </div>
  );
}

export function DocumentViewer({
  isDark,
  documentId,
  citationTarget,
  resetNonce,
}: DocumentViewerProps) {
  return (
    <section
      className={`flex h-full min-h-0 flex-col rounded-2xl border p-3 ${
        isDark
          ? "border-sky-400/20 bg-slate-900/55 shadow-[0_10px_30px_rgba(2,6,23,0.35)] backdrop-blur-xl"
          : "border-slate-300 bg-white shadow-sm"
      }`}
    >
      {/* Panel header for the document preview column. */}
      <div className="mb-2 flex items-center justify-between">
        <h2
          className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
            isDark ? "text-slate-300" : "text-slate-600"
          }`}
        >
          Preview
        </h2>
        {documentId ? (
          <span
            className={`min-w-0 truncate text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}
            title={documentId}
          >
            {documentId}
          </span>
        ) : null}
      </div>
      {documentId ? (
        <Suspense fallback={<PdfLoadingFallback isDark={isDark} />}>
          <PdfCanvas
            key={documentId}
            fileUrl={`/api/documents/${encodeURIComponent(documentId)}/file`}
            citationTarget={citationTarget}
            resetNonce={resetNonce}
          />
        </Suspense>
      ) : (
        <div
          className={`flex min-h-0 flex-1 items-center justify-center rounded-lg p-3 ${
            isDark ? "bg-slate-900/55" : "bg-slate-100"
          }`}
        >
          <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Select a document to preview it here.
          </p>
        </div>
      )}
    </section>
  );
}
