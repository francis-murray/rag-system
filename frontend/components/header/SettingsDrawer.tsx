"use client";

import { useEffect } from "react";
import { ApiStatus, ApiStatusIndicator } from "./ApiStatusIndicator";

export type SettingsModels = {
  rag: string;
  embedding: string;
  reranker: string;
};

type SettingsDrawerProps = {
  isDark: boolean;
  isOpen: boolean;
  apiStatus: ApiStatus;
  models: SettingsModels | null;
  modelsLoading: boolean;
  modelsError: string | null;
  onClose: () => void;
};

const MODEL_ROWS: { key: keyof SettingsModels; label: string; description: string }[] = [
  {
    key: "rag",
    label: "RAG",
    description: "Answer generation",
  },
  {
    key: "embedding",
    label: "Embedding",
    description: "Vector retrieval",
  },
  {
    key: "reranker",
    label: "Reranker",
    description: "Cross-encoder rerank",
  },
];

/** Slide-over panel for API status and active model configuration. */
export function SettingsDrawer({
  isDark,
  isOpen,
  apiStatus,
  models,
  modelsLoading,
  modelsError,
  onClose,
}: SettingsDrawerProps) {
  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close settings"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-drawer-title"
        className={`relative flex h-full w-full max-w-md flex-col border-l shadow-2xl ${
          isDark
            ? "border-sky-400/20 bg-slate-900/95 text-slate-100"
            : "border-slate-300 bg-white text-slate-900"
        }`}
      >
        <div
          className={`flex items-center justify-between border-b px-5 py-4 ${
            isDark ? "border-slate-700/80" : "border-slate-200"
          }`}
        >
          <h2
            id="settings-drawer-title"
            className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
              isDark ? "text-slate-300" : "text-slate-600"
            }`}
          >
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings panel"
            className={`rounded-lg p-1.5 transition-colors ${
              isDark
                ? "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="space-y-3">
            <h3
              className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${
                isDark ? "text-slate-400" : "text-slate-500"
              }`}
            >
              API status
            </h3>
            <div
              className={`rounded-xl border px-4 py-3 ${
                isDark
                  ? "border-slate-700/80 bg-slate-950/40"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              <ApiStatusIndicator isDark={isDark} status={apiStatus} />
            </div>
          </section>

          <section className="space-y-3">
            <h3
              className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${
                isDark ? "text-slate-400" : "text-slate-500"
              }`}
            >
              Models
            </h3>
            {modelsLoading ? (
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Loading models…
              </p>
            ) : modelsError ? (
              <p className={`text-sm ${isDark ? "text-rose-300" : "text-rose-600"}`}>
                {modelsError}
              </p>
            ) : models ? (
            <dl className="space-y-2">
              {MODEL_ROWS.map(({ key, label, description }) => (
                <div
                  key={key}
                  className={`rounded-xl border px-4 py-3 ${
                    isDark
                      ? "border-slate-700/80 bg-slate-950/40"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <dt
                    className={`text-xs font-semibold uppercase tracking-wide ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    {label}
                  </dt>
                  <dd
                    className={`mt-0.5 text-sm font-medium ${
                      isDark ? "text-slate-100" : "text-slate-800"
                    }`}
                  >
                    {models[key]}
                  </dd>
                  <dd
                    className={`mt-1 text-xs ${
                      isDark ? "text-slate-500" : "text-slate-500"
                    }`}
                  >
                    {description}
                  </dd>
                </div>
              ))}
            </dl>
            ) : null}
          </section>
        </div>
      </aside>
    </div>
  );
}
