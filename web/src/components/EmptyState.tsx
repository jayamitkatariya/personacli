import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  subtitle?: React.ReactNode;
  /** Primary action (e.g. "New note", "Ask AI…"). */
  actionLabel?: string;
  onAction?: () => void;
  /** Secondary content rendered below the action (cards, chips…). */
  children?: React.ReactNode;
  /** Compact layout for narrow containers (sidebar). */
  compact?: boolean;
}

/**
 * Shared actionable empty state: a subtle inline-SVG motif behind the icon,
 * heading, description and an optional primary action.
 */
export default function EmptyState({
  icon: Icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  children,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? "px-4 py-6" : "px-6 py-12"
      }`}
    >
      <div className="relative">
        <svg
          viewBox="0 0 96 96"
          className={`absolute -inset-3 ${compact ? "w-16 h-16" : "w-24 h-24"} opacity-70 dark:opacity-50 pointer-events-none`}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="empty-blob" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(var(--accent-rgb), 0.18)" />
              <stop offset="55%" stopColor="rgba(var(--aura-2), 0.14)" />
              <stop offset="100%" stopColor="rgba(var(--aura-4), 0.18)" />
            </linearGradient>
          </defs>
          <path
            d="M48 4c16 0 24 10 34 16s16 14 12 30-6 28-20 34-24 10-38 4-22-14-18-30 4-26 16-34 12-20 14-20z"
            fill="url(#empty-blob)"
            transform="translate(2, 2)"
          />
        </svg>
        <div
          className={`relative rounded-2xl bg-white dark:bg-stone-800 border border-stone-200/80 dark:border-stone-700/80 shadow-sm flex items-center justify-center ${
            compact ? "w-10 h-10" : "w-14 h-14"
          }`}
        >
          <Icon
            className={compact ? "w-5 h-5" : "w-6 h-6"}
            strokeWidth={1.4}
            style={{ color: "var(--color-blue-600)" }}
          />
        </div>
      </div>

      <h2
        className={`mt-4 font-semibold tracking-tight text-stone-900 dark:text-stone-100 ${
          compact ? "text-[13px]" : "text-[18px]"
        }`}
      >
        {title}
      </h2>
      {subtitle && (
        <p className={`mt-1.5 text-stone-500 dark:text-stone-400 leading-relaxed ${compact ? "text-[11.5px]" : "text-[13px]"}`}>
          {subtitle}
        </p>
      )}

      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className={`mt-5 flex items-center justify-center gap-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors ${
            compact ? "px-3 py-1.5 text-[12px]" : "px-4 py-2 text-[12.5px]"
          }`}
        >
          {actionLabel}
        </button>
      )}

      {children && <div className="mt-4 w-full">{children}</div>}
    </div>
  );
}
