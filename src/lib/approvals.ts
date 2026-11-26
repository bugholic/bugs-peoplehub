import { currentOrganizationId, db } from "./db";
import { clerkRolesByUser, employeesWithPermission } from "./access-roles";
import { effectivePermissions } from "./permissions";
import { notify } from "./notifications";
import { formatDate } from "./dates";
import type { Role } from "./session";

/**
 * Who decides a request (docs/TODO.md T12).
 *
 * A request's `approverId` is the person it's waiting on; null means the HR queue
 * (everyone holding `<module>.approve_all`). It's resolved from the *current* reporting
 * line: the applicant's manager, or the first person above them who is active, has
 * signed up and holds approve rights for the module. It's re-resolved when the reporting
 * line changes or the approver is deactivated, and moved one level up (finally to HR)
 * when a request sits undecided for too long.
 */

export type ApprovalModule = "leave" | "attendance";

type Candidate = {
  id: string;
  status: "ACTIVE" | "INACTIVE";
  clerkUserId: string | null;
  reportingManagerId: string | null;
  accessRole: { permissions: string[] } | null;
};

const candidateSelect = {
  id: true,
  status: true,
  clerkUserId: true,
  reportingManagerId: true,
  accessRole: { select: { permissions: true } },
} as const;

/**
 * Can this person decide `module` requests for someone in their reporting line?
 * With no Clerk roles available (API failure), trusts the reporting line rather than
 * dumping every request on HR.
 */
export function canApproveFor(c: Candidate, module: ApprovalModule, roles: ReadonlyMap<string, Role>): boolean {
  if (c.status !== "ACTIVE" || !c.clerkUserId) return false;
  if (roles.size === 0) return true;
  const perms = effectivePermissions(roles.get(c.clerkUserId) ?? "EMPLOYEE", c.accessRole?.permissions);
  return perms.includes(`${module}.approve_team`) || perms.includes(`${module}.approve_all`);
}

/** Memoised Clerk org roles for the current organization (one API call per operation). */
function roleLookup() {
  let roles: Promise<Map<string, Role>> | null = null;
  return async () => (roles ??= currentOrganizationId().then(clerkRolesByUser));
}

const MAX_DEPTH = 15;

/**
 * Walks up the reporting line from `startId` and returns the first eligible approver
 * that isn't the applicant, or null (HR queue). Cycle-safe.
 */
async function walkUp(startId: string | null, applicantId: string, module: ApprovalModule, roles: () => Promise<Map<string, Role>>) {
  const seen = new Set<string>([applicantId]);
  let id = startId;
  for (let depth = 0; id && depth < MAX_DEPTH && !seen.has(id); depth++) {
    seen.add(id);
    const c = await db.employee.findUnique({ where: { id }, select: candidateSelect });
    if (!c) return null;
    if (canApproveFor(c, module, await roles())) return c.id;
    id = c.reportingManagerId;
  }
  return null;
}

/** Approver for a new request from `applicantId`. */
export async function resolveApprover(applicantId: string, module: ApprovalModule, roles = roleLookup()): Promise<string | null> {
  const applicant = await db.employee.findUnique({ where: { id: applicantId }, select: { reportingManagerId: true } });
  return walkUp(applicant?.reportingManagerId ?? null, applicantId, module, roles);
}

// ---------- Moving pending requests ----------

type Moved = {
  kind: "leave" | "regularization";
  requestId: string;
  applicant: string;
  summary: string;
  to: string | null;
  /** Combined leave parts share a group: announced once. */
  group?: string | null;
};

const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
const leaveSummary = (r: { employee: { firstName: string; lastName: string }; leaveType: { name: string }; groupId: string | null }) =>
  `${fullName(r.employee)}'s ${r.groupId ? "combined leave" : r.leaveType.name} request`;
const regSummary = (r: { employee: { firstName: string; lastName: string }; date: Date }) =>
  `${fullName(r.employee)}'s attendance correction for ${formatDate(r.date)}`;

async function announce(moves: Moved[], why: string) {
  if (moves.length === 0) return;
  const organizationId = await currentOrganizationId();
  const hr = new Map<ApprovalModule, Promise<string[]>>();
  const hrFor = (m: ApprovalModule) => {
    if (!hr.has(m)) hr.set(m, employeesWithPermission(organizationId, m === "leave" ? "leave.approve_all" : "attendance.approve_all"));
    return hr.get(m)!;
  };
  const seen = new Set<string>();
  for (const m of moves) {
    const key = `${m.to}|${m.group ?? m.requestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const approvalModule: ApprovalModule = m.kind === "leave" ? "leave" : "attendance";
    const to = m.to ? [m.to] : await hrFor(approvalModule);
    await notify(
      to.filter((id) => id !== m.applicant),
      {
        type: "APPROVAL_ASSIGNED",
        title: `${m.summary} now needs your approval`,
        body: why,
        link: m.kind === "leave" ? "/leave?tab=Approvals" : "/attendance?tab=Regularizations",
      },
    );
  }
}

const pendingInclude = { employee: { select: { firstName: true, lastName: true } } } as const;

/**
 * Re-resolves the approver of every pending leave and regularization request from these
 * applicants (after a reporting-line change or a deactivation) and notifies whoever now
 * has them. Returns how many requests moved.
 */
export async function reassignPendingApprovals(applicantIds: readonly string[], why: string, now = new Date()): Promise<number> {
  if (applicantIds.length === 0) return 0;
  const roles = roleLookup();
  const where = { employeeId: { in: [...applicantIds] }, status: "PENDING" as const };
  const [leave, regs] = await Promise.all([
    db.leaveRequest.findMany({ where, include: { ...pendingInclude, leaveType: { select: { name: true } } } }),
    db.regularizationRequest.findMany({ where, include: pendingInclude }),
  ]);

  const approverOf = new Map<string, Promise<string | null>>();
  const resolveFor = (applicant: string, module: ApprovalModule) => {
    const key = `${applicant}:${module}`;
    if (!approverOf.has(key)) approverOf.set(key, resolveApprover(applicant, module, roles));
    return approverOf.get(key)!;
  };

  const moves: Moved[] = [];
  for (const r of leave) {
    const to = await resolveFor(r.employeeId, "leave");
    if (to === r.approverId) continue;
    await db.leaveRequest.update({ where: { id: r.id }, data: { approverId: to, approverAssignedAt: now } });
    moves.push({ kind: "leave", requestId: r.id, applicant: r.employeeId, to, summary: leaveSummary(r), group: r.groupId });
  }
  for (const r of regs) {
    const to = await resolveFor(r.employeeId, "attendance");
    if (to === r.approverId) continue;
    await db.regularizationRequest.update({ where: { id: r.id }, data: { approverId: to, approverAssignedAt: now } });
    moves.push({
      kind: "regularization",
      requestId: r.id,
      applicant: r.employeeId,
      to,
      summary: regSummary(r),
    });
  }
  await announce(moves, why);
  return moves.length;
}

/** Days a request may wait on one approver before moving up. Override with APPROVAL_ESCALATION_DAYS. */
export function escalationDays(): number {
  const n = Number(process.env.APPROVAL_ESCALATION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/**
 * For the current organization (call inside runAsOrganization from a job):
 *  1. repairs requests waiting on someone who has since been deactivated;
 *  2. moves requests undecided by their approver for `days` one level up the reporting
 *     line (or to the HR queue), restarting the clock.
 * Returns counts of each.
 */
export async function escalateStaleApprovals(now = new Date(), days = escalationDays()) {
  const stuck = await Promise.all([
    db.leaveRequest.findMany({ where: { status: "PENDING", approver: { status: "INACTIVE" } }, select: { employeeId: true } }),
    db.regularizationRequest.findMany({ where: { status: "PENDING", approver: { status: "INACTIVE" } }, select: { employeeId: true } }),
  ]);
  const repaired = await reassignPendingApprovals(
    [...new Set(stuck.flat().map((r) => r.employeeId))],
    "The previous approver is no longer active.",
    now,
  );

  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const stale = { status: "PENDING" as const, approverId: { not: null }, approverAssignedAt: { lte: cutoff } };
  const approverSelect = { approver: { select: { reportingManagerId: true } } } as const;
  const [leave, regs] = await Promise.all([
    db.leaveRequest.findMany({ where: stale, include: { ...pendingInclude, ...approverSelect, leaveType: { select: { name: true } } } }),
    db.regularizationRequest.findMany({ where: stale, include: { ...pendingInclude, ...approverSelect } }),
  ]);

  const roles = roleLookup();
  const moves: Moved[] = [];
  for (const r of leave) {
    const to = await walkUp(r.approver?.reportingManagerId ?? null, r.employeeId, "leave", roles);
    await db.leaveRequest.update({ where: { id: r.id }, data: { approverId: to, approverAssignedAt: now } });
    moves.push({ kind: "leave", requestId: r.id, applicant: r.employeeId, to, summary: leaveSummary(r), group: r.groupId });
  }
  for (const r of regs) {
    const to = await walkUp(r.approver?.reportingManagerId ?? null, r.employeeId, "attendance", roles);
    await db.regularizationRequest.update({ where: { id: r.id }, data: { approverId: to, approverAssignedAt: now } });
    moves.push({
      kind: "regularization",
      requestId: r.id,
      applicant: r.employeeId,
      to,
      summary: regSummary(r),
    });
  }
  await announce(moves, `Escalated: no decision after ${days} day${days === 1 ? "" : "s"}.`);
  return { repaired, escalated: moves.length };
}

/**
 * Keeps pending approvals routed correctly after an employee record changes:
 *  - their manager changed -> their own pending requests are re-resolved;
 *  - they were deactivated -> requests waiting on them are re-resolved.
 * Best effort: logged, never thrown, so it can't fail the employee update itself.
 */
export async function onEmployeeChanged(employeeId: string, change: { managerChanged: boolean; deactivated: boolean }) {
  try {
    let moved = 0;
    if (change.managerChanged) moved += await reassignPendingApprovals([employeeId], "Their reporting manager changed.");
    if (change.deactivated) {
      const waiting = await Promise.all([
        db.leaveRequest.findMany({ where: { status: "PENDING", approverId: employeeId }, select: { employeeId: true } }),
        db.regularizationRequest.findMany({ where: { status: "PENDING", approverId: employeeId }, select: { employeeId: true } }),
      ]);
      moved += await reassignPendingApprovals([...new Set(waiting.flat().map((r) => r.employeeId))], "The previous approver is no longer active.");
    }
    return moved;
  } catch (err) {
    console.error("reassigning approvals failed for", employeeId, err);
    return 0;
  }
}
