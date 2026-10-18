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

/** Balances per leave type for a year, with pending days reserved. */
export async function getBalances(employeeId: string, year: number) {
  const [types, balances, pending] = await Promise.all([
    db.leaveType.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.leaveBalance.findMany({ where: { employeeId, year } }),
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
    const b = balances.find((x) => x.leaveTypeId === t.id);
    const p = pending.find((x) => x.leaveTypeId === t.id)?._sum.days;
    const granted = b ? num(b.granted) : 0;
    const used = b ? num(b.used) : 0;
    const pend = p ? num(p) : 0;
    return {
      leaveTypeId: t.id,
      code: t.code,
      name: t.name,
      paid: t.paid,
      granted,
      used,
      pending: pend,
      available: availableBalance({ granted, used, pending: pend }),
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
  assertSufficientBalance(balance, days);

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
  return db.$transaction(async (tx) => {
    const r = await tx.leaveRequest.findUnique({ where: { id: requestId } });
    if (!r) throw notFound("Leave request");
    if (r.status !== "PENDING") throw conflict(`Request is already ${r.status.toLowerCase()}`, "NOT_PENDING");
    const year = r.fromDate.getUTCFullYear();
    const bal = await tx.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year } },
    });
    const granted = bal ? num(bal.granted) : 0;
    const used = bal ? num(bal.used) : 0;
    assertSufficientBalance({ granted, used, pending: 0 }, num(r.days));
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
