import type { AttendanceEditSource, Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { badRequest, forbidden, notFound } from "./errors";
import { formatDate, isIsoDate, parseIsoDate, toIsoDate, todayIso, zonedTimeToUtc } from "./dates";
import { validateRegularization, workedMinutes } from "./attendance";
import { metricsForLog, shiftContext, type ShiftContext } from "./shifts";
import { employeeTimeZone } from "./timezone";
import { notify } from "./notifications";

/**
 * Direct attendance changes by admins (docs/TODO.md T17), audited in AttendanceEdit:
 *  - editAttendanceDay: set a day's times (replacing its sessions with one) or clear the day;
 *  - importAttendance: the same from a CSV (biometric export, spreadsheet), previewed first.
 * Needs `attendance.edit`; never on your own attendance (that's what regularization is for).
 */

const TX_OPTIONS = { timeout: 15_000 };
const MY_ATTENDANCE = "/attendance?tab=My+attendance";
export const MAX_IMPORT_ROWS = 500;

/** A day as the audit trail records it; null = nothing recorded. */
export type DaySnapshot = { checkIn: string | null; checkOut: string | null; workedMinutes: number } | null;

type Times = { inAt: Date; outAt: Date };
type Prepared = { employeeId: string; date: string; times: Times | null; reason: string; ctx: ShiftContext | null };

const sameSnapshot = (a: DaySnapshot, b: DaySnapshot) => JSON.stringify(a) === JSON.stringify(b);

function snapshot(log: { checkIn: Date | null; checkOut: Date | null; workedMinutes: number } | null): DaySnapshot {
  if (!log || !log.checkIn) return null;
  return { checkIn: log.checkIn.toISOString(), checkOut: log.checkOut?.toISOString() ?? null, workedMinutes: log.workedMinutes };
}

/** Wall-clock "HH:mm" pair on `date` in `tz` -> instants; a check-out at or before check-in is the next day. */
function resolveTimes(date: string, checkIn: string, checkOut: string, tz: string, now: Date): Times {
  const inAt = zonedTimeToUtc(date, checkIn, tz);
  let outAt = zonedTimeToUtc(date, checkOut, tz);
  if (outAt <= inAt) outAt = new Date(outAt.getTime() + 24 * 60 * 60_000);
  validateRegularization(date, todayIso(now, tz), inAt, outAt);
  if (outAt > now) throw badRequest("Check-out can't be in the future", "FUTURE_TIME");
  return { inAt, outAt };
}

/** Writes one day and its audit row in a transaction. Returns null when nothing would change. */
async function writeDay(p: Prepared, actorId: string, source: AttendanceEditSource) {
  const date = parseIsoDate(p.date);
  return db.$transaction(async (tx) => {
    const existing = await tx.attendanceLog.findUnique({ where: { employeeId_date: { employeeId: p.employeeId, date } } });
    const before = snapshot(existing);

    let after: DaySnapshot = null;
    if (!p.times) {
      if (!before) return null;
      await tx.attendanceLog.delete({ where: { id: existing!.id } }); // sessions + remote request cascade
    } else {
      const { inAt, outAt } = p.times;
      const minutes = workedMinutes(inAt, outAt);
      after = { checkIn: inAt.toISOString(), checkOut: outAt.toISOString(), workedMinutes: minutes };
      if (sameSnapshot(before, after)) return null;
      const session = { checkIn: inAt, checkOut: outAt };
      const metrics = metricsForLog(p.ctx!, { date, checkIn: inAt, workedMinutes: minutes, sessions: [session] });
      const fields = { checkIn: inAt, checkOut: outAt, workedMinutes: minutes, status: "PRESENT" as const, edited: true, autoClosed: false, workMode: null, ...metrics };
      let logId: string;
      if (existing) {
        // The edit replaces the day: its sessions, and a remote-work request still waiting on them.
        await tx.attendanceSession.deleteMany({ where: { attendanceLogId: existing.id } });
        await tx.remoteWorkRequest.deleteMany({ where: { attendanceLogId: existing.id, status: "PENDING" } });
        logId = (await tx.attendanceLog.update({ where: { id: existing.id }, data: fields })).id;
      } else {
        logId = (await tx.attendanceLog.create({ data: { employeeId: p.employeeId, date, ...fields } })).id;
      }
      await tx.attendanceSession.create({ data: { attendanceLogId: logId, ...session } });
    }
    if (sameSnapshot(before, after)) return null;

    const edit = await tx.attendanceEdit.create({
      data: {
        employeeId: p.employeeId,
        date,
        before: before ?? undefined,
        after: after ?? undefined,
        reason: p.reason,
        source,
        createdById: actorId,
      },
      include: editInclude,
    });
    return edit;
  }, TX_OPTIONS);
}

export type EditDayInput = { employeeId: string; date: string; checkIn: string | null; checkOut: string | null; reason: string };

/**
 * Sets (both times) or clears (both null) one day for an employee. Throws NO_CHANGE when the
 * day already matches; notifies the employee.
 */
export async function editAttendanceDay(input: EditDayInput, actorId: string, now = new Date()) {
  if (input.employeeId === actorId) throw forbidden("You can't edit your own attendance; request a regularization instead");
  const employee = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, joinDate: true } });
  if (!employee) throw notFound("Employee");
  if (input.date < toIsoDate(employee.joinDate)) throw badRequest("That date is before the employee joined", "BEFORE_JOIN");
  const tz = await employeeTimeZone(input.employeeId);
  if (input.date > todayIso(now, tz)) throw badRequest("You can't edit a future date", "FUTURE_DATE");

  const times = input.checkIn && input.checkOut ? resolveTimes(input.date, input.checkIn, input.checkOut, tz, now) : null;
  const ctx = times ? await shiftContext(input.employeeId, parseIsoDate(input.date), parseIsoDate(input.date), tz) : null;

  const edit = await writeDay({ employeeId: input.employeeId, date: input.date, times, reason: input.reason, ctx }, actorId, "MANUAL");
  if (!edit) throw badRequest(times ? "The day already has these times" : "Nothing is recorded on that day", "NO_CHANGE");

  await notify([input.employeeId], {
    type: "ATTENDANCE_EDITED",
    title: `Your attendance on ${formatDate(input.date)} was ${times ? "updated" : "cleared"}`,
    body: input.reason,
    link: MY_ATTENDANCE,
    actorId,
  });
  return serializeEdit(edit);
}

// ---------- Audit trail ----------

const editInclude = { createdBy: { select: { id: true, firstName: true, lastName: true } } } satisfies Prisma.AttendanceEditInclude;

export function serializeEdit(e: Prisma.AttendanceEditGetPayload<{ include: typeof editInclude }>) {
  return {
    id: e.id,
    employeeId: e.employeeId,
    date: toIsoDate(e.date),
    before: (e.before ?? null) as DaySnapshot,
    after: (e.after ?? null) as DaySnapshot,
    reason: e.reason,
    source: e.source,
    createdBy: e.createdBy ? { id: e.createdBy.id, name: `${e.createdBy.firstName} ${e.createdBy.lastName}` } : null,
    createdAt: e.createdAt.toISOString(),
  };
}

/** An employee's edits, newest first; optionally only those for dates in [from, to]. */
export async function listAttendanceEdits(employeeId: string, range?: { start: Date; end: Date }) {
  const rows = await db.attendanceEdit.findMany({
    where: { employeeId, ...(range ? { date: { gte: range.start, lte: range.end } } : {}) },
    include: editInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(serializeEdit);
}

// ---------- CSV import ----------

/** Minimal RFC 4180 parser: commas, quoted fields with "" escapes, CRLF or LF. Blank lines dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const HEADERS: Record<string, "employee" | "date" | "checkIn" | "checkOut" | "reason"> = {
  employee: "employee",
  empcode: "employee",
  employeecode: "employee",
  email: "employee",
  date: "date",
  checkin: "checkIn",
  in: "checkIn",
  checkout: "checkOut",
  out: "checkOut",
  reason: "reason",
  note: "reason",
};

/** "9:05", "09:05", "09:05:30" -> "09:05"; null if not a valid time. */
export function normalizeTime(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export type ImportRowResult = {
  line: number;
  employee: { id: string; name: string; empCode: string } | null;
  date: string;
  checkIn: string;
  checkOut: string;
  action: "create" | "update" | "unchanged" | "error";
  error?: string;
};

/**
 * Checks every row of an attendance CSV (columns: employee code or email, date YYYY-MM-DD,
 * check-in and check-out HH:mm in the employee's zone, optional reason) and, unless `dryRun`,
 * applies them. All-or-nothing: any row error means nothing is applied.
 */
export async function importAttendance(csv: string, actorId: string, opts: { dryRun: boolean; reason?: string }, now = new Date()) {
  const [header, ...data] = parseCsv(csv);
  if (!header) throw badRequest("The file is empty", "EMPTY_FILE");
  const cols = header.map((h) => HEADERS[h.trim().toLowerCase().replace(/[\s_-]/g, "")]);
  for (const need of ["employee", "date", "checkIn", "checkOut"] as const) {
    if (!cols.includes(need)) throw badRequest(`Missing column "${need}". Expected: employee, date, checkIn, checkOut[, reason]`, "MISSING_COLUMN");
  }
  if (data.length === 0) throw badRequest("The file has no rows", "EMPTY_FILE");
  if (data.length > MAX_IMPORT_ROWS) throw badRequest(`Up to ${MAX_IMPORT_ROWS} rows per import; split the file`, "TOO_MANY_ROWS");
  const cell = (r: string[], k: string) => (r[cols.indexOf(k as never)] ?? "").trim();

  const keys = [...new Set(data.map((r) => cell(r, "employee")).filter(Boolean))];
  const employees = await db.employee.findMany({
    where: { OR: [{ empCode: { in: keys, mode: "insensitive" } }, { email: { in: keys, mode: "insensitive" } }] },
    select: { id: true, empCode: true, email: true, firstName: true, lastName: true, joinDate: true },
  });
  const byKey = new Map<string, (typeof employees)[number]>();
  for (const e of employees) {
    byKey.set(e.empCode.toLowerCase(), e);
    byKey.set(e.email.toLowerCase(), e);
  }

  const tzCache = new Map<string, Promise<string>>();
  const tzOf = (id: string) => tzCache.get(id) ?? (tzCache.set(id, employeeTimeZone(id)), tzCache.get(id)!);

  const seen = new Set<string>();
  const rows: (ImportRowResult & { times?: Times; reason?: string })[] = [];
  for (const [i, r] of data.entries()) {
    const key = cell(r, "employee");
    const date = cell(r, "date");
    const checkIn = normalizeTime(cell(r, "checkIn"));
    const checkOut = normalizeTime(cell(r, "checkOut"));
    const e = byKey.get(key.toLowerCase()) ?? null;
    const row: (typeof rows)[number] = {
      line: i + 2,
      employee: e && { id: e.id, name: `${e.firstName} ${e.lastName}`, empCode: e.empCode },
      date,
      checkIn: checkIn ?? cell(r, "checkIn"),
      checkOut: checkOut ?? cell(r, "checkOut"),
      action: "error",
    };
    rows.push(row);
    const fail = (msg: string) => void (row.error = msg);
    if (!e) {
      fail(key ? `No employee with code or email "${key}"` : "Employee is empty");
      continue;
    }
    if (e.id === actorId) {
      fail("You can't import your own attendance");
      continue;
    }
    if (!isIsoDate(date)) {
      fail("Date must be YYYY-MM-DD");
      continue;
    }
    if (!checkIn || !checkOut) {
      fail("Check-in and check-out must be HH:mm");
      continue;
    }
    if (date < toIsoDate(e.joinDate)) {
      fail("Before the employee's join date");
      continue;
    }
    if (seen.has(`${e.id}|${date}`)) {
      fail("Same employee and date appear earlier in the file");
      continue;
    }
    seen.add(`${e.id}|${date}`);
    try {
      row.times = resolveTimes(date, checkIn, checkOut, await tzOf(e.id), now);
    } catch (err) {
      fail(err instanceof Error ? err.message : "Invalid times");
      continue;
    }
    row.reason = cell(r, "reason") || opts.reason || "CSV import";
  }

  // Label the valid rows against what's recorded now.
  const valid = rows.filter((r) => r.times);
  const existing = valid.length
    ? await db.attendanceLog.findMany({
        where: { OR: valid.map((r) => ({ employeeId: r.employee!.id, date: parseIsoDate(r.date) })) },
        select: { employeeId: true, date: true, checkIn: true, checkOut: true, workedMinutes: true },
      })
    : [];
  const current = new Map(existing.map((l) => [`${l.employeeId}|${toIsoDate(l.date)}`, snapshot(l)]));
  for (const r of valid) {
    const was = current.get(`${r.employee!.id}|${r.date}`) ?? null;
    const next: DaySnapshot = { checkIn: r.times!.inAt.toISOString(), checkOut: r.times!.outAt.toISOString(), workedMinutes: workedMinutes(r.times!.inAt, r.times!.outAt) };
    r.action = !was ? "create" : sameSnapshot(was, next) ? "unchanged" : "update";
  }

  const errors = rows.filter((r) => r.action === "error").length;
  const toApply = valid.filter((r) => r.action !== "unchanged");
  const result = (applied: number) => ({
    rows: rows.map((r) => ({ line: r.line, employee: r.employee, date: r.date, checkIn: r.checkIn, checkOut: r.checkOut, action: r.action, error: r.error })),
    summary: {
      total: rows.length,
      create: rows.filter((r) => r.action === "create").length,
      update: rows.filter((r) => r.action === "update").length,
      unchanged: rows.filter((r) => r.action === "unchanged").length,
      errors,
    },
    applied,
  });
  if (opts.dryRun) return result(0);
  if (errors > 0) throw badRequest(`${errors} row(s) have errors; fix them and preview again`, "IMPORT_HAS_ERRORS");

  // Shift context once per employee over their dates, then write a few days at a time.
  const ctxCache = new Map<string, Promise<ShiftContext>>();
  for (const id of new Set(toApply.map((r) => r.employee!.id))) {
    const dates = toApply.filter((r) => r.employee!.id === id).map((r) => r.date).sort();
    ctxCache.set(id, tzOf(id).then((tz) => shiftContext(id, parseIsoDate(dates[0]), parseIsoDate(dates[dates.length - 1]), tz)));
  }
  let applied = 0;
  const perEmployee = new Map<string, number>();
  for (let i = 0; i < toApply.length; i += 5) {
    const batch = toApply.slice(i, i + 5);
    const done = await Promise.all(
      batch.map(async (r) =>
        writeDay({ employeeId: r.employee!.id, date: r.date, times: r.times!, reason: r.reason!, ctx: await ctxCache.get(r.employee!.id)! }, actorId, "IMPORT"),
      ),
    );
    done.forEach((edit, j) => {
      if (!edit) return;
      applied++;
      const id = batch[j].employee!.id;
      perEmployee.set(id, (perEmployee.get(id) ?? 0) + 1);
    });
  }
  // One notification per person, not per day.
  for (const [id, n] of perEmployee) {
    await notify([id], { type: "ATTENDANCE_EDITED", title: `${n} day${n === 1 ? "" : "s"} of your attendance ${n === 1 ? "was" : "were"} imported`, body: opts.reason, link: MY_ATTENDANCE, actorId });
  }
  return result(applied);
}
