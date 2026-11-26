/**
 * PeopleHub's UI kit: thin, app-specific wrappers over shadcn/ui primitives
 * (src/components/ui/*). Pages import from here so status colours, avatar tones and
 * page chrome stay consistent; reach for the raw shadcn component when you need more.
 * No "use client" here: server pages render PageHeader/Card directly, and the shadcn
 * files that need the client (tabs, toggle-group, avatar) already declare it.
 */

import type { ComponentProps, ReactNode } from "react";
import { CircleAlert, CircleCheck, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button as UiButton } from "@/components/ui/button";
import { Card as UiCard } from "@/components/ui/card";
import { Input as UiInput } from "@/components/ui/input";
import { Textarea as UiTextarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Label as UiLabel } from "@/components/ui/label";
import { Badge as UiBadge } from "@/components/ui/badge";
import { Avatar as UiAvatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert as UiAlert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs as UiTabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table as UiTable, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** @deprecated use `cn` from "@/lib/utils" (merges conflicting Tailwind classes). */
export const cx = (...classes: Array<string | false | null | undefined>) => cn(...classes);

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <UiCard className={cn("gap-0 p-5 sm:p-6", className)}>{children}</UiCard>;
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold tracking-tight text-card-foreground">{children}</h2>
      {action}
    </div>
  );
}

const BUTTON_VARIANT = { primary: "default", secondary: "outline", danger: "destructive", ghost: "ghost", link: "link" } as const;
const BUTTON_SIZE = { sm: "sm", md: "lg", lg: "lg", icon: "icon", "icon-sm": "icon-sm" } as const;

export function Button({
  variant = "primary",
  size = "md",
  ...props
}: Omit<ComponentProps<typeof UiButton>, "variant" | "size"> & { variant?: keyof typeof BUTTON_VARIANT; size?: keyof typeof BUTTON_SIZE }) {
  return <UiButton variant={BUTTON_VARIANT[variant]} size={BUTTON_SIZE[size]} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <UiInput className={cn("h-9", className)} {...props} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <UiTextarea {...props} />;
}

export function Select({ className, children, ...props }: Omit<ComponentProps<"select">, "size"> & { children: ReactNode }) {
  return (
    <NativeSelect className={cn("w-full [&_select]:h-9", className)} {...props}>
      {children}
    </NativeSelect>
  );
}

export function Label({ className, ...props }: ComponentProps<typeof UiLabel>) {
  return <UiLabel className={cn("mb-2 text-muted-foreground", className)} {...props} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const GREEN = "border-emerald-600/20 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300";
const RED = "border-rose-600/20 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300";
const AMBER = "border-amber-600/20 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300";
const SKY = "border-sky-600/20 bg-sky-50 text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-300";
const NEUTRAL = "border-border bg-muted text-muted-foreground";

const BADGE_COLORS: Record<string, string> = {
  PENDING: AMBER,
  APPROVED: GREEN,
  REJECTED: RED,
  CANCELLED: NEUTRAL,
  PRESENT: GREEN,
  HALF_DAY: AMBER,
  ABSENT: RED,
  LEAVE: SKY,
  HALF_DAY_LEAVE: SKY,
  HOLIDAY: "border-violet-600/20 bg-violet-50 text-violet-700 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-300",
  WEEKEND: NEUTRAL,
  UPCOMING: NEUTRAL,
  ACTIVE: GREEN,
  INACTIVE: NEUTRAL,
  OFFICE: "border-indigo-600/20 bg-indigo-50 text-indigo-700 dark:border-indigo-400/25 dark:bg-indigo-400/10 dark:text-indigo-300",
  REMOTE: "border-orange-600/20 bg-orange-50 text-orange-700 dark:border-orange-400/25 dark:bg-orange-400/10 dark:text-orange-300",
  HYBRID: "border-teal-600/20 bg-teal-50 text-teal-700 dark:border-teal-400/25 dark:bg-teal-400/10 dark:text-teal-300",
};

/** Status pill: colour comes from the status key, label defaults to "Half day leave"-style text. */
export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  const label = children ?? status.charAt(0) + status.slice(1).toLowerCase().replaceAll("_", " ");
  return (
    <UiBadge variant="outline" className={cn("gap-1.5 font-medium", BADGE_COLORS[status] ?? NEUTRAL)}>
      <span className="size-1.5 rounded-full bg-current opacity-80" />
      {label}
    </UiBadge>
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

export function Avatar({ name, size = "md", className, photoUrl }: { name: string; size?: "sm" | "md" | "lg" | "xl"; className?: string; photoUrl?: string | null }) {
  const parts = name.trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const tone = AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
  const sizes = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-12 text-base", xl: "size-20 text-2xl" };
  return (
    <UiAvatar className={cn(sizes[size], className)}>
      {/* Served by our auth-checked API route (private bucket), so next/image's optimizer can't fetch it. */}
      {photoUrl && <AvatarImage src={photoUrl} alt={name} />}
      <AvatarFallback className={cn("font-semibold", tone, sizes[size])}>{initials}</AvatarFallback>
    </UiAvatar>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Controlled tab strip; the caller renders the active panel itself. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <UiTabs value={value} onValueChange={(v) => onChange(v as T)} className="mb-6 max-w-full overflow-x-auto">
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t} value={t} className="px-3">
            {t}
          </TabsTrigger>
        ))}
      </TabsList>
    </UiTabs>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      // Radix emits "" when the active item is clicked again; keep a value selected.
      onValueChange={(v) => v && onChange(v as T)}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="px-3">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "success"; children: ReactNode }) {
  if (kind === "error") {
    return (
      <UiAlert variant="destructive" className="border-destructive/30 bg-destructive/5">
        <CircleAlert />
        <AlertDescription>{children}</AlertDescription>
      </UiAlert>
    );
  }
  return (
    <UiAlert role="status" className="border-emerald-600/25 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200">
      <CircleCheck />
      <AlertDescription className="text-current">{children}</AlertDescription>
    </UiAlert>
  );
}

export function EmptyState({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <Empty className="border border-dashed py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>{children}</EmptyTitle>
        {hint && <EmptyDescription>{hint}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

export function Spinner() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 rounded-xl" style={{ opacity: 1 - i * 0.25 }} />
      ))}
    </div>
  );
}

/** Table shell with consistent header styling; rows are passed as children (<tr>/<td>). */
export function Table({ head, children, minWidth = 560 }: { head: ReactNode[]; children: ReactNode; minWidth?: number }) {
  return (
    <UiCard className="gap-0 overflow-hidden py-0">
      <UiTable style={{ minWidth }}>
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            {head.map((h, i) => (
              <TableHead key={i} className="h-10 px-5 text-muted-foreground">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:align-middle">{children}</TableBody>
      </UiTable>
    </UiCard>
  );
}
