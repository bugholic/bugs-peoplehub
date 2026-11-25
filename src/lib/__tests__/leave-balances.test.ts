import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_leave_balances";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: ORG }) }));

import { db, dbUnscoped } from "../db";
import { applyLeave, approveLeave, getBalances } from "../leave";
import { parseIsoDate, todayIso } from "../dates";

const thisYear = Number(todayIso().slice(0, 4));

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.leaveRequest.deleteMany({ where });
  await dbUnscoped.leaveBalance.deleteMany({ where });
  await dbUnscoped.employee.deleteMany({ where });
  await dbUnscoped.leaveType.deleteMany({ where });
}

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
describe.skipIf(!process.env.DATABASE_URL)("leave balances (T1-T4, against the DB)", () => {
  let el: string;
  let lop: string;
  let joiner: string; // joined 1 Aug this year, no balances yet
  let veteran: string; // joined years ago, never had balances (e.g. created by an admin)

  beforeAll(async () => {
    await cleanup();
    el = (await db.leaveType.create({ data: { name: "Earned", code: "EL", annualQuota: 15, carryForward: true, maxCarryForward: 5 } })).id;
    lop = (await db.leaveType.create({ data: { name: "Loss of Pay", code: "LOP", annualQuota: 0, paid: false, allowHalfDay: false } })).id;
    const mk = (n: string, joinDate: string) =>
      db.employee.create({ data: { empCode: n, firstName: n, lastName: "T", email: `${n}@t.test`, joinDate: parseIsoDate(joinDate) } });
    joiner = (await mk("J1", `${thisYear}-08-01`)).id;
    veteran = (await mk("V1", `${thisYear - 3}-01-10`)).id;
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  it("creates prorated balances on first read for an employee with none (A2, A5)", async () => {
    const b = await getBalances(joiner, thisYear);
    const earned = b.find((x) => x.leaveTypeId === el)!;
    expect(earned.annualGrant).toBe(6.5); // 15 * 5/12 = 6.25 -> 6.5
    expect(earned.carriedForward).toBe(0);
    expect(earned.available).toBe(6.5);
  });

  it("starts a pre-existing employee at this year, with no retroactive past years", async () => {
    await getBalances(veteran, thisYear);
    const years = await db.leaveBalance.findMany({ where: { employeeId: veteran }, select: { year: true } });
    expect(new Set(years.map((y) => y.year))).toEqual(new Set([thisYear]));
    const earned = (await getBalances(veteran, thisYear)).find((x) => x.leaveTypeId === el)!;
    expect(earned.annualGrant).toBe(15);
  });

  it("lets unpaid leave (LOP) be applied and approved with a zero balance (A1)", async () => {
    // First Monday of December this year (a working day unless a holiday exists in this test org; none do).
    const dec1 = parseIsoDate(`${thisYear}-12-01`);
    const monday = new Date(dec1.getTime() + ((8 - dec1.getUTCDay()) % 7) * 86_400_000).toISOString().slice(0, 10);
    const req = await applyLeave(joiner, { leaveTypeId: lop, fromDate: monday, toDate: monday, dayPart: "FULL", reason: "test" });
    await approveLeave(req.id, joiner);
    const unpaid = (await getBalances(joiner, thisYear)).find((x) => x.leaveTypeId === lop)!;
    expect(unpaid.unlimited).toBe(true);
    expect(unpaid.used).toBe(1);
    expect(unpaid.available).toBe(0);
  });

  it("rolls into next year with carry-forward, capped by maxCarryForward (A3, T4)", async () => {
    const earned = (await getBalances(joiner, thisYear + 1)).find((x) => x.leaveTypeId === el)!;
    expect(earned.annualGrant).toBe(15);
    expect(earned.carriedForward).toBe(5); // 6.5 unused, capped at 5
    expect(earned.granted).toBe(20);
  });

  it("carries everything when the cap is removed", async () => {
    await db.leaveType.update({ where: { id: el }, data: { maxCarryForward: null } });
    const earned = (await getBalances(joiner, thisYear + 1)).find((x) => x.leaveTypeId === el)!;
    expect(earned.carriedForward).toBe(6.5);
  });

  it("never creates rows more than one year ahead", async () => {
    await getBalances(joiner, thisYear + 2);
    expect(await db.leaveBalance.count({ where: { employeeId: joiner, year: thisYear + 2 } })).toBe(0);
  });
});
