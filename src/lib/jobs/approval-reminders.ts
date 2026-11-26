import { db, runAsOrganization } from "../db";
import { notify } from "../notifications";
import { employeesWithPermission } from "../access-roles";
import type { Permission } from "../permissions";

/**
 * Daily digest for approvers: "N requests waiting for your approval" (docs/TODO.md T11).
 * Runs per organization from the cron route; recipients follow the same rules as the
 * submit notifications in src/lib/notification-events.ts (named approver, else everyone
 * holding the org-wide permission), never including the applicant.
 */

export type PendingCounts = { leave: number; regularization: number; remote: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Notification text for one approver's pending requests; null when there's nothing pending. */
export function approvalDigest(c: PendingCounts) {
  const total = c.leave + c.regularization + c.remote;
  if (total === 0) return null;
  const body = [
    c.leave && plural(c.leave, "leave request"),
    c.regularization && plural(c.regularization, "attendance correction"),
    c.remote && plural(c.remote, "remote work day"),
  ]
    .filter(Boolean)
    .join(" · ");
  // Open the tab with the most waiting.
  const link =
    c.leave >= c.regularization && c.leave >= c.remote
      ? "/leave?tab=Approvals"
      : c.regularization >= c.remote
        ? "/attendance?tab=Regularizations"
        : "/attendance?tab=Remote+work";
  return { title: `${plural(total, "request")} waiting for your approval`, body, link };
}

export type ReminderOptions = {
  /** Only requests at least this old (they already got an immediate notification). */
  minAgeHours?: number;
  /** Skip anyone reminded within this window, so a cron that fires twice doesn't double up. */
  cooldownHours?: number;
};

const HOUR = 3_600_000;

/** Sends today's digests for one organization. Returns how many approvers were reminded. */
export async function remindPendingApprovals(organizationId: string, now = new Date(), opts: ReminderOptions = {}) {
  const { minAgeHours = 12, cooldownHours = 20 } = opts;
  return runAsOrganization(organizationId, async () => {
    const pending = { status: "PENDING" as const, createdAt: { lte: new Date(now.getTime() - minAgeHours * HOUR) } };
    const select = { employeeId: true, approverId: true } as const;
    const [leave, regularizations, remote, recent] = await Promise.all([
      db.leaveRequest.findMany({ where: pending, select: { ...select, groupId: true } }),
      db.regularizationRequest.findMany({ where: pending, select }),
      db.remoteWorkRequest.findMany({ where: pending, select: { employeeId: true } }),
      db.notification.findMany({
        where: { type: "APPROVALS_PENDING", createdAt: { gte: new Date(now.getTime() - cooldownHours * HOUR) } },
        select: { recipientId: true },
      }),
    ]);

    // Org-wide approver lists are only fetched (one Clerk call each) when some request needs them.
    const holders = new Map<Permission, Promise<string[]>>();
    const holdersOf = (p: Permission) => {
      if (!holders.has(p)) holders.set(p, employeesWithPermission(organizationId, p));
      return holders.get(p)!;
    };

    const counts = new Map<string, PendingCounts>();
    const add = (recipient: string, key: keyof PendingCounts) => {
      const c = counts.get(recipient) ?? { leave: 0, regularization: 0, remote: 0 };
      c[key]++;
      counts.set(recipient, c);
    };
    const route = async (r: { employeeId: string; approverId?: string | null }, key: keyof PendingCounts, fallback: Permission) => {
      const to = r.approverId ? [r.approverId] : await holdersOf(fallback);
      for (const id of to) if (id !== r.employeeId) add(id, key);
    };

    // One combined leave (several parts sharing a groupId) counts as one request.
    const groups = new Set<string>();
    for (const r of leave) {
      if (r.groupId && groups.has(r.groupId)) continue;
      if (r.groupId) groups.add(r.groupId);
      await route(r, "leave", "leave.approve_all");
    }
    for (const r of regularizations) await route(r, "regularization", "attendance.approve_all");
    for (const r of remote) await route(r, "remote", "attendance.remote_approve");

    const skip = new Set(recent.map((n) => n.recipientId));
    let reminded = 0;
    for (const [recipientId, c] of counts) {
      const digest = approvalDigest(c);
      if (!digest || skip.has(recipientId)) continue;
      reminded += await notify([recipientId], { type: "APPROVALS_PENDING", ...digest });
    }
    return reminded;
  });
}
