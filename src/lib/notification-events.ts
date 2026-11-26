import { db } from "./db";
import { notify } from "./notifications";
import { employeesWithPermission } from "./access-roles";
import { formatDate, toIsoDate } from "./dates";

/**
 * Domain events -> notifications. Each is called by a route after its write commits,
 * and is best effort: any failure (lookup, Clerk, insert) is logged and swallowed so a
 * notification problem never fails or rolls back the request itself.
 *
 * Requests with no named approver go to everyone holding the org-wide permission
 * (until approver resolution is reworked in docs/TODO.md T12).
 */
async function safely(event: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`notification event ${event} failed`, err);
  }
}

const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const dateRange = (from: Date, to: Date) =>
  toIsoDate(from) === toIsoDate(to) ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
const withNote = (text: string, note: string | null | undefined) => (note ? `${text} · “${note}”` : text);

const LINKS = {
  leaveApprovals: "/leave?tab=Approvals",
  myLeave: "/leave?tab=My+requests",
  regularizations: "/attendance?tab=Regularizations",
  remoteWork: "/attendance?tab=Remote+work",
  employee: (id: string) => `/employees/${id}`,
};

const leaveInclude = {
  employee: { select: { firstName: true, lastName: true } },
  leaveType: { select: { name: true } },
} as const;

// ---------- Leave ----------

/**
 * A request as one notification: a combined leave (parts sharing a groupId) reads as
 * "Casual + Earned", its total days and its whole date range.
 */
async function leaveApplication(requestId: string) {
  const r = await db.leaveRequest.findUnique({ where: { id: requestId }, include: leaveInclude });
  if (!r) return null;
  const parts = r.groupId
    ? await db.leaveRequest.findMany({ where: { groupId: r.groupId }, include: leaveInclude, orderBy: { fromDate: "asc" } })
    : [r];
  return {
    ...r,
    typeName: parts.map((x) => x.leaveType.name).join(" + "),
    totalDays: parts.reduce((a, x) => a + Number(x.days), 0),
    fromDate: parts[0].fromDate,
    toDate: parts[parts.length - 1].toDate,
  };
}

export const onLeaveSubmitted = (requestId: string, organizationId: string) =>
  safely("LEAVE_SUBMITTED", async () => {
    const r = await leaveApplication(requestId);
    if (!r) return;
    const to = r.approverId ? [r.approverId] : await employeesWithPermission(organizationId, "leave.approve_all");
    await notify(to, {
      type: "LEAVE_SUBMITTED",
      title: `${fullName(r.employee)} requested ${r.typeName}`,
      body: `${days(r.totalDays)} · ${dateRange(r.fromDate, r.toDate)} · ${r.reason}`,
      link: LINKS.leaveApprovals,
      actorId: r.employeeId,
    });
  });

export const onLeaveDecided = (requestId: string, deciderId: string) =>
  safely("LEAVE_DECIDED", async () => {
    const r = await leaveApplication(requestId);
    if (!r || (r.status !== "APPROVED" && r.status !== "REJECTED")) return;
    const approved = r.status === "APPROVED";
    await notify([r.employeeId], {
      type: approved ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
      title: `Your ${r.typeName} was ${approved ? "approved" : "rejected"}`,
      body: withNote(`${days(r.totalDays)} · ${dateRange(r.fromDate, r.toDate)}`, r.decisionNote),
      link: LINKS.myLeave,
      actorId: deciderId,
    });
  });

/** Tells whoever would decide (or decided) the request that it was withdrawn. */
export const onLeaveCancelled = (requestId: string, organizationId: string) =>
  safely("LEAVE_CANCELLED", async () => {
    const r = await leaveApplication(requestId);
    if (!r) return;
    const to = r.approverId ? [r.approverId] : await employeesWithPermission(organizationId, "leave.approve_all");
    await notify(to, {
      type: "LEAVE_CANCELLED",
      title: `${fullName(r.employee)} cancelled ${r.typeName}`,
      body: `${days(r.totalDays)} · ${dateRange(r.fromDate, r.toDate)}`,
      link: LINKS.leaveApprovals,
      actorId: r.employeeId,
    });
  });

/**
 * Approved leave was cut short. By the employee (returning early): tells whoever approved it.
 * By a manager/HR (revoke): tells the employee, with the note.
 */
export const onLeaveShortened = (
  requestId: string,
  organizationId: string,
  actorId: string,
  result: { freedDays: number; cancelled: boolean; lastDay: string | null },
  returnOn: string,
  note?: string,
) =>
  safely("LEAVE_SHORTENED", async () => {
    const r = await leaveApplication(requestId);
    if (!r) return;
    const outcome = result.cancelled ? "all of it" : `from ${formatDate(returnOn)}`;
    if (actorId === r.employeeId) {
      const to = r.approverId ? [r.approverId] : await employeesWithPermission(organizationId, "leave.approve_all");
      await notify(to, {
        type: "LEAVE_CANCELLED",
        title: `${fullName(r.employee)} returns early from ${r.typeName}`,
        body: `${days(result.freedDays)} given back, ${outcome}`,
        link: LINKS.leaveApprovals,
        actorId,
      });
    } else {
      await notify([r.employeeId], {
        type: "LEAVE_REVOKED",
        title: `Your ${r.typeName} was ${result.cancelled ? "revoked" : "cut short"}`,
        body: withNote(`${days(result.freedDays)} released, ${outcome}`, note),
        link: LINKS.myLeave,
        actorId,
      });
    }
  });

export const onBalanceAdjusted = (adjustment: { employeeId: string; days: number; reason: string; leaveType: { name: string }; year: number }, actorId: string) =>
  safely("BALANCE_ADJUSTED", async () => {
    const credited = adjustment.days > 0;
    await notify([adjustment.employeeId], {
      type: "BALANCE_ADJUSTED",
      title: `Your ${adjustment.leaveType.name} balance was ${credited ? "credited" : "debited"} ${days(Math.abs(adjustment.days))}`,
      body: `${adjustment.year} · ${adjustment.reason}`,
      link: LINKS.employee(adjustment.employeeId),
      actorId,
    });
  });

// ---------- Attendance ----------

export const onRegularizationSubmitted = (requestId: string, organizationId: string) =>
  safely("REGULARIZATION_SUBMITTED", async () => {
    const r = await db.regularizationRequest.findUnique({
      where: { id: requestId },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (!r) return;
    const to = r.approverId ? [r.approverId] : await employeesWithPermission(organizationId, "attendance.approve_all");
    await notify(to, {
      type: "REGULARIZATION_SUBMITTED",
      title: `${fullName(r.employee)} asked to correct attendance`,
      body: `${formatDate(r.date)} · ${r.reason}`,
      link: LINKS.regularizations,
      actorId: r.employeeId,
    });
  });

export const onRegularizationDecided = (requestId: string, deciderId: string) =>
  safely("REGULARIZATION_DECIDED", async () => {
    const r = await db.regularizationRequest.findUnique({ where: { id: requestId } });
    if (!r || (r.status !== "APPROVED" && r.status !== "REJECTED")) return;
    const approved = r.status === "APPROVED";
    await notify([r.employeeId], {
      type: approved ? "REGULARIZATION_APPROVED" : "REGULARIZATION_REJECTED",
      title: `Your attendance correction for ${formatDate(r.date)} was ${approved ? "approved" : "rejected"}`,
      body: r.decisionNote,
      link: LINKS.regularizations,
      actorId: deciderId,
    });
  });

export const onRemoteSubmitted = (requestId: string, organizationId: string) =>
  safely("REMOTE_SUBMITTED", async () => {
    const r = await db.remoteWorkRequest.findUnique({
      where: { id: requestId },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (!r) return;
    const hours = Math.round((r.remoteMinutes / 60) * 10) / 10;
    await notify(await employeesWithPermission(organizationId, "attendance.remote_approve"), {
      type: "REMOTE_SUBMITTED",
      title: `${fullName(r.employee)} worked remotely`,
      body: `${formatDate(r.date)} · ${hours}h to review`,
      link: LINKS.remoteWork,
      actorId: r.employeeId,
    });
  });

export const onRemoteDecided = (requestId: string, deciderId: string) =>
  safely("REMOTE_DECIDED", async () => {
    const r = await db.remoteWorkRequest.findUnique({ where: { id: requestId } });
    if (!r || (r.status !== "APPROVED" && r.status !== "REJECTED")) return;
    const approved = r.status === "APPROVED";
    await notify([r.employeeId], {
      type: approved ? "REMOTE_APPROVED" : "REMOTE_REJECTED",
      title: `Your remote work on ${formatDate(r.date)} was ${approved ? "approved" : "rejected"}`,
      body: r.decisionNote,
      link: LINKS.remoteWork,
      actorId: deciderId,
    });
  });
