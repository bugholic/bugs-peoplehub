import type { Shift } from "@/generated/prisma/client";
import { db } from "./db";
import { badRequest, conflict, notFound } from "./errors";
import { eachDay, isWeekend, toIsoDate, zonedTimeToUtc } from "./dates";
import { offDays as offDaysAt } from "./leave";

/**
 * Work shifts (docs/TODO.md T13): when the day starts and ends, the grace before a late
 * check-in or early check-out counts, and how many worked minutes earn a full or half day.
 * Times are wall-clock in the org time zone; an end at or before the start is an overnight shift.
 */

export type ShiftRules = Pick<Shift, "startTime" | "endTime" | "graceMinutes" | "halfDayMinutes" | "fullDayMinutes">;
export type Credit = "FULL" | "HALF" | "SHORT";

/** The tenant-scoped client inside `db.$transaction(async (tx) => ...)`. */
export type Tx = Omit<typeof db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// ---------- Pure rules (unit tested) ----------

/** The shift's start and end instants on `isoDate` (end rolls to the next day for an overnight shift). */
export function shiftWindow(shift: Pick<Shift, "startTime" | "endTime">, isoDate: string, tz?: string) {
  const start = zonedTimeToUtc(isoDate, shift.startTime, tz);
  let end = zonedTimeToUtc(isoDate, shift.endTime, tz);
  if (end <= start) end = new Date(end.getTime() + DAY);
  return { start, end };
}

/** Scheduled length in minutes (overnight-aware, time-zone independent). */
export function scheduledMinutes(shift: Pick<Shift, "startTime" | "endTime">): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const d = toMin(shift.endTime) - toMin(shift.startTime);
  return d > 0 ? d : d + 24 * 60;
}

export function dayCredit(shift: Pick<Shift, "halfDayMinutes" | "fullDayMinutes">, worked: number): Credit {
  if (worked >= shift.fullDayMinutes) return "FULL";
  if (worked >= shift.halfDayMinutes) return "HALF";
  return "SHORT";
}

export type DayPunches = {
  /** First check-in of the day; null = nothing recorded. */
  firstIn: Date | null;
  /** Last check-out; ignored while a session is open. */
  lastOut: Date | null;
  workedMinutes: number;
  /** A session is still open: the day isn't over, so only lateness is known. */
  open: boolean;
  /** Weekend or holiday: no lateness or credit, and all worked time is overtime. */
  offDay: boolean;
};

export type ShiftMetrics = { lateMinutes: number; earlyExitMinutes: number; overtimeMinutes: number; credit: Credit | null };

export const NO_METRICS: ShiftMetrics = { lateMinutes: 0, earlyExitMinutes: 0, overtimeMinutes: 0, credit: null };

/**
 * Late-in, early-out, overtime and day credit for one day under `shift`.
 * Late/early are measured from the shift boundary but only count once past the grace
 * (a 9:00 start with 15 min grace: 9:10 is on time, 9:20 is 20 min late).
 * Overtime is worked time beyond the scheduled length.
 */
export function shiftMetrics(shift: ShiftRules | null, isoDate: string, p: DayPunches, tz?: string): ShiftMetrics {
  if (!shift || !p.firstIn) return NO_METRICS;
  if (p.offDay) return { ...NO_METRICS, overtimeMinutes: p.open ? 0 : p.workedMinutes };

  const { start, end } = shiftWindow(shift, isoDate, tz);
  const graceMs = shift.graceMinutes * MINUTE;
  const late = p.firstIn.getTime() - start.getTime();
  const lateMinutes = late > graceMs ? Math.round(late / MINUTE) : 0;
  if (p.open) return { ...NO_METRICS, lateMinutes };

  const early = p.lastOut ? end.getTime() - p.lastOut.getTime() : 0;
  return {
    lateMinutes,
    earlyExitMinutes: early > graceMs ? Math.round(early / MINUTE) : 0,
    overtimeMinutes: Math.max(0, p.workedMinutes - scheduledMinutes(shift)),
    credit: dayCredit(shift, p.workedMinutes),
  };
}

// ---------- Data access ----------

export function serializeShift(s: Shift & { _count?: { employees: number } }) {
  return {
    id: s.id,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    graceMinutes: s.graceMinutes,
    halfDayMinutes: s.halfDayMinutes,
    fullDayMinutes: s.fullDayMinutes,
    isDefault: s.isDefault,
    overnight: s.endTime <= s.startTime,
    scheduledMinutes: scheduledMinutes(s),
    ...(s._count ? { employeeCount: s._count.employees } : {}),
  };
}

export async function listShifts() {
  const rows = await db.shift.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { employees: true } } } });
  return rows.map(serializeShift);
}

export type ShiftInput = Partial<ShiftRules & { name: string; isDefault: boolean }>;

function assertThresholds(s: Pick<Shift, "halfDayMinutes" | "fullDayMinutes">) {
  if (s.halfDayMinutes > s.fullDayMinutes) {
    throw badRequest("Half-day minimum can't be more than the full-day minimum", "INVALID_THRESHOLDS");
  }
}

async function assertUniqueName(tx: Tx, name: string, exceptId?: string) {
  const clash = await tx.shift.findFirst({ where: { name, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw conflict("A shift with this name already exists", "DUPLICATE");
}

/** Only one default per org: making a shift the default clears the flag elsewhere (same transaction). */
async function clearOtherDefaults(tx: Tx, keepId: string) {
  await tx.shift.updateMany({ where: { isDefault: true, id: { not: keepId } }, data: { isDefault: false } });
}

export async function createShift(input: ShiftRules & { name: string; isDefault: boolean }) {
  assertThresholds(input);
  return db.$transaction(async (tx) => {
    await assertUniqueName(tx, input.name);
    // The org's first shift becomes the default, so shift rules start applying straight away.
    const isDefault = input.isDefault || (await tx.shift.count()) === 0;
    const shift = await tx.shift.create({ data: { ...input, isDefault } });
    if (isDefault) await clearOtherDefaults(tx, shift.id);
    return serializeShift(shift);
  });
}

export async function updateShift(id: string, input: ShiftInput) {
  return db.$transaction(async (tx) => {
    const existing = await tx.shift.findUnique({ where: { id } });
    if (!existing) throw notFound("Shift");
    assertThresholds({ ...existing, ...input });
    if (input.name && input.name !== existing.name) await assertUniqueName(tx, input.name, id);
    if (input.isDefault === false && existing.isDefault) {
      throw badRequest("Make another shift the default instead", "DEFAULT_REQUIRED");
    }
    const shift = await tx.shift.update({ where: { id }, data: input });
    if (input.isDefault) await clearOtherDefaults(tx, id);
    return serializeShift(shift);
  });
}

/** Deleting moves its employees to the default shift (Employee.shiftId → null). The default can't be deleted while others exist. */
export async function deleteShift(id: string) {
  return db.$transaction(async (tx) => {
    const existing = await tx.shift.findUnique({ where: { id } });
    if (!existing) throw notFound("Shift");
    if (existing.isDefault && (await tx.shift.count()) > 1) {
      throw conflict("Make another shift the default before deleting this one", "DEFAULT_REQUIRED");
    }
    await tx.employee.updateMany({ where: { shiftId: id }, data: { shiftId: null } });
    await tx.shift.delete({ where: { id } });
  });
}

/**
 * What a day's metrics need besides the punches: the employee's shift (own, else the org
 * default; null = no shift rules) and which dates in [from, to] are off days (weekend or a
 * holiday at their location). Read before the punch transaction, which must stay short.
 */
export type ShiftContext = { shift: ShiftRules | null; offDays: Set<string>; tz: string };

export async function shiftContext(employeeId: string, from: Date, to: Date, tz: string): Promise<ShiftContext> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { locationId: true, shift: true } });
  const shift = e?.shift ?? (await db.shift.findFirst({ where: { isDefault: true } }));
  if (!shift) return { shift: null, offDays: new Set(), tz };
  const [offDays, weekOff] = await offDaysAt(e?.locationId ?? null, from, to);
  for (const d of eachDay(from, to)) if (isWeekend(d, weekOff)) offDays.add(toIsoDate(d));
  return { shift, offDays, tz };
}

export type LogPunches = {
  date: Date;
  checkIn: Date | null;
  workedMinutes: number;
  sessions: { checkIn: Date; checkOut: Date | null }[];
};

/** Metrics for an attendance log as it stands after a punch or regularization (stored on AttendanceLog). */
export function metricsForLog(ctx: ShiftContext, log: LogPunches): ShiftMetrics {
  const iso = toIsoDate(log.date);
  const closed = log.sessions.flatMap((s) => (s.checkOut ? [s.checkOut.getTime()] : []));
  return shiftMetrics(ctx.shift, iso, {
    firstIn: log.checkIn,
    lastOut: closed.length ? new Date(Math.max(...closed)) : null,
    workedMinutes: log.workedMinutes,
    open: log.sessions.some((s) => !s.checkOut),
    offDay: ctx.offDays.has(iso),
  }, ctx.tz);
}
