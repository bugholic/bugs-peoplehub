import { db } from "./db";
import { badRequest, conflict, notFound } from "./errors";
import { eachDay, isWeekend, monthRange, parseIsoDate, toIsoDate, todayIso, zonedTimeToUtc } from "./dates";
import { holidaySet } from "./leave";

export type DayStatus = "PRESENT" | "ABSENT" | "LEAVE" | "HALF_DAY_LEAVE" | "HOLIDAY" | "WEEKEND" | "UPCOMING";

// ---------- Pure rules (unit tested) ----------

export function workedMinutes(checkIn: Date, checkOut: Date): number {
  return Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000));
}

export type DayInputs = {
  date: string;
  today: string;
  hasLog: boolean;
  holiday: boolean;
  leave: "FULL" | "HALF" | null;
};

/**
 * Status shown for a calendar day. Precedence matches what an HR admin expects:
 * a check-in always counts as presence (half-day leave keeps its label), then
 * leave, holiday and weekend, then future days, and finally absence.
 */
export function deriveDayStatus({ date, today, hasLog, holiday, leave }: DayInputs): DayStatus {
  if (hasLog) return leave === "HALF" ? "HALF_DAY_LEAVE" : "PRESENT";
  if (leave === "FULL") return "LEAVE";
  if (leave === "HALF") return "HALF_DAY_LEAVE";
  if (holiday) return "HOLIDAY";
  if (isWeekend(parseIsoDate(date))) return "WEEKEND";
  if (date >= today) return "UPCOMING";
  return "ABSENT";
}

export function validateRegularization(date: string, today: string, checkIn: Date, checkOut: Date) {
  if (date > today) throw badRequest("You can't regularize a future date", "FUTURE_DATE");
  if (checkOut <= checkIn) throw badRequest("Check-out must be after check-in", "INVALID_TIMES");
  if (workedMinutes(checkIn, checkOut) > 24 * 60) throw badRequest("A single entry can't exceed 24 hours", "INVALID_TIMES");
}

// ---------- Data access ----------

export async function checkIn(employeeId: string, now = new Date()) {
  const date = parseIsoDate(todayIso(now));
  const existing = await db.attendanceLog.findUnique({ where: { employeeId_date: { employeeId, date } } });
  if (existing?.checkIn) throw conflict("You've already checked in today", "ALREADY_CHECKED_IN");
  return db.attendanceLog.upsert({
    where: { employeeId_date: { employeeId, date } },
    create: { employeeId, date, checkIn: now, status: "PRESENT" },
    update: { checkIn: now, status: "PRESENT" },
  });
}

/** Check-out can be repeated; the latest one wins (e.g. stepping back in after leaving). */
export async function checkOut(employeeId: string, now = new Date()) {
  const date = parseIsoDate(todayIso(now));
  const log = await db.attendanceLog.findUnique({ where: { employeeId_date: { employeeId, date } } });
  if (!log?.checkIn) throw conflict("Check in before checking out", "NOT_CHECKED_IN");
  return db.attendanceLog.update({
    where: { id: log.id },
    data: { checkOut: now, workedMinutes: workedMinutes(log.checkIn, now) },
  });
}

export async function getToday(employeeId: string, now = new Date()) {
  const date = parseIsoDate(todayIso(now));
  return db.attendanceLog.findUnique({ where: { employeeId_date: { employeeId, date } } });
}

/** One row per day of the month, with derived status. */
export async function getMonth(employeeId: string, ym: string) {
  const { start, end } = monthRange(ym);
  const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { locationId: true } });
  if (!employee) throw notFound("Employee");
  const [logs, holidays, leaves] = await Promise.all([
    db.attendanceLog.findMany({ where: { employeeId, date: { gte: start, lte: end } } }),
    holidaySet(employee.locationId, start, end),
    db.leaveRequest.findMany({
      where: { employeeId, status: "APPROVED", fromDate: { lte: end }, toDate: { gte: start } },
      include: { leaveType: { select: { name: true } } },
    }),
  ]);
  const today = todayIso();
  const leaveByDay = new Map<string, { kind: "FULL" | "HALF"; type: string }>();
  for (const l of leaves) {
    for (const d of eachDay(l.fromDate, l.toDate)) {
      leaveByDay.set(toIsoDate(d), { kind: l.dayPart === "FULL" ? "FULL" : "HALF", type: l.leaveType.name });
    }
  }
  const logByDay = new Map(logs.map((l) => [toIsoDate(l.date), l]));

  return eachDay(start, end).map((d) => {
    const iso = toIsoDate(d);
    const log = logByDay.get(iso);
    const leave = leaveByDay.get(iso) ?? null;
    return {
      date: iso,
      status: deriveDayStatus({ date: iso, today, hasLog: !!log?.checkIn, holiday: holidays.has(iso), leave: leave?.kind ?? null }),
      checkIn: log?.checkIn?.toISOString() ?? null,
      checkOut: log?.checkOut?.toISOString() ?? null,
      workedMinutes: log?.workedMinutes ?? 0,
      regularized: log?.regularized ?? false,
      leaveType: leave?.type ?? null,
    };
  });
}

export function summarize(days: Awaited<ReturnType<typeof getMonth>>) {
  const count = (s: DayStatus) => days.filter((d) => d.status === s).length;
  return {
    present: count("PRESENT") + count("HALF_DAY_LEAVE") * 0.5,
    absent: count("ABSENT"),
    leave: count("LEAVE") + count("HALF_DAY_LEAVE") * 0.5,
    holidays: count("HOLIDAY"),
    workedMinutes: days.reduce((a, d) => a + d.workedMinutes, 0),
  };
}

export type RegularizationInput = { date: string; checkIn: string; checkOut: string; reason: string };

export async function requestRegularization(employeeId: string, input: RegularizationInput) {
  const inAt = zonedTimeToUtc(input.date, input.checkIn);
  let outAt = zonedTimeToUtc(input.date, input.checkOut);
  // An overnight shift ends on the next calendar day.
  if (outAt <= inAt) outAt = new Date(outAt.getTime() + 24 * 60 * 60000);
  validateRegularization(input.date, todayIso(), inAt, outAt);

  const date = parseIsoDate(input.date);
  const pending = await db.regularizationRequest.findFirst({ where: { employeeId, date, status: "PENDING" } });
  if (pending) throw conflict("There's already a pending regularization for this date", "DUPLICATE");
  const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { reportingManagerId: true } });

  return db.regularizationRequest.create({
    data: {
      employeeId,
      date,
      checkIn: inAt,
      checkOut: outAt,
      reason: input.reason,
      approverId: employee?.reportingManagerId,
    },
  });
}

export async function decideRegularization(id: string, deciderId: string, approve: boolean, note?: string) {
  return db.$transaction(async (tx) => {
    const r = await tx.regularizationRequest.findUnique({ where: { id } });
    if (!r) throw notFound("Regularization request");
    if (r.status !== "PENDING") throw conflict(`Request is already ${r.status.toLowerCase()}`, "NOT_PENDING");
    if (approve) {
      const minutes = workedMinutes(r.checkIn, r.checkOut);
      await tx.attendanceLog.upsert({
        where: { employeeId_date: { employeeId: r.employeeId, date: r.date } },
        create: {
          employeeId: r.employeeId,
          date: r.date,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          workedMinutes: minutes,
          status: "PRESENT",
          regularized: true,
        },
        update: { checkIn: r.checkIn, checkOut: r.checkOut, workedMinutes: minutes, status: "PRESENT", regularized: true },
      });
    }
    return tx.regularizationRequest.update({
      where: { id },
      data: { status: approve ? "APPROVED" : "REJECTED", approverId: deciderId, decisionNote: note, decidedAt: new Date() },
    });
  });
}
