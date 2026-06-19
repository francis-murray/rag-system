"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { BBox, CitationTarget } from "@/lib/types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type PdfCanvasProps = {
  fileUrl: string;
  citationTarget: CitationTarget | null;
  resetNonce: number;
};

function boxesForPage(
  citationTarget: CitationTarget | null,
  pageIndex: number
): BBox[] {
  if (!citationTarget) return [];
  const location = citationTarget.chunk.locations.find((loc) => loc.page === pageIndex);
  return location?.boxes ?? [];
}

export default function PdfCanvas({ fileUrl, citationTarget, resetNonce }: PdfCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const firstHighlightRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollPageRef = useRef<number | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Reflow pages to the column width; the gutters resize this container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setWidth(el.clientWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Citation click: jump to the first cited page (1-based). Runs again when numPages
  // becomes known on first load, and on every new citationTarget (via nonce).
  useEffect(() => {
    if (!citationTarget || numPages === 0) return;
    const firstPage =
      citationTarget.chunk.locations[0]?.page ?? citationTarget.chunk.page;
    const targetPage = firstPage + 1;
    pendingScrollPageRef.current = targetPage;
    requestAnimationFrame(() => scrollToCitationIfPending(targetPage));
  }, [citationTarget, numPages]);

  // Explorer click: scroll back to page 1. resetNonce changes even when
  // documentId stays the same, so re-clicking the same file still resets.
  useEffect(() => {
    if (resetNonce === 0) return;
    pendingScrollPageRef.current = null;
    containerRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [resetNonce]);

  function scrollToCitationIfPending(pageNumber: number) {
    if (pendingScrollPageRef.current !== pageNumber) return;
    const pageEl = pageRefs.current[pageNumber - 1];
    if (!pageEl || pageEl.offsetHeight === 0) return;

    const target = firstHighlightRef.current ?? pageEl;
    pendingScrollPageRef.current = null;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      {error ? (
        <div className="flex h-full items-center justify-center p-4 text-sm text-rose-300">
          {error}
        </div>
      ) : (
        <Document
          file={fileUrl}
          onLoadSuccess={({ numPages: loadedPages }) => setNumPages(loadedPages)}
          onLoadError={() => setError("Could not load this document.")}
          loading={<div className="p-4 text-sm text-slate-400">Loading document...</div>}
        >
          {Array.from({ length: numPages }, (_, index) => {
            const highlightBoxes = boxesForPage(citationTarget, index);
            const isFirstCitationPage =
              citationTarget !== null &&
              index ===
                (citationTarget.chunk.locations[0]?.page ?? citationTarget.chunk.page);

            return (
              <div
                key={`page_${index + 1}`}
                ref={(divElement) => {
                  pageRefs.current[index] = divElement;
                }}
                className="relative mx-auto mb-4 w-fit bg-white shadow-sm"
              >
                <Page
                  pageNumber={index + 1}
                  width={width || undefined}
                  renderTextLayer
                  renderAnnotationLayer
                  onRenderSuccess={() => scrollToCitationIfPending(index + 1)}
                />
                {highlightBoxes.length > 0 ? (
                  <div className="pointer-events-none absolute inset-0">
                    {highlightBoxes.map((box, boxIndex) => (
                      <div
                        key={`${index}-${boxIndex}`}
                        ref={isFirstCitationPage && boxIndex === 0 ? firstHighlightRef : undefined}
                        className="absolute border border-amber-400/80 bg-amber-300/35"
                        style={{
                          left: `${box.l * 100}%`,
                          top: `${box.t * 100}%`,
                          width: `${(box.r - box.l) * 100}%`,
                          height: `${(box.b - box.t) * 100}%`,
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </Document>
      )}
    </div>
  );
}
