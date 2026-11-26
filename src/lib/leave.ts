import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { resolveApprover } from "./approvals";
import { employeeTimeZone, locationWeekOff } from "./timezone";
import { badRequest, conflict, notFound, forbidden } from "./errors";
import { eachDay, isWeekend, parseIsoDate, toIsoDate, todayIso } from "./dates";

export type DayPart = "FULL" | "FIRST_HALF" | "SECOND_HALF";

// ---------- Pure rules (unit tested) ----------

/**
 * Working days a leave consumes: weekdays in [from, to] that aren't holidays.
 * Half-day leave must be a single day and counts 0.5.
 */
export function countLeaveDays(from: Date, to: Date, dayPart: DayPart, holidays: Set<string>, weekOff?: string): number {
  if (to < from) throw badRequest("End date is before start date", "INVALID_RANGE");
  if (dayPart !== "FULL" && toIsoDate(from) !== toIsoDate(to)) {
    throw badRequest("Half-day leave must start and end on the same date", "HALF_DAY_RANGE");
  }
  const working = eachDay(from, to).filter((d) => !isWeekend(d, weekOff) && !holidays.has(toIsoDate(d))).length;
  if (dayPart !== "FULL") return working === 0 ? 0 : 0.5;
  return working;
}

/** The working dates (ISO) in [from, to]: days that are neither a week-off nor a holiday. */
export function workingDates(from: Date, to: Date, holidays: Set<string>, weekOff?: string): string[] {
  return eachDay(from, to)
    .filter((d) => !isWeekend(d, weekOff) && !holidays.has(toIsoDate(d)))
    .map(toIsoDate);
}

export type LeavePart = { leaveTypeId: string; days: number };
export type LeaveSegment = LeavePart & { fromDate: string; toDate: string };

/**
 * Combined leave: lays the parts over the working dates in order (first part takes the
 * first N working days, and so on). Parts are whole days and must add up to the total.
 */
export function splitWorkingDays(dates: readonly string[], parts: readonly LeavePart[]): LeaveSegment[] {
  const total = parts.reduce((a, p) => a + p.days, 0);
  if (parts.some((p) => !Number.isInteger(p.days) || p.days < 1)) {
    throw badRequest("Each part of a combined leave must be a whole number of days", "INVALID_PARTS");
  }
  if (new Set(parts.map((p) => p.leaveTypeId)).size !== parts.length) {
    throw badRequest("Use each leave type once in a combined leave", "DUPLICATE_TYPE");
  }
  if (total !== dates.length) {
    throw badRequest(`The parts add up to ${total} day(s), but the dates cover ${dates.length} working day(s)`, "PARTS_MISMATCH");
  }
  let i = 0;
  return parts.map((p) => {
    const seg = { ...p, fromDate: dates[i], toDate: dates[i + p.days - 1] };
    i += p.days;
    return seg;
  });
}

export type BalanceForSplit = { leaveTypeId: string; paid: boolean; available: number };

/**
 * Suggested split when the chosen type doesn't cover the request: the chosen type first,
 * then other paid types with whole days left (most available first), then unpaid leave.
 * `shortfall` > 0 when even that can't cover it (no unpaid type configured).
 */
export function suggestSplit(total: number, primaryId: string, balances: readonly BalanceForSplit[]) {
  const primary = balances.find((b) => b.leaveTypeId === primaryId);
  const whole = (b: BalanceForSplit) => (b.paid ? Math.max(0, Math.floor(b.available)) : Infinity);
  const order = [
    ...(primary ? [primary] : []),
    ...balances.filter((b) => b.paid && b.leaveTypeId !== primaryId).sort((a, b) => b.available - a.available),
    ...balances.filter((b) => !b.paid && b.leaveTypeId !== primaryId),
  ];
  const parts: LeavePart[] = [];
  let left = total;
  for (const b of order) {
    if (left === 0) break;
    const take = Math.min(left, whole(b));
    if (take > 0) {
      parts.push({ leaveTypeId: b.leaveTypeId, days: take });
      left -= take;
    }
  }
  return { parts, shortfall: left };
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
/** Holidays and the week-off pattern at a location, as [holidays, weekOff] for countLeaveDays / workingDates. */
export async function offDays(locationId: string | null, from: Date, to: Date): Promise<[Set<string>, string]> {
  return Promise.all([holidaySet(locationId, from, to), locationWeekOff(locationId)]);
}

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

  const days = countLeaveDays(from, to, input.dayPart, ...(await offDays(employee.locationId, from, to)));
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
      approverId: await resolveApprover(employeeId, "leave"),
    },
  });
}

export type CombinedApplyInput = { fromDate: string; toDate: string; reason: string; parts: LeavePart[] };

async function assertApplicable(employeeId: string, from: Date, to: Date) {
  if (from.getUTCFullYear() !== to.getUTCFullYear()) {
    throw badRequest("A leave request can't span two calendar years; split it into two requests", "CROSS_YEAR");
  }
  if (to < from) throw badRequest("End date is before start date", "INVALID_RANGE");
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee || employee.status !== "ACTIVE") throw notFound("Employee");
  return employee;
}

/**
 * What a request would take, for the apply form: working days, the chosen type's balance
 * and, when that doesn't cover it, a suggested combined split.
 */
export async function previewLeave(employeeId: string, input: Omit<ApplyInput, "reason">) {
  const from = parseIsoDate(input.fromDate);
  const to = parseIsoDate(input.toDate);
  const employee = await assertApplicable(employeeId, from, to);
  const days = countLeaveDays(from, to, input.dayPart, ...(await offDays(employee.locationId, from, to)));
  const balances = await getBalances(employeeId, from.getUTCFullYear());
  const primary = balances.find((b) => b.leaveTypeId === input.leaveTypeId);
  if (!primary) throw notFound("Leave type");
  const covered = !primary.paid || days <= primary.available;
  const suggestion = covered || input.dayPart !== "FULL" ? null : suggestSplit(days, primary.leaveTypeId, balances);
  return {
    days,
    available: primary.unlimited ? null : primary.available,
    covered,
    suggestion,
    balances: balances.map((b) => ({ leaveTypeId: b.leaveTypeId, name: b.name, paid: b.paid, available: b.unlimited ? null : b.available })),
  };
}

/**
 * One application split across leave types (e.g. 12 days Casual + 3 days Earned). Creates
 * one LeaveRequest per part over consecutive working days, sharing a groupId; they're
 * decided and cancelled together. Full days only.
 */
export async function applyCombinedLeave(employeeId: string, input: CombinedApplyInput) {
  const from = parseIsoDate(input.fromDate);
  const to = parseIsoDate(input.toDate);
  const employee = await assertApplicable(employeeId, from, to);
  const types = await db.leaveType.findMany({ where: { id: { in: input.parts.map((p) => p.leaveTypeId) }, active: true } });
  for (const p of input.parts) if (!types.some((t) => t.id === p.leaveTypeId)) throw notFound("Leave type");

  const dates = workingDates(from, to, ...(await offDays(employee.locationId, from, to)));
  if (dates.length === 0) throw badRequest("Selected dates fall on weekends or holidays only", "NO_WORKING_DAYS");
  const segments = splitWorkingDays(dates, input.parts);

  const overlap = await db.leaveRequest.findFirst({
    where: { employeeId, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: to }, toDate: { gte: from } },
  });
  if (overlap) throw conflict("You already have leave booked on some of these dates", "OVERLAP");

  const balances = await getBalances(employeeId, from.getUTCFullYear());
  for (const seg of segments) {
    const type = types.find((t) => t.id === seg.leaveTypeId)!;
    if (!type.paid) continue;
    const b = balances.find((x) => x.leaveTypeId === type.id)!;
    if (seg.days > b.available) {
      throw badRequest(`Insufficient ${type.name} balance: ${b.available} day(s) available, ${seg.days} requested`, "INSUFFICIENT_BALANCE");
    }
  }

  const groupId = randomUUID();
  const approverId = await resolveApprover(employeeId, "leave");
  return db.$transaction(
    segments.map((seg) =>
      db.leaveRequest.create({
        data: {
          employeeId,
          leaveTypeId: seg.leaveTypeId,
          fromDate: parseIsoDate(seg.fromDate),
          toDate: parseIsoDate(seg.toDate),
          dayPart: "FULL",
          days: seg.days,
          reason: input.reason,
          approverId,
          groupId,
        },
      }),
    ),
  );
}

/** The request and, for combined leave, the other parts of its group (in date order). */
export async function requestGroupIds(requestId: string): Promise<string[]> {
  const r = await db.leaveRequest.findUnique({ where: { id: requestId }, select: { id: true, groupId: true } });
  if (!r) throw notFound("Leave request");
  if (!r.groupId) return [r.id];
  const parts = await db.leaveRequest.findMany({ where: { groupId: r.groupId }, select: { id: true }, orderBy: { fromDate: "asc" } });
  return parts.map((x) => x.id);
}

/** Approve: deduct balance atomically. Re-checks balance in case it changed. Combined leave is approved as a whole. */
export async function approveLeave(requestId: string, deciderId: string, note?: string) {
  const ids = await requestGroupIds(requestId);
  const pre = await db.leaveRequest.findUnique({ where: { id: requestId }, select: { employeeId: true, fromDate: true } });
  if (pre) await ensureBalances(pre.employeeId, pre.fromDate.getUTCFullYear());
  return db.$transaction(async (tx) => {
    const parts = await tx.leaveRequest.findMany({ where: { id: { in: ids } }, include: { leaveType: true } });
    const self = parts.find((p) => p.id === requestId);
    if (!self) throw notFound("Leave request");
    if (self.status !== "PENDING") throw conflict(`Request is already ${self.status.toLowerCase()}`, "NOT_PENDING");
    const decidedAt = new Date();
    for (const r of parts.filter((p) => p.status === "PENDING")) await approveOne(tx, r, deciderId, note, decidedAt);
    return tx.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
  }, { timeout: 15_000 }); // a combined leave approves several parts
}

type Tx = Omit<typeof db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
type RequestWithType = Prisma.LeaveRequestGetPayload<{ include: { leaveType: true } }>;

async function approveOne(tx: Tx, r: RequestWithType, deciderId: string, note: string | undefined, decidedAt: Date) {
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
  await tx.leaveRequest.update({
    where: { id: r.id },
    data: { status: "APPROVED", approverId: deciderId, decisionNote: note, decidedAt },
  });
}

export async function rejectLeave(requestId: string, deciderId: string, note?: string) {
  const ids = await requestGroupIds(requestId);
  const r = await db.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (r.status !== "PENDING") throw conflict(`Request is already ${r.status.toLowerCase()}`, "NOT_PENDING");
  // Guarded on PENDING so a concurrent decision can't be overwritten.
  await db.leaveRequest.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status: "REJECTED", approverId: deciderId, decisionNote: note, decidedAt: new Date() },
  });
  return db.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
}

/** Applicant cancels. Approved leave can only be cancelled before it starts; balance is restored. */
export async function cancelLeave(requestId: string, employeeId: string) {
  const ids = await requestGroupIds(requestId);
  const today = todayIso(new Date(), await employeeTimeZone(employeeId));
  return db.$transaction(async (tx) => {
    const parts = await tx.leaveRequest.findMany({ where: { id: { in: ids } }, orderBy: { fromDate: "asc" } });
    const self = parts.find((p) => p.id === requestId);
    if (!self) throw notFound("Leave request");
    if (self.employeeId !== employeeId) throw forbidden("You can only cancel your own leave");
    if (self.status !== "PENDING" && self.status !== "APPROVED") {
      throw conflict(`Request is already ${self.status.toLowerCase()}`, "NOT_CANCELLABLE");
    }
    // Combined leave is one application: it can't be cancelled once its first day has started.
    if (self.status === "APPROVED" && toIsoDate(parts[0].fromDate) <= today) {
      throw conflict("Leave that has already started can't be cancelled", "ALREADY_STARTED");
    }
    for (const r of parts) {
      if (r.status === "APPROVED") {
        await tx.leaveBalance.update({
          where: {
            employeeId_leaveTypeId_year: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year: r.fromDate.getUTCFullYear() },
          },
          data: { used: { decrement: r.days } },
        });
      }
    }
    await tx.leaveRequest.updateMany({ where: { id: { in: ids }, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "CANCELLED" } });
    return tx.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
  });
}

export type ShortenResult = {
  /** Days given back to the balance(s). */
  freedDays: number;
  /** Every day was released, so the whole application is now CANCELLED. */
  cancelled: boolean;
  /** Last day still on leave; null when cancelled. */
  lastDay: string | null;
};

/**
 * Ends approved leave early: every leave day on or after `returnOn` (the first day back) is
 * released and its balance restored; days already taken stay. Used by the employee to return
 * early and by a manager/HR to revoke leave (authorization is the caller's job). Works on the
 * whole application, so a combined leave is trimmed across its parts, later parts first; if
 * `returnOn` is on or before the first day, the whole application is cancelled.
 * `returnOn` can't be in the past: days already gone can't be rewritten.
 */
export async function shortenLeave(requestId: string, returnOn: string, note?: string, revokedBy?: string): Promise<ShortenResult> {
  const ids = await requestGroupIds(requestId);
  const head = await db.leaveRequest.findUnique({ where: { id: requestId }, include: { employee: { select: { locationId: true } } } });
  if (!head) throw notFound("Leave request");
  if (head.status !== "APPROVED") throw conflict("Only approved leave can be shortened; cancel a pending request instead", "NOT_APPROVED");
  const cut = parseIsoDate(returnOn);
  const today = todayIso(new Date(), await employeeTimeZone(head.employeeId));
  if (returnOn < today) throw badRequest("The first day back can't be in the past", "PAST_DATE");

  const parts = await db.leaveRequest.findMany({ where: { id: { in: ids } }, orderBy: { fromDate: "asc" } });
  const lastDay = toIsoDate(parts[parts.length - 1].toDate);
  if (returnOn > lastDay) throw badRequest("The leave already ends before that date", "NOTHING_TO_RELEASE");

  // Working days of the part that straddles the cut, read before the transaction.
  const straddling = parts.find((p) => p.fromDate < cut && p.toDate >= cut);
  const keep = straddling ? await offDays(head.employee.locationId, straddling.fromDate, new Date(cut.getTime() - 86_400_000)).then(([h, w]) => workingDates(straddling.fromDate, new Date(cut.getTime() - 86_400_000), h, w)) : [];

  return db.$transaction(
    async (tx) => {
      let freed = 0;
      let remainingLast: string | null = null;
      for (const p of parts) {
        if (p.status !== "APPROVED") continue;
        if (p.toDate < cut) {
          remainingLast = toIsoDate(p.toDate); // wholly before the cut: stays
          continue;
        }
        let released = num(p.days);
        if (p.fromDate < cut && keep.length > 0) {
          // This part straddles the cut: keep its working days before it.
          released -= keep.length;
          remainingLast = keep[keep.length - 1];
          await tx.leaveRequest.update({ where: { id: p.id }, data: { toDate: parseIsoDate(remainingLast), days: keep.length } });
        } else {
          await tx.leaveRequest.update({ where: { id: p.id }, data: { status: "CANCELLED" } });
        }
        freed += released;
        await tx.leaveBalance.update({
          where: { employeeId_leaveTypeId_year: { employeeId: p.employeeId, leaveTypeId: p.leaveTypeId, year: p.fromDate.getUTCFullYear() } },
          data: { used: { decrement: released } },
        });
      }
      if (revokedBy && note) {
        await tx.leaveRequest.updateMany({ where: { id: { in: ids } }, data: { decisionNote: note } });
      }
      return { freedDays: freed, cancelled: remainingLast === null, lastDay: remainingLast };
    },
    { timeout: 15_000 },
  );
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
    groupId: r.groupId,
    reason: r.reason,
    status: r.status,
    approver: r.approver ? { id: r.approver.id, name: `${r.approver.firstName} ${r.approver.lastName}` } : null,
    decisionNote: r.decisionNote,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

// ---------- Balance adjustments (ledger) ----------

export const adjustmentInclude = {
  leaveType: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.LeaveBalanceAdjustmentInclude;

export function serializeAdjustment(a: Prisma.LeaveBalanceAdjustmentGetPayload<{ include: typeof adjustmentInclude }>) {
  return {
    id: a.id,
    employeeId: a.employeeId,
    leaveType: a.leaveType,
    year: a.year,
    days: num(a.days),
    kind: a.kind,
    reason: a.reason,
    createdBy: a.createdBy ? { id: a.createdBy.id, name: `${a.createdBy.firstName} ${a.createdBy.lastName}` } : null,
    createdAt: a.createdAt.toISOString(),
  };
}

export type AdjustInput = { employeeId: string; leaveTypeId: string; year: number; days: number; reason: string };

/**
 * Credits (days > 0) or debits (days < 0) an employee's grant for a leave type and year,
 * and records it in the ledger, in one transaction. The grant can't go below zero.
 */
export async function adjustBalance(input: AdjustInput, actorId: string) {
  if (input.days === 0) throw badRequest("An adjustment can't be zero days", "ZERO_ADJUSTMENT");
  if (input.year > currentYear() + 1) throw badRequest("Balances can only be adjusted up to next year", "YEAR_TOO_FAR");
  const [employee, type] = await Promise.all([
    db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } }),
    db.leaveType.findUnique({ where: { id: input.leaveTypeId }, select: { id: true, name: true } }),
  ]);
  if (!employee) throw notFound("Employee");
  if (!type) throw notFound("Leave type");

  await ensureBalances(input.employeeId, input.year);
  const key = { employeeId_leaveTypeId_year: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, year: input.year } };
  return db.$transaction(async (tx) => {
    // Upsert covers years/types ensureBalances doesn't create (e.g. an inactive type, or a year before the first row).
    await tx.leaveBalance.upsert({
      where: key,
      create: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, year: input.year, granted: 0, used: 0 },
      update: {},
    });
    // Increment, then check: concurrent debits can't both pass a read-before-write check.
    const row = await tx.leaveBalance.update({ where: key, data: { granted: { increment: input.days } } });
    if (num(row.granted) < 0) {
      throw badRequest(`That would take the ${type.name} grant below zero (${num(row.granted)} days)`, "NEGATIVE_GRANT");
    }
    return tx.leaveBalanceAdjustment.create({
      data: { ...input, kind: "MANUAL", createdById: actorId },
      include: adjustmentInclude,
    });
  });
}

export type LeaveTypeUpdate = Partial<{
  name: string;
  code: string;
  annualQuota: number;
  paid: boolean;
  carryForward: boolean;
  maxCarryForward: number | null;
  allowHalfDay: boolean;
}>;

/**
 * Updates a leave type. When annualQuota changes, every existing balance row of this
 * type for this year onward has its grant moved by the difference between the new and
 * old (join-year-prorated) grant, so earlier manual adjustments are kept; each change is
 * logged as a QUOTA_CHANGE adjustment. Past years are left as they were.
 */
export async function updateLeaveType(id: string, data: LeaveTypeUpdate, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.leaveType.findUnique({ where: { id } });
    if (!before) throw notFound("Leave type");
    const type = await tx.leaveType.update({ where: { id }, data });
    const oldQuota = num(before.annualQuota);
    const newQuota = num(type.annualQuota);
    if (oldQuota === newQuota) return { type, balancesUpdated: 0 };

    const rows = await tx.leaveBalance.findMany({
      where: { leaveTypeId: id, year: { gte: currentYear() } },
      select: { id: true, employeeId: true, year: true, employee: { select: { joinDate: true } } },
    });
    const changes = rows
      .map((r) => ({ r, delta: round1(grantForYear(newQuota, r.year, r.employee.joinDate) - grantForYear(oldQuota, r.year, r.employee.joinDate)) }))
      .filter((c) => c.delta !== 0);

    // One UPDATE per distinct delta (everyone but join-year rows shares the same one).
    const byDelta = new Map<number, string[]>();
    for (const c of changes) byDelta.set(c.delta, [...(byDelta.get(c.delta) ?? []), c.r.id]);
    for (const [delta, ids] of byDelta) {
      await tx.leaveBalance.updateMany({ where: { id: { in: ids } }, data: { granted: { increment: delta } } });
    }
    if (changes.length) {
      await tx.leaveBalanceAdjustment.createMany({
        data: changes.map((c) => ({
          employeeId: c.r.employeeId,
          leaveTypeId: id,
          year: c.r.year,
          days: c.delta,
          kind: "QUOTA_CHANGE" as const,
          reason: `${type.name} annual quota changed from ${oldQuota} to ${newQuota} days`,
          createdById: actorId,
        })),
      });
    }
    return { type, balancesUpdated: changes.length };
  });
}

/** Ledger entries for an employee, newest first; optionally one year. */
export async function listAdjustments(employeeId: string, year?: number) {
  const rows = await db.leaveBalanceAdjustment.findMany({
    where: { employeeId, ...(year ? { year } : {}) },
    include: adjustmentInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(serializeAdjustment);
}
