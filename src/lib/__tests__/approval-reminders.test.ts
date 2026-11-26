import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_approval_reminders";
// No active org from Clerk, as in a cron request: queries must be scoped by runAsOrganization.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ orgId: null }),
  clerkClient: async () => ({
    organizations: {
      getOrganizationMembershipList: async () => ({
        data: [
          { role: "org:admin", publicUserData: { userId: "r_hr" } },
          { role: "org:manager", publicUserData: { userId: "r_mgr" } },
          { role: "org:member", publicUserData: { userId: "r_emp" } },
          { role: "org:member", publicUserData: { userId: "r_solo" } },
        ],
      }),
    },
  }),
}));

import { db, dbUnscoped, runAsOrganization } from "../db";
import { approvalDigest, remindPendingApprovals } from "../jobs/approval-reminders";
import { parseIsoDate } from "../dates";

describe("approvalDigest", () => {
  it("returns null when nothing is pending", () => {
    expect(approvalDigest({ leave: 0, regularization: 0, remote: 0 })).toBeNull();
  });

  it("summarises counts and links to the busiest tab", () => {
    expect(approvalDigest({ leave: 1, regularization: 3, remote: 0 })).toEqual({
      title: "4 requests waiting for your approval",
      body: "1 leave request · 3 attendance corrections",
      link: "/attendance?tab=Regularizations",
    });
    expect(approvalDigest({ leave: 0, regularization: 0, remote: 1 })).toEqual({
      title: "1 request waiting for your approval",
      body: "1 remote work day",
      link: "/attendance?tab=Remote+work",
    });
  });
});

const inOrg = <T>(fn: () => Promise<T>) => runAsOrganization(ORG, fn);

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.notification.deleteMany({ where });
  await dbUnscoped.remoteWorkRequest.deleteMany({ where });
  await dbUnscoped.attendanceLog.deleteMany({ where });
  await dbUnscoped.regularizationRequest.deleteMany({ where });
  await dbUnscoped.leaveRequest.deleteMany({ where });
  await dbUnscoped.employee.deleteMany({ where });
  await dbUnscoped.leaveType.deleteMany({ where });
}

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
describe.skipIf(!process.env.DATABASE_URL)("remindPendingApprovals (T11, against the DB)", () => {
  const now = new Date();
  const old = new Date(now.getTime() - 2 * 86_400_000);
  let hr: string;
  let mgr: string;
  let emp: string;
  let solo: string;

  beforeAll(async () => {
    await cleanup();
    await inOrg(async () => {
      const cl = (await db.leaveType.create({ data: { name: "Casual", code: "CL", annualQuota: 12 } })).id;
      const mk = async (n: string, extra: Record<string, unknown> = {}) =>
        (
          await db.employee.create({
            data: { empCode: n, firstName: n, lastName: "T", email: `${n}@t.test`, joinDate: parseIsoDate("2025-01-01"), clerkUserId: `r_${n}`, ...extra },
          })
        ).id;
      hr = await mk("hr");
      mgr = await mk("mgr");
      emp = await mk("emp", { reportingManagerId: mgr });
      solo = await mk("solo");

      const day = parseIsoDate("2026-12-14");
      const leave = (employeeId: string, approverId: string | null, createdAt: Date) =>
        db.leaveRequest.create({
          data: { employeeId, approverId, leaveTypeId: cl, fromDate: day, toDate: day, days: 1, reason: "x", createdAt },
        });
      await leave(emp, mgr, old); // -> mgr
      await leave(emp, mgr, now); // too fresh: not counted
      await leave(solo, null, old); // no manager -> org-wide (hr)
      await db.regularizationRequest.create({
        data: { employeeId: emp, approverId: mgr, date: parseIsoDate("2026-11-20"), checkIn: old, checkOut: old, reason: "x", createdAt: old },
      }); // -> mgr
      const log = await db.attendanceLog.create({ data: { employeeId: solo, date: parseIsoDate("2026-11-20") } });
      await db.remoteWorkRequest.create({
        data: { employeeId: solo, attendanceLogId: log.id, date: log.date, checkIn: old, checkOut: old, createdAt: old },
      }); // -> remote approvers (hr)
    });
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  const digestFor = (id: string) =>
    inOrg(() => db.notification.findMany({ where: { recipientId: id, type: "APPROVALS_PENDING" }, select: { title: true, body: true, link: true } }));

  it("the scoped client refuses to run without an org (no Clerk org in a cron request)", async () => {
    await expect(db.employee.count()).rejects.toMatchObject({ code: "NO_ORGANIZATION" });
  });

  it("sends each approver one digest of their stale pending requests", async () => {
    expect(await remindPendingApprovals(ORG, now)).toBe(2);
    expect(await digestFor(mgr)).toEqual([
      { title: "2 requests waiting for your approval", body: "1 leave request · 1 attendance correction", link: "/leave?tab=Approvals" },
    ]);
    expect(await digestFor(hr)).toEqual([
      { title: "2 requests waiting for your approval", body: "1 leave request · 1 remote work day", link: "/leave?tab=Approvals" },
    ]);
    expect(await digestFor(emp)).toEqual([]);
    expect(await digestFor(solo)).toEqual([]); // never asked to approve their own request
  });

  it("doesn't remind the same people again within the cooldown", async () => {
    expect(await remindPendingApprovals(ORG, now)).toBe(0);
  });
});
