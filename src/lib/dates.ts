// Date-only values ("2026-10-17") are stored as UTC midnight. Wall-clock times
// (check-in/out) are real instants, interpreted in the organisation time zone.

export const APP_TZ = process.env.APP_TZ ?? "Asia/Kolkata";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && toIsoDate(d) === s;
}

/** "2026-10-17" -> Date at UTC midnight. */
export function parseIsoDate(s: string): Date {
  if (!isIsoDate(s)) throw new Error(`Invalid date: ${s}`);
  return new Date(`${s}T00:00:00Z`);
}

/** Date (UTC midnight) -> "2026-10-17". */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Every date from `from` to `to`, inclusive. */
export function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) out.push(new Date(d));
  return out;
}

/** Today's date in the org time zone, as an ISO date string. */
export function todayIso(now: Date = new Date(), tz: string = APP_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Wall-clock "HH:mm" on an ISO date in `tz` -> UTC instant. */
export function zonedTimeToUtc(isoDate: string, hhmm: string, tz: string = APP_TZ): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = new Date(`${isoDate}T00:00:00Z`);
  guess.setUTCHours(h, m, 0, 0);
  const offset = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - offset * 60000);
}

/** UTC instant -> "HH:mm" in `tz`. */
export function formatTime(instant: Date | null | undefined, tz: string = APP_TZ): string {
  if (!instant) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
}

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? parseIsoDate(d) : d;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** "2026-10" -> first and last date of that month (UTC midnight). */
export function monthRange(ym: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error(`Invalid month: ${ym}`);
  const [y, m] = ym.split("-").map(Number);
  if (m < 1 || m > 12) throw new Error(`Invalid month: ${ym}`);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0)) };
}
