"use client";

import type { FormEvent } from "react";
import { DocumentItem } from "@/lib/types";

type FileExplorerPanelProps = {
  documents: DocumentItem[];
  isUploading: boolean;
  onUploadSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function FileExplorerPanel({
  documents,
  isUploading,
  onUploadSubmit,
}: FileExplorerPanelProps) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
      <h2 className="text-sm font-semibold text-slate-200">Available documents</h2>

      {/* File Explorer */}
      {documents.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No uploaded documents yet.</p>
      ) : (
        <ul className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-700/70 bg-slate-950/35">
          {documents.map((document) => (
            <li
              key={document.document_id}
              className="flex items-center gap-2 border-b border-slate-800/80 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800/50 last:border-b-0"
              title={document.filename}
            >
              <span className="text-slate-500" aria-hidden="true">
                📄
              </span>
              <span className="min-w-0 flex-1 truncate">{document.filename}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Upload file form */}
      <form
        onSubmit={onUploadSubmit}
        className="rounded-2xl border border-slate-700/60 bg-slate-900/85 p-3 backdrop-blur lg:mt-auto"
      >
        <label htmlFor="upload-file-input" className="sr-only">
          Choose a file to upload
        </label>
        <div className="flex min-w-0 flex-col gap-2">
          <input
            id="upload-file-input"
            name="file"
            type="file"
            required
            className="min-h-11 min-w-0 max-w-full cursor-pointer rounded-xl border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 file:mr-3 file:max-w-[50%] file:truncate file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30"
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
    </aside>
  );
}
