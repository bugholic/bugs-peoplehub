import type { ButtonHTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { AlertIcon, CheckIcon, InboxIcon } from "@/components/icons";

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6", className)}>{children}</div>;
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="font-display text-base font-semibold tracking-tight text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" }) {
  const variants = {
    primary: "bg-brand text-white shadow-sm shadow-brand/30 hover:bg-brand-hover disabled:opacity-45 disabled:shadow-none",
    secondary: "border border-line bg-surface text-ink hover:bg-surface-2 disabled:text-ink-3",
    danger: "bg-red-600 text-white hover:bg-red-700 disabled:opacity-45",
    ghost: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
  };
  const sizes = { sm: "h-8 gap-1.5 px-3 text-[13px]", md: "h-10 gap-2 px-4 text-sm" };
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center rounded-xl font-semibold transition-[background-color,box-shadow,transform] active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

const FIELD =
  "w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-ink-3/60 focus:border-brand focus:ring-4 focus:ring-brand/15 disabled:bg-surface-2 disabled:text-ink-3";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(FIELD, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(FIELD, "py-2.5", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={cx(FIELD, "h-10 cursor-pointer", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cx("mb-1.5 block text-[13px] font-medium text-ink-2", className)} {...props} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const BADGE_COLORS: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/25",
  APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/25",
  REJECTED: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/25",
  CANCELLED: "bg-surface-2 text-ink-3 ring-line",
  PRESENT: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/25",
  ABSENT: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/25",
  LEAVE: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/25",
  HALF_DAY_LEAVE: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/25",
  HOLIDAY: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/25",
  WEEKEND: "bg-surface-2 text-ink-3 ring-line",
  UPCOMING: "bg-surface-2 text-ink-3 ring-line",
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/25",
  INACTIVE: "bg-surface-2 text-ink-3 ring-line",
  OFFICE: "bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-indigo-400/25",
  REMOTE: "bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-400/10 dark:text-orange-300 dark:ring-orange-400/25",
  HYBRID: "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-400/10 dark:text-teal-300 dark:ring-teal-400/25",
};

export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  const label = children ?? status.charAt(0) + status.slice(1).toLowerCase().replaceAll("_", " ");
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
        BADGE_COLORS[status] ?? "bg-surface-2 text-ink-2 ring-line",
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
}

// Stable hue per person so the same name always gets the same avatar colour.
const AVATAR_TONES = [
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300",
  "bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-300",
  "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-400/15 dark:text-fuchsia-300",
  "bg-teal-100 text-teal-800 dark:bg-teal-400/15 dark:text-teal-300",
];

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const parts = name.trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const tone = AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
  const sizes = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-12 text-base", xl: "size-20 text-2xl" };
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-display font-semibold", tone, sizes[size], className)}>
      {initials}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-ink sm:text-[32px]">{title}</h1>
        {description && <p className="mt-1.5 text-[15px] text-ink-2">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="mb-6 inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1 shadow-card">
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={value === t}
          onClick={() => onChange(t)}
          className={cx(
            "whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
            value === t ? "bg-night text-white dark:bg-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl bg-surface-2 p-1 ring-1 ring-inset ring-line">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "success"; children: ReactNode }) {
  const styles =
    kind === "error"
      ? "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-400/10 dark:text-rose-200 dark:ring-rose-400/25"
      : "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/25";
  const Icon = kind === "error" ? AlertIcon : CheckIcon;
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cx("flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm ring-1 ring-inset", styles)}>
      <Icon size={17} className="mt-px shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <span className="mb-3 inline-flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-ink">
        <InboxIcon size={22} />
      </span>
      <p className="font-display text-[15px] font-semibold text-ink">{children}</p>
      {hint && <p className="mt-1 max-w-xs text-sm text-ink-3">{hint}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface-2 ring-1 ring-inset ring-line" style={{ opacity: 1 - i * 0.25 }} />
      ))}
    </div>
  );
}

/** Table shell with consistent header styling. */
export function Table({ head, children, minWidth = 560 }: { head: ReactNode[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-[13px] text-ink-3">
              {head.map((h, i) => (
                <th key={i} className="px-5 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">{children}</tbody>
        </table>
      </div>
    </div>
  );
}
