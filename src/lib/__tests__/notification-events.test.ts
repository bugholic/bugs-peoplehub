import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_notification_events";
// Clerk: active org for the scoped client, and org memberships (u_hr is an org admin).
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ orgId: ORG }),
  clerkClient: async () => ({
    organizations: {
      getOrganizationMembershipList: async () => ({
        data: [
          { role: "org:admin", publicUserData: { userId: "u_hr" } },
          { role: "org:manager", publicUserData: { userId: "u_mgr" } },
          { role: "org:member", publicUserData: { userId: "u_emp" } },
          { role: "org:member", publicUserData: { userId: "u_solo" } },
          { role: "org:member", publicUserData: { userId: "u_ops" } },
        ],
      }),
    },
  }),
}));

import { db, dbUnscoped } from "../db";
import { applyLeave, approveLeave } from "../leave";
import { employeesWithPermission } from "../access-roles";
import { listNotifications } from "../notifications";
import { onBalanceAdjusted, onLeaveDecided, onLeaveSubmitted, onRemoteSubmitted } from "../notification-events";
import { parseIsoDate, todayIso } from "../dates";

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.notification.deleteMany({ where });
  await dbUnscoped.remoteWorkRequest.deleteMany({ where });
  await dbUnscoped.attendanceLog.deleteMany({ where });
  await dbUnscoped.leaveRequest.deleteMany({ where });
  await dbUnscoped.leaveBalance.deleteMany({ where });
  await dbUnscoped.employee.deleteMany({ where });
  await dbUnscoped.accessRole.deleteMany({ where });
  await dbUnscoped.leaveType.deleteMany({ where });
}

const titles = async (id: string) => (await listNotifications(id)).items.map((n) => n.title);

/** Next Monday at least a week out, so it's a working day in the future. */
function nextMonday(): string {
  const d = parseIsoDate(todayIso());
  const t = new Date(d.getTime() + (7 + ((8 - d.getUTCDay()) % 7)) * 86_400_000);
  return t.toISOString().slice(0, 10);
}

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
describe.skipIf(!process.env.DATABASE_URL)("notification events (T8, against the DB)", () => {
  let cl: string;
  let hr: string;
  let mgr: string;
  let emp: string;
  let solo: string; // no manager
  let ops: string; // member with a custom role granting remote approval

  beforeAll(async () => {
    await cleanup();
    cl = (await db.leaveType.create({ data: { name: "Casual", code: "CL", annualQuota: 12 } })).id;
    const role = await db.accessRole.create({ data: { name: "Ops", permissions: ["attendance.remote_approve"] } });
    const mk = async (n: string, extra: Record<string, unknown> = {}) =>
      (
        await db.employee.create({
          data: { empCode: n, firstName: n, lastName: "T", email: `${n}@t.test`, joinDate: parseIsoDate("2025-01-01"), clerkUserId: `u_${n}`, ...extra },
        })
      ).id;
    hr = await mk("hr");
    mgr = await mk("mgr");
    emp = await mk("emp", { reportingManagerId: mgr });
    solo = await mk("solo");
    ops = await mk("ops", { accessRoleId: role.id });
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  it("resolves who holds a permission from Clerk roles and custom roles", async () => {
    expect(new Set(await employeesWithPermission(ORG, "leave.approve_all"))).toEqual(new Set([hr]));
    expect(new Set(await employeesWithPermission(ORG, "attendance.remote_approve"))).toEqual(new Set([hr, ops]));
    expect(new Set(await employeesWithPermission(ORG, "leave.approve_team"))).toEqual(new Set([hr, mgr]));
  });

  it("sends a new leave request to the applicant's manager only", async () => {
    const day = nextMonday();
    const r = await applyLeave(emp, { leaveTypeId: cl, fromDate: day, toDate: day, dayPart: "FULL", reason: "Family" });
    await onLeaveSubmitted(r.id, ORG);
    expect(await titles(mgr)).toEqual(["emp T requested Casual"]);
    expect(await titles(hr)).toEqual([]);

    await approveLeave(r.id, mgr);
    await onLeaveDecided(r.id, mgr);
    expect(await titles(emp)).toEqual(["Your Casual was approved"]);
    const [n] = (await listNotifications(emp)).items;
    expect(n.link).toBe("/leave?tab=My+requests");
    expect(n.actor?.id).toBe(mgr);
  });

  it("sends leave from someone with no manager to org-wide approvers", async () => {
    const day = nextMonday();
    const r = await applyLeave(solo, { leaveTypeId: cl, fromDate: day, toDate: day, dayPart: "FULL", reason: "Errand" });
    await onLeaveSubmitted(r.id, ORG);
    expect(await titles(hr)).toEqual(["solo T requested Casual"]);
  });

  it("sends remote work to everyone with remote approval", async () => {
    const date = parseIsoDate(todayIso());
    const now = new Date();
    const log = await db.attendanceLog.create({ data: { employeeId: emp, date, checkIn: now, checkOut: now } });
    const rr = await db.remoteWorkRequest.create({
      data: { employeeId: emp, attendanceLogId: log.id, date, checkIn: now, checkOut: now, remoteMinutes: 90 },
    });
    await onRemoteSubmitted(rr.id, ORG);
    expect((await titles(ops))[0]).toBe("emp T worked remotely");
    expect((await titles(hr))[0]).toBe("emp T worked remotely");
  });

  it("tells the employee about a balance adjustment", async () => {
    await onBalanceAdjusted({ employeeId: emp, days: -1.5, reason: "Correction", leaveType: { name: "Casual" }, year: 2026 }, hr);
    expect((await titles(emp))[0]).toBe("Your Casual balance was debited 1.5 days");
  });

  it("never throws, even for a missing request", async () => {
    await expect(onLeaveSubmitted("does-not-exist", ORG)).resolves.toBeUndefined();
  });
});
