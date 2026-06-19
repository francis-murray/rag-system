"use client";

import { useEffect, useState } from "react";
import { ApiStatus, ApiStatusIndicator } from "./ApiStatusIndicator";
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

/** Top app bar with title, API reachability indicator, and theme toggle. */
export function AppHeader({ isDark, onToggleTheme }: AppHeaderProps) {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

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

  return (
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
          <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
        </div>
      </div>
    </header>
  );
}
