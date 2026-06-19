"use client";

type ThemeToggleProps = {
  isDark: boolean;
  onToggle: () => void;
};

export function ThemeToggle({ isDark, onToggle }: ThemeToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={
        isDark ? "Dark mode on, switch to light mode" : "Light mode on, switch to dark mode"
      }
      onClick={onToggle}
      className={`relative h-8 w-[3.25rem] shrink-0 rounded-full border transition-colors duration-200 ${
        isDark ? "border-slate-600 bg-slate-900" : "border-slate-300 bg-slate-200"
      }`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-between px-1.5"
      >
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={isDark ? "text-amber-400/40" : "text-amber-500/70"}
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={isDark ? "text-slate-300/80" : "text-slate-500/40"}
        >
          <path d="M21 14.5A7.5 7.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
        </svg>
      </span>
      <span
        aria-hidden="true"
        className={`absolute top-0.5 left-0.5 flex h-6 w-6 items-center justify-center rounded-full shadow-sm transition-transform duration-200 ease-out ${
          isDark
            ? "translate-x-6 bg-slate-700 text-amber-300"
            : "translate-x-0 bg-white text-amber-500"
        }`}
      >
        {isDark ? (
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 14.5A7.5 7.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        )}
      </span>
    </button>
  );
}
