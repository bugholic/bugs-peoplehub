import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_approvals";
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ orgId: ORG }),
  clerkClient: async () => ({
    organizations: {
      getOrganizationMembershipList: async () => ({
        data: [
          { role: "org:admin", publicUserData: { userId: "a_ceo" } },
          { role: "org:manager", publicUserData: { userId: "a_vp" } },
          { role: "org:manager", publicUserData: { userId: "a_mgr" } },
          { role: "org:member", publicUserData: { userId: "a_lead" } }, // manages people, but no approve rights
          { role: "org:member", publicUserData: { userId: "a_emp" } },
          { role: "org:member", publicUserData: { userId: "a_x" } },
        ],
      }),
    },
  }),
}));

import { db, dbUnscoped } from "../db";
import { applyLeave } from "../leave";
import { canApproveFor, escalateStaleApprovals, onEmployeeChanged, resolveApprover } from "../approvals";
import { assertCanApprove } from "../authz";
import { defaultPermissions } from "../permissions";
import type { Session } from "../session";
import { parseIsoDate, todayIso } from "../dates";

describe("canApproveFor", () => {
  const c = { id: "e", status: "ACTIVE" as const, clerkUserId: "u", reportingManagerId: null, accessRole: null };
  it("needs an active, signed-up person with approve rights", () => {
    expect(canApproveFor(c, "leave", new Map([["u", "MANAGER"]]))).toBe(true);
    expect(canApproveFor(c, "leave", new Map([["u", "EMPLOYEE"]]))).toBe(false);
    expect(canApproveFor({ ...c, status: "INACTIVE" }, "leave", new Map([["u", "MANAGER"]]))).toBe(false);
    expect(canApproveFor({ ...c, clerkUserId: null }, "leave", new Map([["u", "MANAGER"]]))).toBe(false);
  });
  it("honours a custom role", () => {
    const withRole = { ...c, accessRole: { permissions: ["attendance.approve_team"] } };
    expect(canApproveFor(withRole, "attendance", new Map([["u", "EMPLOYEE"]]))).toBe(true);
    expect(canApproveFor(withRole, "leave", new Map([["u", "EMPLOYEE"]]))).toBe(false);
  });
  it("trusts the reporting line when Clerk roles are unavailable", () => {
    expect(canApproveFor(c, "leave", new Map())).toBe(true);
  });
});

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.notification.deleteMany({ where });
  await dbUnscoped.leaveRequest.deleteMany({ where });
  await dbUnscoped.leaveBalance.deleteMany({ where });
  // Managers are referenced by reportees: clear the links first.
  await dbUnscoped.employee.updateMany({ where, data: { reportingManagerId: null } });
  await dbUnscoped.employee.deleteMany({ where });
  await dbUnscoped.leaveType.deleteMany({ where });
}

function nextMonday(): string {
  const d = parseIsoDate(todayIso());
  return new Date(d.getTime() + (7 + ((8 - d.getUTCDay()) % 7)) * 86_400_000).toISOString().slice(0, 10);
}

const sessionFor = (employeeId: string, role: "MANAGER" | "EMPLOYEE"): Session => ({
  userId: `a_${employeeId}`,
  organizationId: ORG,
  employeeId,
  role,
  name: employeeId,
  accessRole: null,
  permissions: defaultPermissions(role),
});

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
describe.skipIf(!process.env.DATABASE_URL)("approver routing (T12, against the DB)", () => {
  let cl: string;
  let ceo: string;
  let vp: string;
  let mgr: string;
  let lead: string;
  let emp: string;
  let x: string;
  let requestId: string;

  beforeAll(async () => {
    await cleanup();
    cl = (await db.leaveType.create({ data: { name: "Casual", code: "CL", annualQuota: 12 } })).id;
    const mk = async (n: string, managerId: string | null) =>
      (
        await db.employee.create({
          data: {
            empCode: n,
            firstName: n,
            lastName: "T",
            email: `${n}@t.test`,
            joinDate: parseIsoDate("2025-01-01"),
            clerkUserId: `a_${n}`,
            reportingManagerId: managerId,
          },
        })
      ).id;
    ceo = await mk("ceo", null);
    vp = await mk("vp", ceo);
    mgr = await mk("mgr", vp);
    lead = await mk("lead", vp);
    emp = await mk("emp", mgr);
    x = await mk("x", lead);
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  const approverOf = async (id: string) => (await db.leaveRequest.findUniqueOrThrow({ where: { id } })).approverId;
  const titlesFor = async (id: string) =>
    (await db.notification.findMany({ where: { recipientId: id, type: "APPROVAL_ASSIGNED" } })).map((n) => n.title);

  it("routes to the direct manager when they can approve", async () => {
    expect(await resolveApprover(emp, "leave")).toBe(mgr);
  });

  it("skips a manager without approve rights and goes up the line", async () => {
    expect(await resolveApprover(x, "leave")).toBe(vp);
  });

  it("sends the top of the chain to the HR queue (null)", async () => {
    expect(await resolveApprover(ceo, "leave")).toBeNull();
  });

  it("applyLeave stores the resolved approver", async () => {
    const day = nextMonday();
    requestId = (await applyLeave(emp, { leaveTypeId: cl, fromDate: day, toDate: day, dayPart: "FULL", reason: "x" })).id;
    expect(await approverOf(requestId)).toBe(mgr);
  });

  it("lets the assigned approver decide even when they're not the direct manager", async () => {
    // vp isn't emp's direct manager: only allowed once the request is assigned to them.
    await expect(assertCanApprove(sessionFor(vp, "MANAGER"), emp, "leave", mgr)).rejects.toMatchObject({ status: 403 });
    await expect(assertCanApprove(sessionFor(vp, "MANAGER"), emp, "leave", vp)).resolves.toBeUndefined();
    // ...and never without approve rights.
    await expect(assertCanApprove(sessionFor(lead, "EMPLOYEE"), x, "leave", lead)).rejects.toMatchObject({ status: 403 });
  });

  it("moves pending requests off a deactivated approver and tells the new one", async () => {
    await db.employee.update({ where: { id: mgr }, data: { status: "INACTIVE" } });
    expect(await onEmployeeChanged(mgr, { managerChanged: false, deactivated: true })).toBe(1);
    expect(await approverOf(requestId)).toBe(vp);
    expect(await titlesFor(vp)).toEqual(["emp T's Casual request now needs your approval"]);
    await db.employee.update({ where: { id: mgr }, data: { status: "ACTIVE" } });
  });

  it("re-resolves when the applicant's manager changes", async () => {
    await db.employee.update({ where: { id: emp }, data: { reportingManagerId: mgr } });
    expect(await onEmployeeChanged(emp, { managerChanged: true, deactivated: false })).toBe(1);
    expect(await approverOf(requestId)).toBe(mgr);
  });

  it("escalates a stale request one level at a time, then to HR", async () => {
    const now = new Date();
    const stale = new Date(now.getTime() - 4 * 86_400_000);
    await db.leaveRequest.update({ where: { id: requestId }, data: { approverAssignedAt: stale } });
    expect(await escalateStaleApprovals(now, 3)).toEqual({ repaired: 0, escalated: 1 });
    expect(await approverOf(requestId)).toBe(vp);

    // Fresh clock: nothing happens until it's stale again.
    expect(await escalateStaleApprovals(now, 3)).toEqual({ repaired: 0, escalated: 0 });

    await db.leaveRequest.update({ where: { id: requestId }, data: { approverAssignedAt: stale } });
    await escalateStaleApprovals(now, 3);
    expect(await approverOf(requestId)).toBe(ceo);

    await db.leaveRequest.update({ where: { id: requestId }, data: { approverAssignedAt: stale } });
    await escalateStaleApprovals(now, 3);
    expect(await approverOf(requestId)).toBeNull(); // HR queue
    expect((await titlesFor(ceo)).length).toBeGreaterThanOrEqual(2); // escalated to ceo, then to HR (ceo is an org admin)
  });

  it("repairs requests stuck on someone deactivated outside the app flow", async () => {
    await db.leaveRequest.update({ where: { id: requestId }, data: { approverId: lead } });
    await db.employee.update({ where: { id: lead }, data: { status: "INACTIVE" } });
    const res = await escalateStaleApprovals(new Date(), 3);
    expect(res.repaired).toBe(1);
    expect(await approverOf(requestId)).toBe(mgr);
  });
});
