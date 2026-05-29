"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { CitationTarget } from "@/lib/types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type PdfCanvasProps = {
  fileUrl: string;
  citationTarget: CitationTarget | null;
  resetNonce: number;
};

export default function PdfCanvas({ fileUrl, citationTarget, resetNonce }: PdfCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pendingScrollPageRef = useRef<number | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);


  // Reflow pages to the column width; the gutters resize this container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Citation click: jump to the cited page (1-based). Runs again when numPages
  // becomes known on first load, and on every new citationTarget (via nonce).
  useEffect(() => {
    if (!citationTarget || numPages === 0) return;
    const targetPage = citationTarget.chunk.page + 1; // backend page is zero-based
    pendingScrollPageRef.current = targetPage;
    // Already-rendered pages won't fire onRenderSuccess again; try scrolling now.
    requestAnimationFrame(() => scrollToPageIfPending(targetPage));
  }, [citationTarget, numPages]);

  // Explorer click: scroll back to page 1. resetNonce changes even when
  // documentId stays the same, so re-clicking the same file still resets.
  useEffect(() => {
    if (resetNonce === 0) return; // skip the initial mount
    pendingScrollPageRef.current = null;
    containerRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [resetNonce]);

  // Shared by the citation effect (immediate) and Page onRenderSuccess (cold load).
  function scrollToPageIfPending(pageNumber: number) {
    if (pendingScrollPageRef.current !== pageNumber) return;
    const el = pageRefs.current[pageNumber - 1];
    if (!el || el.offsetHeight === 0) return; // page not painted yet; onRenderSuccess will retry
    pendingScrollPageRef.current = null;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-700/60 bg-slate-950/40"
    >
      {error ? (
        <div className="flex h-full items-center justify-center p-4 text-sm text-rose-300">
          {error}
        </div>
      ) : (
        // react-pdf root component: loads and parses the PDF from fileUrl.
        <Document
          file={fileUrl}
          // react-pdf parses the PDF and reports how many pages exist (not yet rendered).
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={() => setError("Could not load this document.")}
          loading={<div className="p-4 text-sm text-slate-400">Loading document...</div>}
        >
          {/* Build one <Page> per PDF page once numPages is known (index is zero-based). */}
          {Array.from({ length: numPages }, (_, index) => (
            <div
              key={`page_${index + 1}`}
              ref={(divElement) => {
                pageRefs.current[index] = divElement;
              }}
              className="relative mx-auto mb-4 w-fit"
            >
              <Page
                pageNumber={index + 1}
                width={width ? width - 24 : undefined}
                renderTextLayer
                renderAnnotationLayer
                // Fallback for first load: fires once this page's canvas is painted.
                onRenderSuccess={() => scrollToPageIfPending(index + 1)}
              />
              {/* Future: absolute-positioned bbox highlight overlay for citationTarget.chunk goes here. */}
            </div>
          ))}
        </Document>
      )}
    </div>
  );
}