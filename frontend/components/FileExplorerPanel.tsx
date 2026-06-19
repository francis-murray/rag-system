"use client";

import type { FormEvent } from "react";
import { DocumentItem } from "@/lib/types";

type FileExplorerPanelProps = {
  isDark: boolean;
  documents: DocumentItem[];
  selectedDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
  isUploading: boolean;
  uploadProgressMessages: string[];
  onUploadSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

const DOCLING_PARSING_MESSAGE = "Parsing PDF with Docling...";

export function FileExplorerPanel({
  isDark,
  documents,
  selectedDocumentId,
  onSelectDocument,
  isUploading,
  uploadProgressMessages,
  onUploadSubmit,
}: FileExplorerPanelProps) {
  // Show the indeterminate bar only while Docling parsing is the current upload stage.
  const isParsing =
    uploadProgressMessages[uploadProgressMessages.length - 1] === DOCLING_PARSING_MESSAGE;

  return (
    <aside
      className={`flex min-h-0 min-w-0 flex-col gap-3 rounded-2xl border p-3 ${
        isDark
          ? "border-sky-400/20 bg-slate-900/55 shadow-[0_10px_30px_rgba(2,6,23,0.35)] backdrop-blur-xl"
          : "border-slate-300 bg-white shadow-sm"
      }`}
    >
      <h2
        className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
          isDark ? "text-slate-300" : "text-slate-600"
        }`}
      >
        Documents
      </h2>

      {/* File Explorer */}
      <div className="mt-1.5 min-h-0 flex-1">
        {documents.length === 0 ? (
          <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            No uploaded documents yet.
          </p>
        ) : (
          <ul
            className={`h-full min-h-0 overflow-y-auto rounded-xl p-1 ${
              isDark ? "bg-slate-950/35" : "bg-slate-100"
            }`}
          >
          {documents.map((document) => {
            const isSelected = document.document_id === selectedDocumentId;
            return (
              <li
                key={document.document_id}
                className="text-sm text-slate-300 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => onSelectDocument(document.document_id)}
                  title={document.filename}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-200 ease-out ${
                    isSelected
                      ? isDark
                        ? "bg-sky-500/20 text-sky-50 shadow-sm shadow-sky-500/20"
                        : "bg-sky-100 text-sky-900"
                      : isDark
                        ? "text-slate-300 hover:bg-slate-800/55"
                        : "text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  <span className={isDark ? "text-slate-500" : "text-slate-400"} aria-hidden="true">
                    📄
                  </span>
                  <span className="min-w-0 flex-1 truncate">{document.filename}</span>
                </button>
              </li>
            );
          })}
          </ul>
        )}
      </div>

      {/* Upload progress messages */}
      {uploadProgressMessages.length > 0 && (
        <div className={`space-y-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          {uploadProgressMessages.map((message, idx) => (
            <p key={`${message}-${idx}`} className="text-xs">
              {message}
            </p>
          ))}
          {isParsing && (
            <div
              className={`mt-1 h-1 overflow-hidden rounded-full ${
                isDark ? "bg-slate-700/50" : "bg-slate-200"
              }`}
            >
              <div
                className="h-full w-2/5 rounded-full bg-sky-500"
                style={{ animation: "upload-indeterminate 1.5s ease-in-out infinite" }}
              />
            </div>
          )}
        </div>
      )}

      {/* Upload file form */}
      <form onSubmit={onUploadSubmit} className="pt-1">
        <label htmlFor="upload-file-input" className="sr-only">
          Choose a file to upload
        </label>
        <div className="flex min-w-0 flex-col gap-1.5">
          <input
            id="upload-file-input"
            name="file"
            type="file"
            required
            className={`min-h-10 min-w-0 max-w-full cursor-pointer rounded-xl border px-2.5 py-1.5 text-sm transition-all duration-200 ease-out file:mr-2.5 file:max-w-[50%] file:truncate file:rounded-lg file:border-0 file:px-2.5 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30 ${
              isDark
                ? "border-slate-500/80 bg-slate-950/70 text-slate-200 file:bg-slate-700/90 file:text-slate-100"
                : "border-slate-300 bg-white text-slate-700 file:bg-slate-200 file:text-slate-700"
            }`}
          />
          <button
            type="submit"
            className="rounded-xl bg-sky-500 px-3.5 py-1.5 text-sm font-semibold text-sky-950 transition-all duration-200 ease-out hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isUploading}
          >
            {isUploading ? "Uploading & Indexing..." : "Upload File"}
          </button>
        </div>
      </form>

      <style>{`
        @keyframes upload-indeterminate {
          0%   { transform: translateX(-150%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </aside>
  );
}
