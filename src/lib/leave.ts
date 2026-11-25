import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { badRequest, conflict, notFound, forbidden } from "./errors";
import { eachDay, isWeekend, parseIsoDate, toIsoDate, todayIso } from "./dates";

export type DayPart = "FULL" | "FIRST_HALF" | "SECOND_HALF";

// ---------- Pure rules (unit tested) ----------

/**
 * Working days a leave consumes: weekdays in [from, to] that aren't holidays.
 * Half-day leave must be a single day and counts 0.5.
 */
export function countLeaveDays(from: Date, to: Date, dayPart: DayPart, holidays: Set<string>): number {
  if (to < from) throw badRequest("End date is before start date", "INVALID_RANGE");
  if (dayPart !== "FULL" && toIsoDate(from) !== toIsoDate(to)) {
    throw badRequest("Half-day leave must start and end on the same date", "HALF_DAY_RANGE");
  }
  const working = eachDay(from, to).filter((d) => !isWeekend(d) && !holidays.has(toIsoDate(d))).length;
  if (dayPart !== "FULL") return working === 0 ? 0 : 0.5;
  return working;
}

export type BalanceLike = { granted: number; used: number; pending: number };

export function availableBalance(b: BalanceLike): number {
  return round1(b.granted - b.used - b.pending);
}

export function assertSufficientBalance(b: BalanceLike, requested: number) {
  const available = availableBalance(b);
  if (requested > available) {
    throw badRequest(`Insufficient balance: ${available} day(s) available, ${requested} requested`, "INSUFFICIENT_BALANCE");
  }
}

/**
 * Days of a leave type granted for `year`. In the join year the quota is prorated by
 * whole months remaining (a join on or before the 15th counts that month), rounded
 * to the nearest half day; before the join year nothing is granted.
 */
export function grantForYear(annualQuota: number, year: number, joinDate: Date): number {
  const joinYear = joinDate.getUTCFullYear();
  if (year < joinYear) return 0;
  if (year > joinYear) return annualQuota;
  const monthsLeft = 12 - joinDate.getUTCMonth() - (joinDate.getUTCDate() > 15 ? 1 : 0);
  return Math.round(((annualQuota * monthsLeft) / 12) * 2) / 2;
}

export type YearBalance = { year: number; granted: number; used: number };

/**
 * Unused balance carried into `year` from the years before it: each year passes on
 * max(0, granted + carriedIn - used), optionally capped. Computed rather than stored,
 * so a late approval of last year's leave still corrects this year's carry.
 */
export function carriedInto(rows: readonly YearBalance[], year: number, cap: number | null = null): number {
  const prior = rows.filter((r) => r.year < year).sort((a, b) => a.year - b.year);
  let carry = 0;
  for (const r of prior) {
    carry = Math.max(0, round1(r.granted + carry - r.used));
    if (cap !== null) carry = Math.min(carry, cap);
  }
  return carry;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const num = (d: Prisma.Decimal | number) => Number(d);

// ---------- Data access ----------

export async function holidaySet(locationId: string | null, from: Date, to: Date): Promise<Set<string>> {
  const rows = await db.holiday.findMany({
    where: { date: { gte: from, lte: to }, OR: [{ locationId: null }, ...(locationId ? [{ locationId }] : [])] },
    select: { date: true },
  });
  return new Set(rows.map((r) => toIsoDate(r.date)));
}

const currentYear = () => Number(todayIso().slice(0, 4));

/**
 * Creates any missing LeaveBalance rows for the employee, for every active leave type,
 * up to `year`. Each type starts at its own first row for this employee; a type with
 * none (a new employee, or a leave type added later) starts at this year (or the join
 * year, if later), so adding a type never grants it retroactively. Gaps between the
 * start and `year` (e.g. a year nobody opened the app) are filled with that year's grant.
 * Idempotent and race-safe (skipDuplicates on the unique key), so new employees, new
 * leave types and a new calendar year all get balances on first use without a cron.
 * Never creates rows more than one year ahead.
 */
export async function ensureBalances(employeeId: string, year: number) {
  const thisYear = currentYear();
  if (year > thisYear + 1) return;
  const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { joinDate: true } });
  if (!employee) return;
  const joinYear = employee.joinDate.getUTCFullYear();
  const [types, existing] = await Promise.all([
    db.leaveType.findMany({ where: { active: true }, select: { id: true, annualQuota: true } }),
    db.leaveBalance.findMany({ where: { employeeId, year: { lte: year } }, select: { leaveTypeId: true, year: true } }),
  ]);

  const have = new Set(existing.map((b) => `${b.leaveTypeId}:${b.year}`));
  const data = [];
  for (const t of types) {
    const years = existing.filter((b) => b.leaveTypeId === t.id).map((b) => b.year);
    const start = Math.max(joinYear, years.length ? Math.min(...years) : Math.min(year, thisYear));
    for (let y = start; y <= year; y++) {
      if (have.has(`${t.id}:${y}`)) continue;
      data.push({ employeeId, leaveTypeId: t.id, year: y, granted: grantForYear(num(t.annualQuota), y, employee.joinDate), used: 0 });
    }
  }
  if (data.length) await db.leaveBalance.createMany({ data, skipDuplicates: true });
}

type BalanceRow = { leaveTypeId: string; year: number; granted: Prisma.Decimal; used: Prisma.Decimal };

/** This year's grant plus whatever carries in from earlier years (carry-forward types only). */
function entitlement(
  rows: readonly BalanceRow[],
  type: { id: string; carryForward: boolean; maxCarryForward: Prisma.Decimal | null },
  year: number,
) {
  const mine = rows
    .filter((r) => r.leaveTypeId === type.id)
    .map((r) => ({ year: r.year, granted: num(r.granted), used: num(r.used) }));
  const row = mine.find((r) => r.year === year);
  const cap = type.maxCarryForward === null ? null : num(type.maxCarryForward);
  const carried = type.carryForward ? carriedInto(mine, year, cap) : 0;
  return { annualGrant: row?.granted ?? 0, carried, used: row?.used ?? 0 };
}

/** Balances per leave type for a year (including carried-forward days), with pending days reserved. */
export async function getBalances(employeeId: string, year: number) {
  await ensureBalances(employeeId, year);
  const [types, balances, pending] = await Promise.all([
    db.leaveType.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.leaveBalance.findMany({ where: { employeeId, year: { lte: year } } }),
    db.leaveRequest.groupBy({
      by: ["leaveTypeId"],
      where: {
        employeeId,
        status: "PENDING",
        fromDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      },
      _sum: { days: true },
    }),
  ]);
  return types.map((t) => {
    const { annualGrant, carried, used } = entitlement(balances, t, year);
    const p = pending.find((x) => x.leaveTypeId === t.id)?._sum.days;
    const pend = p ? num(p) : 0;
    const granted = round1(annualGrant + carried);
    const available = availableBalance({ granted, used, pending: pend });
    return {
      leaveTypeId: t.id,
      code: t.code,
      name: t.name,
      paid: t.paid,
      // Unpaid types (e.g. Loss of Pay) aren't limited by a balance; usage is still tracked.
      unlimited: !t.paid,
      annualGrant,
      carriedForward: carried,
      // Total entitlement for the year: annualGrant + carriedForward.
      granted,
      used,
      pending: pend,
      available: t.paid ? available : Math.max(0, available),
    };
  });
}

export type ApplyInput = {
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  dayPart: DayPart;
  reason: string;
};

export async function applyLeave(employeeId: string, input: ApplyInput) {
  const from = parseIsoDate(input.fromDate);
  const to = parseIsoDate(input.toDate);
  if (from.getUTCFullYear() !== to.getUTCFullYear()) {
    throw badRequest("A leave request can't span two calendar years; split it into two requests", "CROSS_YEAR");
  }
  const [employee, type] = await Promise.all([
    db.employee.findUnique({ where: { id: employeeId } }),
    db.leaveType.findUnique({ where: { id: input.leaveTypeId } }),
  ]);
  if (!employee || employee.status !== "ACTIVE") throw notFound("Employee");
  if (!type || !type.active) throw notFound("Leave type");
  if (input.dayPart !== "FULL" && !type.allowHalfDay) {
    throw badRequest(`${type.name} can't be taken as a half day`, "HALF_DAY_NOT_ALLOWED");
  }

  const days = countLeaveDays(from, to, input.dayPart, await holidaySet(employee.locationId, from, to));
  if (days === 0) throw badRequest("Selected dates fall on weekends or holidays only", "NO_WORKING_DAYS");

  const overlap = await db.leaveRequest.findFirst({
    where: {
      employeeId,
      status: { in: ["PENDING", "APPROVED"] },
      fromDate: { lte: to },
      toDate: { gte: from },
    },
  });
  if (overlap) throw conflict("You already have leave booked on some of these dates", "OVERLAP");

  const balance = (await getBalances(employeeId, from.getUTCFullYear())).find((b) => b.leaveTypeId === type.id)!;
  // Unpaid leave (Loss of Pay) isn't limited by a balance.
  if (type.paid) assertSufficientBalance(balance, days);

  return db.leaveRequest.create({
    data: {
      employeeId,
      leaveTypeId: type.id,
      fromDate: from,
      toDate: to,
      dayPart: input.dayPart,
      days,
      reason: input.reason,
      approverId: employee.reportingManagerId,
    },
  });
}

/** Approve: deduct balance atomically. Re-checks balance in case it changed. */
export async function approveLeave(requestId: string, deciderId: string, note?: string) {
  const pre = await db.leaveRequest.findUnique({ where: { id: requestId }, select: { employeeId: true, fromDate: true } });
  if (pre) await ensureBalances(pre.employeeId, pre.fromDate.getUTCFullYear());
  return db.$transaction(async (tx) => {
    const r = await tx.leaveRequest.findUnique({ where: { id: requestId }, include: { leaveType: true } });
    if (!r) throw notFound("Leave request");
    if (r.status !== "PENDING") throw conflict(`Request is already ${r.status.toLowerCase()}`, "NOT_PENDING");
    const year = r.fromDate.getUTCFullYear();
    // Unpaid leave (Loss of Pay) isn't limited by a balance; paid leave re-checks it, carry-forward included.
    if (r.leaveType.paid) {
      const rows = await tx.leaveBalance.findMany({
        where: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year: { lte: year } },
      });
      const { annualGrant, carried, used } = entitlement(rows, r.leaveType, year);
      assertSufficientBalance({ granted: annualGrant + carried, used, pending: 0 }, num(r.days));
    }
    await tx.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year } },
      create: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year, granted: 0, used: r.days },
      update: { used: { increment: r.days } },
    });
    return tx.leaveRequest.update({
      where: { id: r.id },
      data: { status: "APPROVED", approverId: deciderId, decisionNote: note, decidedAt: new Date() },
    });
  });
}

export async function rejectLeave(requestId: string, deciderId: string, note?: string) {
  const r = await db.leaveRequest.findUnique({ where: { id: requestId } });
  if (!r) throw notFound("Leave request");
  if (r.status !== "PENDING") throw conflict(`Request is already ${r.status.toLowerCase()}`, "NOT_PENDING");
  return db.leaveRequest.update({
    where: { id: r.id },
    data: { status: "REJECTED", approverId: deciderId, decisionNote: note, decidedAt: new Date() },
  });
}

/** Applicant cancels. Approved leave can only be cancelled before it starts; balance is restored. */
export async function cancelLeave(requestId: string, employeeId: string) {
  return db.$transaction(async (tx) => {
    const r = await tx.leaveRequest.findUnique({ where: { id: requestId } });
    if (!r) throw notFound("Leave request");
    if (r.employeeId !== employeeId) throw forbidden("You can only cancel your own leave");
    if (r.status === "PENDING") {
      return tx.leaveRequest.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
    }
    if (r.status !== "APPROVED") throw conflict(`Request is already ${r.status.toLowerCase()}`, "NOT_CANCELLABLE");
    if (toIsoDate(r.fromDate) <= todayIso()) {
      throw conflict("Leave that has already started can't be cancelled", "ALREADY_STARTED");
    }
    await tx.leaveBalance.update({
      where: {
        employeeId_leaveTypeId_year: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year: r.fromDate.getUTCFullYear() },
      },
      data: { used: { decrement: r.days } },
    });
    return tx.leaveRequest.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
  });
}

export const leaveRequestInclude = {
  leaveType: { select: { id: true, name: true, code: true } },
  employee: { select: { id: true, firstName: true, lastName: true, empCode: true } },
  approver: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.LeaveRequestInclude;

export function serializeLeaveRequest(r: Prisma.LeaveRequestGetPayload<{ include: typeof leaveRequestInclude }>) {
  return {
    id: r.id,
    employee: { id: r.employee.id, name: `${r.employee.firstName} ${r.employee.lastName}`, empCode: r.employee.empCode },
    leaveType: r.leaveType,
    fromDate: toIsoDate(r.fromDate),
    toDate: toIsoDate(r.toDate),
    dayPart: r.dayPart,
    days: num(r.days),
    reason: r.reason,
    status: r.status,
    approver: r.approver ? { id: r.approver.id, name: `${r.approver.firstName} ${r.approver.lastName}` } : null,
    decisionNote: r.decisionNote,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
