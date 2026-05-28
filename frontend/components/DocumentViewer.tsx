"use client";

export function DocumentViewer() {
  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* Panel header for the document preview column. */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Document preview</h2>
      </div>
      {/* Placeholder body. */}
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-900/60 p-4">
        <p className="text-sm text-slate-400">
          Document preview is not available yet.
        </p>
      </div>
    </section>
  );
}
