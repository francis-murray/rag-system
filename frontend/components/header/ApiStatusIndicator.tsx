"use client";

export type ApiStatus = "checking" | "online" | "offline";

type ApiStatusIndicatorProps = {
  isDark: boolean;
  status: ApiStatus;
  compact?: boolean;
};

const STATUS_COPY: Record<ApiStatus, string> = {
  checking: "Checking API…",
  online: "API online",
  offline: "API unreachable",
};

export function ApiStatusIndicator({ isDark, status, compact = false }: ApiStatusIndicatorProps) {
  const dotClass =
    status === "checking"
      ? "bg-amber-400 animate-pulse"
      : status === "online"
        ? "bg-emerald-400"
        : "bg-rose-500";

  return (
    <div
      className={`flex min-w-0 items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}
      role="status"
      aria-live="polite"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      <span
        className={`truncate font-medium ${isDark ? "text-slate-300" : "text-slate-600"}`}
      >
        {STATUS_COPY[status]}
      </span>
    </div>
  );
}
