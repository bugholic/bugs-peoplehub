import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_leave_combined";
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ orgId: ORG }),
  clerkClient: async () => ({
    organizations: {
      getOrganizationMembershipList: async () => ({
        data: [
          { role: "org:manager", publicUserData: { userId: "lc_mgr" } },
          { role: "org:member", publicUserData: { userId: "lc_emp" } },
        ],
      }),
    },
  }),
}));

import { db, dbUnscoped } from "../db";
import {
  applyCombinedLeave,
  approveLeave,
  cancelLeave,
  getBalances,
  previewLeave,
  rejectLeave,
  splitWorkingDays,
  suggestSplit,
  workingDates,
} from "../leave";
import { addDays, parseIsoDate, toIsoDate, todayIso } from "../dates";

describe("splitWorkingDays", () => {
  const dates = ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-07"];
  it("lays parts over the working days in order", () => {
    expect(splitWorkingDays(dates, [{ leaveTypeId: "cl", days: 3 }, { leaveTypeId: "el", days: 2 }])).toEqual([
      { leaveTypeId: "cl", days: 3, fromDate: "2026-12-01", toDate: "2026-12-03" },
      { leaveTypeId: "el", days: 2, fromDate: "2026-12-04", toDate: "2026-12-07" },
    ]);
  });
  it("rejects parts that don't add up, repeat a type or aren't whole days", () => {
    expect(() => splitWorkingDays(dates, [{ leaveTypeId: "cl", days: 3 }, { leaveTypeId: "el", days: 1 }])).toThrow(/add up to 4/);
    expect(() => splitWorkingDays(dates, [{ leaveTypeId: "cl", days: 3 }, { leaveTypeId: "cl", days: 2 }])).toThrow(/once/);
    expect(() => splitWorkingDays(dates, [{ leaveTypeId: "cl", days: 2.5 }, { leaveTypeId: "el", days: 2.5 }])).toThrow(/whole/);
  });
  it("skips weekends and holidays when listing working dates", () => {
    expect(workingDates(parseIsoDate("2026-12-04"), parseIsoDate("2026-12-08"), new Set(["2026-12-08"]))).toEqual(["2026-12-04", "2026-12-07"]);
  });
});

describe("suggestSplit", () => {
  const balances = [
    { leaveTypeId: "cl", paid: true, available: 12 },
    { leaveTypeId: "sl", paid: true, available: 2.5 },
    { leaveTypeId: "el", paid: true, available: 6 },
    { leaveTypeId: "lop", paid: false, available: 0 },
  ];
  it("uses the chosen type first, then the largest other balances, then unpaid", () => {
    expect(suggestSplit(15, "cl", balances)).toEqual({ parts: [{ leaveTypeId: "cl", days: 12 }, { leaveTypeId: "el", days: 3 }], shortfall: 0 });
    expect(suggestSplit(25, "cl", balances)).toEqual({
      parts: [
        { leaveTypeId: "cl", days: 12 },
        { leaveTypeId: "el", days: 6 },
        { leaveTypeId: "sl", days: 2 },
        { leaveTypeId: "lop", days: 5 },
      ],
      shortfall: 0,
    });
  });
  it("reports a shortfall when there's no unpaid type to absorb the rest", () => {
    expect(suggestSplit(20, "cl", balances.slice(0, 3)).shortfall).toBe(0 + 20 - 12 - 6 - 2);
  });
});

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.notification.deleteMany({ where });
  await dbUnscoped.leaveRequest.deleteMany({ where });
  await dbUnscoped.leaveBalance.deleteMany({ where });
  await dbUnscoped.employee.deleteMany({ where });
  await dbUnscoped.leaveType.deleteMany({ where });
}

/** The Monday at least a week from today, and the working days from it. */
function futureWeek() {
  const t = parseIsoDate(todayIso());
  const monday = addDays(t, 7 + ((8 - t.getUTCDay()) % 7));
  return { from: toIsoDate(monday), to: (n: number) => toIsoDate(addDays(monday, n)) };
}

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
describe.skipIf(!process.env.DATABASE_URL)("combined leave (against the DB)", () => {
  let cl: string;
  let el: string;
  let emp: string;
  let mgr: string;
  const week = futureWeek();
  const year = Number(week.from.slice(0, 4));
  const avail = async (id: string) => (await getBalances(emp, year)).find((b) => b.leaveTypeId === id)!.available;

  beforeAll(async () => {
    await cleanup();
    cl = (await db.leaveType.create({ data: { name: "Casual", code: "CL", annualQuota: 3 } })).id;
    el = (await db.leaveType.create({ data: { name: "Earned", code: "EL", annualQuota: 12 } })).id;
    const mk = async (n: string, managerId: string | null) =>
      (await db.employee.create({ data: { empCode: n, firstName: n, lastName: "T", email: `${n}@t.test`, joinDate: parseIsoDate("2020-01-01"), clerkUserId: `lc_${n}`, reportingManagerId: managerId } })).id;
    mgr = await mk("mgr", null);
    emp = await mk("emp", mgr);
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  it("previews a shortfall with a suggested split", async () => {
    // Mon..Fri = 5 working days; only 3 Casual.
    const p = await previewLeave(emp, { leaveTypeId: cl, fromDate: week.from, toDate: week.to(4), dayPart: "FULL" });
    expect(p).toMatchObject({ days: 5, available: 3, covered: false });
    expect(p.suggestion).toEqual({ parts: [{ leaveTypeId: cl, days: 3 }, { leaveTypeId: el, days: 2 }], shortfall: 0 });
  });

  it("refuses a part above its balance", async () => {
    await expect(
      applyCombinedLeave(emp, { fromDate: week.from, toDate: week.to(4), reason: "trip", parts: [{ leaveTypeId: cl, days: 4 }, { leaveTypeId: el, days: 1 }] }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  let firstId: string;
  it("creates one request per type over consecutive days, sharing a group", async () => {
    const parts = await applyCombinedLeave(emp, {
      fromDate: week.from,
      toDate: week.to(4),
      reason: "trip",
      parts: [{ leaveTypeId: cl, days: 3 }, { leaveTypeId: el, days: 2 }],
    });
    expect(parts).toHaveLength(2);
    expect(new Set(parts.map((x) => x.groupId)).size).toBe(1);
    expect(parts.map((x) => [x.leaveTypeId, toIsoDate(x.fromDate), toIsoDate(x.toDate), Number(x.days), x.approverId])).toEqual([
      [cl, week.from, week.to(2), 3, mgr],
      [el, week.to(3), week.to(4), 2, mgr],
    ]);
    firstId = parts[0].id;
    expect(await avail(cl)).toBe(0); // pending reserves it
    expect(await avail(el)).toBe(10);
  });

  it("blocks overlapping leave on those dates", async () => {
    await expect(
      // Fri + next Mon = 2 working days, overlapping the Friday above.
      applyCombinedLeave(emp, { fromDate: week.to(4), toDate: week.to(7), reason: "x", parts: [{ leaveTypeId: cl, days: 1 }, { leaveTypeId: el, days: 1 }] }),
    ).rejects.toMatchObject({ code: "OVERLAP" });
  });

  it("approves every part together and deducts each balance", async () => {
    await approveLeave(firstId, mgr, "ok");
    const rows = await db.leaveRequest.findMany({ where: { employeeId: emp }, orderBy: { fromDate: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["APPROVED", "APPROVED"]);
    expect(await avail(cl)).toBe(0);
    expect(await avail(el)).toBe(10);
  });

  it("cancels every part and restores both balances", async () => {
    const second = (await db.leaveRequest.findFirstOrThrow({ where: { employeeId: emp, leaveTypeId: el } })).id;
    await cancelLeave(second, emp);
    const rows = await db.leaveRequest.findMany({ where: { employeeId: emp } });
    expect(rows.every((r) => r.status === "CANCELLED")).toBe(true);
    expect(await avail(cl)).toBe(3);
    expect(await avail(el)).toBe(12);
  });

  it("rejects every part together", async () => {
    const parts = await applyCombinedLeave(emp, {
      fromDate: week.from,
      toDate: week.to(4),
      reason: "again",
      parts: [{ leaveTypeId: el, days: 4 }, { leaveTypeId: cl, days: 1 }],
    });
    await rejectLeave(parts[1].id, mgr, "busy week");
    const rows = await db.leaveRequest.findMany({ where: { groupId: parts[0].groupId } });
    expect(rows.map((r) => r.status)).toEqual(["REJECTED", "REJECTED"]);
    expect(await avail(el)).toBe(12);
  });
});
