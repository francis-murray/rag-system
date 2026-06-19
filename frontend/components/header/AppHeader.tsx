"use client";

import { ThemeToggle } from "./ThemeToggle";

type AppHeaderProps = {
  isDark: boolean;
  onToggleTheme: () => void;
};

export function AppHeader({ isDark, onToggleTheme }: AppHeaderProps) {
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
        <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
      </div>
    </header>
  );
}
