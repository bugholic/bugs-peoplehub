import { db } from "../db";
import { notify } from "../notifications";
import { addDays, formatDate, formatTime, isWeekend, parseIsoDate, toIsoDate, todayIso } from "../dates";
import { employeeTimeZone, organizationTimeZone, organizationWeekOff } from "../timezone";
import { metricsForLog, shiftContext, shiftWindow } from "../shifts";
import { holidaySet } from "../leave";
import { MAX_OVERNIGHT_MS, workedMinutes } from "../attendance";

/**
 * Daily attendance housekeeping (docs/TODO.md T16), run per organization by the cron:
 *  - autoCloseOpenSessions: sessions nobody checked out of are closed, and flagged.
 *  - flagMissingAttendance: people with nothing recorded on their last working day are told.
 * Absence itself is derived on read (src/lib/attendance.ts#deriveDayStatus), so nothing is
 * written for it; the job's job is to make sure the employee knows while it's fixable.
 */

const MY_ATTENDANCE = "/attendance?tab=My+attendance";

function memo<T>(fn: (key: string) => Promise<T>) {
  const cache = new Map<string, Promise<T>>();
  return (key: string) => {
    if (!cache.has(key)) cache.set(key, fn(key));
    return cache.get(key)!;
  };
}

/**
 * Closes sessions still open past the overnight window (a check-out can no longer reach them).
 * Office sessions close at the shift end when there is one and it falls after the check-in;
 * otherwise (no shift, or a remote session that can't be verified) at the check-in, crediting
 * no time. The log is marked `autoClosed` and the employee is asked to correct it.
 */
export async function autoCloseOpenSessions(now = new Date()): Promise<number> {
  const stale = await db.attendanceSession.findMany({
    where: { checkOut: null, checkIn: { lt: new Date(now.getTime() - MAX_OVERNIGHT_MS) } },
    select: { id: true, checkIn: true, workMode: true, attendanceLogId: true, attendanceLog: { select: { employeeId: true, date: true } } },
  });
  const tzOf = memo(employeeTimeZone);
  let closed = 0;

  for (const s of stale) {
    const { employeeId, date } = s.attendanceLog;
    const tz = await tzOf(employeeId);
    const iso = toIsoDate(date);
    if (iso >= todayIso(now, tz)) continue; // still today for them: a long day, not a forgotten one

    const ctx = await shiftContext(employeeId, date, date, tz);
    let closeAt = s.checkIn;
    let how = "at your check-in time, with no time counted";
    if (ctx.shift && s.workMode !== "REMOTE") {
      const { end } = shiftWindow(ctx.shift, iso, tz);
      if (end > s.checkIn && end <= now) {
        closeAt = end;
        how = `at the shift end (${formatTime(end, tz)})`;
      }
    }

    const done = await db.$transaction(
      async (tx) => {
        // Guarded on still-open, in case the employee checked out meanwhile.
        const { count } = await tx.attendanceSession.updateMany({ where: { id: s.id, checkOut: null }, data: { checkOut: closeAt } });
        if (count === 0) return false;
        const log = await tx.attendanceLog.findUniqueOrThrow({
          where: { id: s.attendanceLogId },
          include: { sessions: { select: { checkIn: true, checkOut: true } } },
        });
        const worked = log.workedMinutes + workedMinutes(s.checkIn, closeAt);
        await tx.attendanceLog.update({
          where: { id: log.id },
          data: {
            workedMinutes: worked,
            checkOut: log.checkOut && log.checkOut > closeAt ? log.checkOut : closeAt,
            autoClosed: true,
            ...metricsForLog(ctx, { ...log, workedMinutes: worked }),
          },
        });
        return true;
      },
      { timeout: 15_000 },
    );
    if (!done) continue;
    closed++;
    await notify([employeeId], {
      type: "ATTENDANCE_AUTO_CLOSED",
      title: `You didn't check out on ${formatDate(iso)}`,
      body: `We closed it ${how}. Request a correction if that's wrong.`,
      link: MY_ATTENDANCE,
    });
  }
  return closed;
}

/** The last working day before `today` (skipping week-offs and `holidays`), within a week; null if none. */
export function previousWorkingDay(today: string, holidays: Set<string>, weekOff?: string): string | null {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(parseIsoDate(today), -i);
    if (!isWeekend(d, weekOff) && !holidays.has(toIsoDate(d))) return toIsoDate(d);
  }
  return null;
}

/**
 * Notifies each active, signed-up employee who has nothing on their last working day: no
 * check-in, no approved or pending leave, no pending regularization. Once per day per person.
 */
export async function flagMissingAttendance(now = new Date()): Promise<number> {
  const [employees, orgTz, orgWeekOff] = await Promise.all([
    db.employee.findMany({
      where: { status: "ACTIVE", clerkUserId: { not: null } },
      select: { id: true, joinDate: true, locationId: true, location: { select: { timeZone: true, weekOff: true } } },
    }),
    organizationTimeZone(),
    organizationWeekOff(),
  ]);
  const holidaysAround = memo(async (key: string) => {
    const [locationId, today] = key.split("|");
    const t = parseIsoDate(today);
    return holidaySet(locationId || null, addDays(t, -7), addDays(t, -1));
  });

  const candidates: { employeeId: string; date: string }[] = [];
  for (const e of employees) {
    const today = todayIso(now, e.location?.timeZone ?? orgTz);
    const day = previousWorkingDay(today, await holidaysAround(`${e.locationId ?? ""}|${today}`), e.location?.weekOff ?? orgWeekOff);
    if (day && day >= toIsoDate(e.joinDate)) candidates.push({ employeeId: e.id, date: day });
  }
  if (candidates.length === 0) return 0;

  const ids = [...new Set(candidates.map((c) => c.employeeId))];
  const dates = [...new Set(candidates.map((c) => c.date))].sort();
  const linkFor = (date: string) => `${MY_ATTENDANCE}&missing=${date}`;
  const [logs, leaves, regs, sent] = await Promise.all([
    db.attendanceLog.findMany({
      where: { employeeId: { in: ids }, date: { in: dates.map(parseIsoDate) }, checkIn: { not: null } },
      select: { employeeId: true, date: true },
    }),
    db.leaveRequest.findMany({
      where: {
        employeeId: { in: ids },
        status: { in: ["PENDING", "APPROVED"] },
        fromDate: { lte: parseIsoDate(dates[dates.length - 1]) },
        toDate: { gte: parseIsoDate(dates[0]) },
      },
      select: { employeeId: true, fromDate: true, toDate: true },
    }),
    db.regularizationRequest.findMany({
      where: { employeeId: { in: ids }, status: "PENDING", date: { in: dates.map(parseIsoDate) } },
      select: { employeeId: true, date: true },
    }),
    db.notification.findMany({
      where: { type: "ATTENDANCE_MISSING", recipientId: { in: ids }, link: { in: dates.map(linkFor) } },
      select: { recipientId: true, link: true },
    }),
  ]);

  const has = new Set([
    ...logs.map((l) => `${l.employeeId}|${toIsoDate(l.date)}`),
    ...regs.map((r) => `${r.employeeId}|${toIsoDate(r.date)}`),
    ...sent.map((n) => `${n.recipientId}|${n.link?.split("missing=")[1]}`),
  ]);
  let flagged = 0;
  for (const c of candidates) {
    if (has.has(`${c.employeeId}|${c.date}`)) continue;
    const onLeave = leaves.some((l) => l.employeeId === c.employeeId && toIsoDate(l.fromDate) <= c.date && toIsoDate(l.toDate) >= c.date);
    if (onLeave) continue;
    flagged += await notify([c.employeeId], {
      type: "ATTENDANCE_MISSING",
      title: `No attendance on ${formatDate(c.date)}`,
      body: "Request a correction if you worked, or apply for leave.",
      link: linkFor(c.date),
    });
  }
  return flagged;
}
