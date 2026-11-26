/**
 * Week-off patterns (docs/TODO.md T14). Pure, so both server and browser can use it.
 *
 * A pattern is a comma-separated list of tokens, stored as text on Organization.weekOff
 * (default "0,6") and optionally overridden per Location.weekOff:
 *   "D"    weekday D (0 = Sunday ... 6 = Saturday) is off every week
 *   "D#n"  only the n-th D of the month (n = 1..5), e.g. "6#2,6#4" = 2nd and 4th Saturday
 * "" = no weekly off (holidays still apply). Every day of the week off is not allowed.
 */

export const DEFAULT_WEEK_OFF = "0,6";
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th"];

/** Per weekday: "all" (every week), a set of week-of-month numbers, or undefined (working). */
export type WeekOffRule = "all" | Set<number> | undefined;
export type WeekOffRules = WeekOffRule[];

const TOKEN = /^([0-6])(?:#([1-5]))?$/;

/** Parses a pattern; throws on a malformed token. Tolerates spaces and duplicates. */
export function parseWeekOff(pattern: string): WeekOffRules {
  const rules: WeekOffRules = Array(7).fill(undefined);
  for (const raw of pattern.split(",")) {
    const token = raw.trim();
    if (!token) continue;
    const m = TOKEN.exec(token);
    if (!m) throw new Error(`Invalid week-off token: ${token}`);
    const day = Number(m[1]);
    if (m[2] === undefined) rules[day] = "all";
    else if (rules[day] !== "all") (rules[day] = (rules[day] as Set<number> | undefined) ?? new Set()).add(Number(m[2]));
  }
  return rules;
}

/** Canonical text for rules: weekdays in order, a weekday's weeks ascending; all five weeks collapse to "D". */
export function formatWeekOff(rules: WeekOffRules): string {
  const out: string[] = [];
  rules.forEach((r, day) => {
    if (r === "all" || (r instanceof Set && r.size === 5)) out.push(String(day));
    else if (r instanceof Set) for (const n of [...r].sort()) out.push(`${day}#${n}`);
  });
  return out.join(",");
}

/** Valid pattern that leaves at least one weekday always working. */
export function isValidWeekOff(pattern: string): boolean {
  try {
    return parseWeekOff(pattern).some((r) => r !== "all");
  } catch {
    return false;
  }
}

/** Normalizes a pattern to its canonical form (call only on valid input). */
export function normalizeWeekOff(pattern: string): string {
  return formatWeekOff(parseWeekOff(pattern));
}

const cache = new Map<string, WeekOffRules>();
function rulesFor(pattern: string): WeekOffRules {
  let r = cache.get(pattern);
  if (!r) cache.set(pattern, (r = parseWeekOff(pattern)));
  return r;
}

/** Which occurrence of its weekday a date is within its month (1..5). */
export function weekOfMonth(d: Date): number {
  return Math.floor((d.getUTCDate() - 1) / 7) + 1;
}

/** True when `d` (UTC midnight) is a weekly off under `pattern`. */
export function isWeekOff(d: Date, pattern: string = DEFAULT_WEEK_OFF): boolean {
  const r = rulesFor(pattern)[d.getUTCDay()];
  return r === "all" || (r instanceof Set && r.has(weekOfMonth(d)));
}

/** "Sat, Sun" / "Sun, 2nd & 4th Sat" / "None". Week starts Monday for display. */
export function describeWeekOff(pattern: string): string {
  const rules = rulesFor(pattern);
  const parts: string[] = [];
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const r = rules[day];
    if (r === "all" || (r instanceof Set && r.size === 5)) parts.push(SHORT[day]);
    else if (r instanceof Set) {
      const ns = [...r].sort().map((n) => ORDINAL[n]);
      parts.push(`${ns.length > 1 ? `${ns.slice(0, -1).join(", ")} & ${ns[ns.length - 1]}` : ns[0]} ${SHORT[day]}`);
    }
  }
  return parts.length ? parts.join(", ") : "None";
}
