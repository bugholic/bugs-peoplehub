import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_leave_shorten";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: ORG }) }));

import { db, dbUnscoped } from "../db";
import { shortenLeave, workingDates } from "../leave";
import { addDays, parseIsoDate, toIsoDate, todayIso } from "../dates";
import { leaveShortenSchema } from "../validators";

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.leaveRequest.deleteMany({ where });
  await dbUnscoped.leaveBalance.deleteMany({ where });
  await dbUnscoped.employee.deleteMany({ where });
  await dbUnscoped.leaveType.deleteMany({ where });
}

describe("leaveShortenSchema", () => {
  it("needs a valid ISO date", () => {
    expect(leaveShortenSchema.safeParse({ returnOn: "2026-12-01" }).success).toBe(true);
    expect(leaveShortenSchema.safeParse({ returnOn: "tomorrow" }).success).toBe(false);
  });
});

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
describe.skipIf(!process.env.DATABASE_URL)("shortening approved leave (T18, against the DB)", () => {
  let cl: string;
  let el: string;
  let emp: string;
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const iso = (n: number) => toIsoDate(addDays(parseIsoDate(today), n));
  // Working days from 3 days ago to 14 days ahead: some already taken, most still to come.
  const all = workingDates(parseIsoDate(iso(-3)), parseIsoDate(iso(14)), new Set());

  const used = async (leaveTypeId: string) => Number((await db.leaveBalance.findFirstOrThrow({ where: { employeeId: emp, leaveTypeId, year } })).used);
  const setUsed = (leaveTypeId: string, n: number) => db.leaveBalance.updateMany({ where: { employeeId: emp, leaveTypeId, year }, data: { used: n } });
  const leave = (leaveTypeId: string, dates: string[], extra: object = {}) =>
    db.leaveRequest.create({
      data: { employeeId: emp, leaveTypeId, fromDate: parseIsoDate(dates[0]), toDate: parseIsoDate(dates[dates.length - 1]), days: dates.length, reason: "trip", status: "APPROVED", ...extra },
    });

  beforeAll(async () => {
    await cleanup();
    cl = (await db.leaveType.create({ data: { name: "Casual", code: "CL", annualQuota: 30 } })).id;
    el = (await db.leaveType.create({ data: { name: "Earned", code: "EL", annualQuota: 30 } })).id;
    emp = (await db.employee.create({ data: { empCode: "e1", firstName: "e1", lastName: "T", email: "e1@t.test", joinDate: parseIsoDate("2020-01-01") } })).id;
    for (const t of [cl, el]) await db.leaveBalance.create({ data: { employeeId: emp, leaveTypeId: t, year, granted: 30, used: 0 } });
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  it("trims a combined leave that has started, keeping the days already taken", async () => {
    const k = 5;
    const groupId = "grp-1";
    const first = await leave(cl, all.slice(0, k), { groupId });
    const second = await leave(el, all.slice(k), { groupId });
    await setUsed(cl, k);
    await setUsed(el, all.length - k);

    // Back to work on the 3rd working day of the Earned part: its first two days stay.
    const returnOn = all[k + 2];
    const r = await shortenLeave(second.id, returnOn);
    expect(r).toEqual({ freedDays: all.length - k - 2, cancelled: false, lastDay: all[k + 1] });

    const [a, b] = await Promise.all([db.leaveRequest.findUniqueOrThrow({ where: { id: first.id } }), db.leaveRequest.findUniqueOrThrow({ where: { id: second.id } })]);
    expect([a.status, Number(a.days)]).toEqual(["APPROVED", k]); // untouched
    expect([b.status, Number(b.days), toIsoDate(b.toDate)]).toEqual(["APPROVED", 2, all[k + 1]]);
    expect(await used(cl)).toBe(k);
    expect(await used(el)).toBe(2);
  });

  it("cancels the parts that start on or after the cut", async () => {
    await db.leaveRequest.deleteMany({});
    const groupId = "grp-2";
    const a = await leave(cl, all.slice(0, 6), { groupId });
    const b = await leave(el, all.slice(6), { groupId });
    await setUsed(cl, 6);
    await setUsed(el, all.length - 6);

    const r = await shortenLeave(a.id, all[4]); // cut inside the first part: second part goes entirely
    expect(r).toEqual({ freedDays: 2 + (all.length - 6), cancelled: false, lastDay: all[3] });
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CANCELLED");
    expect(await used(cl)).toBe(4);
    expect(await used(el)).toBe(0);
  });

  it("cancels everything for a revoke of leave that hasn't started", async () => {
    await db.leaveRequest.deleteMany({});
    const future = all.filter((d) => d > today).slice(0, 3);
    const r0 = await leave(cl, future);
    await setUsed(cl, 3);
    const r = await shortenLeave(r0.id, future[0], "Project deadline", "mgr-id");
    expect(r).toEqual({ freedDays: 3, cancelled: true, lastDay: null });
    const row = await db.leaveRequest.findUniqueOrThrow({ where: { id: r0.id } });
    expect([row.status, row.decisionNote]).toEqual(["CANCELLED", "Project deadline"]);
    expect(await used(cl)).toBe(0);
  });

  it("refuses the past, pending leave and a cut after the end", async () => {
    await db.leaveRequest.deleteMany({});
    const future = all.filter((d) => d > today).slice(0, 3);
    const ok = await leave(cl, future);
    await expect(shortenLeave(ok.id, iso(-1))).rejects.toMatchObject({ code: "PAST_DATE" });
    await expect(shortenLeave(ok.id, iso(30))).rejects.toMatchObject({ code: "NOTHING_TO_RELEASE" });
    const pending = await leave(cl, future, { status: "PENDING" });
    await expect(shortenLeave(pending.id, future[1])).rejects.toMatchObject({ code: "NOT_APPROVED" });
  });
});
