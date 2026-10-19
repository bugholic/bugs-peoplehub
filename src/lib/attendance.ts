import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { badRequest, conflict, notFound } from "./errors";
import { eachDay, isWeekend, monthRange, parseIsoDate, toIsoDate, todayIso, zonedTimeToUtc } from "./dates";
import { matchOffice } from "./geo";
import { holidaySet } from "./leave";

export type PunchLocation = { latitude: number; longitude: number; accuracy?: number };

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

export type SessionMode = "OFFICE" | "REMOTE";
export type DayMode = SessionMode | "HYBRID";

/** The day's mode after adding a session: unchanged if it matches, HYBRID once office and remote mix. */
export function combineWorkMode(day: DayMode | null, session: SessionMode): DayMode {
  if (!day || day === session) return session;
  return "HYBRID";
}

export function validateRegularization(date: string, today: string, checkIn: Date, checkOut: Date) {
  if (date > today) throw badRequest("You can't regularize a future date", "FUTURE_DATE");
  if (checkOut <= checkIn) throw badRequest("Check-out must be after check-in", "INVALID_TIMES");
  if (workedMinutes(checkIn, checkOut) > 24 * 60) throw badRequest("A single entry can't exceed 24 hours", "INVALID_TIMES");
}

// ---------- Data access ----------

const sessionInclude = {
  orderBy: { checkIn: "asc" },
  include: { officeLocation: { select: { id: true, name: true } } },
} satisfies Prisma.AttendanceLog$sessionsArgs;

const logInclude = {
  sessions: sessionInclude,
  remoteRequest: { select: { id: true, status: true } },
} satisfies Prisma.AttendanceLogInclude;

type LogWithRefs = Prisma.AttendanceLogGetPayload<{ include: typeof logInclude }>;
type SessionWithOffice = LogWithRefs["sessions"][number];

function serializeSession(s: SessionWithOffice) {
  return {
    id: s.id,
    checkIn: s.checkIn.toISOString(),
    checkOut: s.checkOut?.toISOString() ?? null,
    workMode: s.workMode,
    office: s.officeLocation,
  };
}

const openSession = (sessions: SessionWithOffice[]) => sessions.find((s) => !s.checkOut) ?? null;

export function serializeLog(log: LogWithRefs) {
  return {
    id: log.id,
    date: toIsoDate(log.date),
    checkIn: log.checkIn?.toISOString() ?? null,
    checkOut: log.checkOut?.toISOString() ?? null,
    workedMinutes: log.workedMinutes,
    workMode: log.workMode,
    openSince: openSession(log.sessions)?.checkIn.toISOString() ?? null,
    sessions: log.sessions.map(serializeSession),
    remoteRequest: log.remoteRequest,
  };
}

/** Serializes concurrent punches for one employee-day (e.g. a double-clicked button). */
async function lockLog(tx: Prisma.TransactionClient, logId: string) {
  await tx.$queryRaw`SELECT id FROM "AttendanceLog" WHERE id = ${logId} FOR UPDATE`;
}

/** Locations with a configured geofence. */
async function officeGeofences() {
  const rows = await db.location.findMany({ where: { latitude: { not: null }, longitude: { not: null } } });
  return rows.map((l) => ({ id: l.id, name: l.name, latitude: l.latitude!, longitude: l.longitude!, radiusMeters: l.radiusMeters }));
}

/**
 * Starts a work session. Allowed again after checking out, so a day can have several sessions.
 * Inside an office geofence the session is OFFICE; anywhere else, or with no location, it's REMOTE.
 */
export async function checkIn(employeeId: string, location: PunchLocation | null, now = new Date()) {
  const date = parseIsoDate(todayIso(now));
  const office = matchOffice(location, await officeGeofences());
  const mode: SessionMode = office ? "OFFICE" : "REMOTE";
  return db.$transaction(async (tx) => {
    const { id } = await tx.attendanceLog.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: { employeeId, date, status: "PRESENT" },
      update: {},
      select: { id: true },
    });
    await lockLog(tx, id);
    const log = await tx.attendanceLog.findUniqueOrThrow({ where: { id }, include: logInclude });
    if (openSession(log.sessions)) throw conflict("You're already checked in", "ALREADY_CHECKED_IN");

    await tx.attendanceSession.create({
      data: {
        attendanceLogId: id,
        checkIn: now,
        workMode: mode,
        officeLocationId: office?.id ?? null,
        checkInLatitude: location?.latitude ?? null,
        checkInLongitude: location?.longitude ?? null,
        checkInAccuracy: location?.accuracy ?? null,
      },
    });
    return tx.attendanceLog.update({
      where: { id },
      data: { checkIn: log.checkIn ?? now, checkOut: null, status: "PRESENT", workMode: combineWorkMode(log.workMode, mode) },
      include: logInclude,
    });
  });
}

/**
 * Ends the open session and adds it to the day's worked time.
 * Ending a remote session raises the day's remote work request for HR, or adds the time to it;
 * a request HR already decided goes back to PENDING so the new time gets reviewed too.
 */
export async function checkOut(employeeId: string, location: PunchLocation | null, now = new Date()) {
  const date = parseIsoDate(todayIso(now));
  return db.$transaction(async (tx) => {
    const existing = await tx.attendanceLog.findUnique({ where: { employeeId_date: { employeeId, date } }, select: { id: true } });
    if (existing) await lockLog(tx, existing.id);
    const log = existing && (await tx.attendanceLog.findUniqueOrThrow({ where: { id: existing.id }, include: logInclude }));
    const session = log && openSession(log.sessions);
    if (!log || !session) throw conflict("You're not checked in", "NOT_CHECKED_IN");

    const minutes = workedMinutes(session.checkIn, now);
    await tx.attendanceSession.update({
      where: { id: session.id },
      data: {
        checkOut: now,
        checkOutLatitude: location?.latitude ?? null,
        checkOutLongitude: location?.longitude ?? null,
        checkOutAccuracy: location?.accuracy ?? null,
      },
    });
    await tx.attendanceLog.update({ where: { id: log.id }, data: { checkOut: now, workedMinutes: { increment: minutes } } });

    if (session.workMode === "REMOTE") {
      if (!log.remoteRequest) {
        await tx.remoteWorkRequest.create({
          data: { employeeId, attendanceLogId: log.id, date, checkIn: session.checkIn, checkOut: now, remoteMinutes: minutes },
        });
      } else {
        await tx.remoteWorkRequest.update({
          where: { id: log.remoteRequest.id },
          data: {
            checkOut: now,
            remoteMinutes: { increment: minutes },
            status: "PENDING",
            approverId: null,
            decisionNote: null,
            decidedAt: null,
          },
        });
      }
    }
    return tx.attendanceLog.findUniqueOrThrow({ where: { id: log.id }, include: logInclude });
  });
}

export const remoteRequestInclude = {
  employee: { select: { id: true, firstName: true, lastName: true, empCode: true } },
  approver: { select: { id: true, firstName: true, lastName: true } },
  attendanceLog: {
    select: {
      sessions: {
        where: { workMode: "REMOTE" },
        orderBy: { checkIn: "asc" },
        take: 1,
        select: { checkInLatitude: true, checkInLongitude: true },
      },
    },
  },
} satisfies Prisma.RemoteWorkRequestInclude;

export function serializeRemoteRequest(r: Prisma.RemoteWorkRequestGetPayload<{ include: typeof remoteRequestInclude }>) {
  return {
    id: r.id,
    employee: { id: r.employee.id, name: `${r.employee.firstName} ${r.employee.lastName}`, empCode: r.employee.empCode },
    date: toIsoDate(r.date),
    checkIn: r.checkIn.toISOString(),
    checkOut: r.checkOut.toISOString(),
    workedMinutes: r.remoteMinutes,
    latitude: r.attendanceLog.sessions[0]?.checkInLatitude ?? null,
    longitude: r.attendanceLog.sessions[0]?.checkInLongitude ?? null,
    status: r.status,
    approver: r.approver ? { id: r.approver.id, name: `${r.approver.firstName} ${r.approver.lastName}` } : null,
    decisionNote: r.decisionNote,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function decideRemoteRequest(id: string, deciderId: string, approve: boolean, note?: string) {
  const r = await db.remoteWorkRequest.findUnique({ where: { id } });
  if (!r) throw notFound("Remote work request");
  if (r.status !== "PENDING") throw conflict(`Request is already ${r.status.toLowerCase()}`, "NOT_PENDING");
  // Guarded on PENDING so two HR admins deciding at once can't both win.
  const { count } = await db.remoteWorkRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: approve ? "APPROVED" : "REJECTED", approverId: deciderId, decisionNote: note, decidedAt: new Date() },
  });
  if (count === 0) throw conflict("Request was just decided by someone else", "NOT_PENDING");
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
    db.attendanceLog.findMany({
      where: { employeeId, date: { gte: start, lte: end } },
      include: { sessions: sessionInclude, remoteRequest: { select: { status: true } } },
    }),
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
      workMode: log?.workMode ?? null,
      remoteStatus: log?.remoteRequest?.status ?? null,
      openSince: (log && openSession(log.sessions)?.checkIn.toISOString()) ?? null,
      sessions: log?.sessions.map(serializeSession) ?? [],
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
      // The corrected times replace the day's sessions with a single one.
      const session = { checkIn: r.checkIn, checkOut: r.checkOut };
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
          sessions: { create: session },
        },
        update: {
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          workedMinutes: minutes,
          status: "PRESENT",
          regularized: true,
          workMode: null,
          sessions: { deleteMany: {}, create: session },
        },
      });
    }
    return tx.regularizationRequest.update({
      where: { id },
      data: { status: approve ? "APPROVED" : "REJECTED", approverId: deciderId, decisionNote: note, decidedAt: new Date() },
    });
  });
}
