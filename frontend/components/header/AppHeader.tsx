"use client";

import { useEffect, useState } from "react";
import { ApiStatus, ApiStatusIndicator } from "./ApiStatusIndicator";
import { SettingsDrawer, SettingsModels } from "./SettingsDrawer";
import { ThemeToggle } from "./ThemeToggle";

// Re-check API reachability periodically so the header reflects backend restarts.
const HEALTH_POLL_MS = 30_000;

type AppHeaderProps = {
  isDark: boolean;
  onToggleTheme: () => void;
};

/**
 * Calls the health proxy and maps the backend response to a header status state.
 * Network failures and non-OK responses are treated as offline.
 */
async function fetchApiStatus(): Promise<ApiStatus> {
  try {
    const response = await fetch("/api/health", { method: "GET", cache: "no-store" });
    if (!response.ok) {
      return "offline";
    }
    const data: { status?: string } = await response.json();
    return data.status === "ok" ? "online" : "offline";
  } catch {
    return "offline";
  }
}

/** Fetches runtime model names from the settings proxy. */
async function fetchSettingsModels(): Promise<SettingsModels> {
  const response = await fetch("/api/settings/models", { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load models (${response.status})`);
  }
  return response.json() as Promise<SettingsModels>;
}

/** Top app bar with title, API reachability indicator, settings, and theme toggle. */
export function AppHeader({ isDark, onToggleTheme }: AppHeaderProps) {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [models, setModels] = useState<SettingsModels | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  /**
   * Poll `/api/health` on mount and on an interval.
   * Uses a cancellation flag so late responses do not update state after unmount.
   */
  useEffect(() => {
    let cancelled = false;

    /** Fetches the latest API status and updates local state when still mounted. */
    async function checkHealth() {
      const status = await fetchApiStatus();
      if (!cancelled) {
        setApiStatus(status);
      }
    }

    void checkHealth();
    // Re-check on an interval so a later backend outage or recovery updates the indicator.
    const intervalId = window.setInterval(() => {
      void checkHealth();
    }, HEALTH_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  /** Load model settings when the drawer opens. */
  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    let cancelled = false;
    setModelsLoading(true);
    setModelsError(null);

    void fetchSettingsModels()
      .then((data) => {
        if (!cancelled) {
          setModels(data);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setModels(null);
          setModelsError(error instanceof Error ? error.message : "Failed to load models");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setModelsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  return (
    <>
      <header
        className={`min-w-0 rounded-2xl border px-4 py-2.5 lg:col-span-5 ${
          isDark
            ? "border-sky-400/20 bg-slate-900/65 shadow-[0_10px_30px_rgba(2,6,23,0.45)] backdrop-blur-xl"
            : "border-slate-300 bg-white shadow-sm"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <p
            className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${
              isDark ? "text-sky-200/90" : "text-slate-700"
            }`}
          >
            RAG System
          </p>

          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="hidden min-w-0 sm:block">
              <ApiStatusIndicator isDark={isDark} status={apiStatus} compact />
            </div>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              className={`rounded-lg p-1.5 transition-colors ${
                isDark
                  ? "text-slate-400 hover:bg-slate-800/80 hover:text-sky-200"
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
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>

            <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
          </div>
        </div>
      </header>

      <SettingsDrawer
        isDark={isDark}
        isOpen={settingsOpen}
        apiStatus={apiStatus}
        models={models}
        modelsLoading={modelsLoading}
        modelsError={modelsError}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}
