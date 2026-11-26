import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";

/**
 * In-app notifications. `notify()` is the single entry point that domain code calls;
 * later delivery channels (email, Expo push; docs/TODO.md T9/T10) hook in there.
 */
export const NOTIFICATION_TYPES = [
  "LEAVE_SUBMITTED",
  "LEAVE_APPROVED",
  "LEAVE_REJECTED",
  "LEAVE_CANCELLED",
  "LEAVE_REVOKED",
  "REGULARIZATION_SUBMITTED",
  "REGULARIZATION_APPROVED",
  "REGULARIZATION_REJECTED",
  "REMOTE_SUBMITTED",
  "REMOTE_APPROVED",
  "REMOTE_REJECTED",
  "BALANCE_ADJUSTED",
  "APPROVALS_PENDING",
  "APPROVAL_ASSIGNED",
  "ATTENDANCE_AUTO_CLOSED",
  "ATTENDANCE_MISSING",
  "ATTENDANCE_EDITED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotifyInput = {
  type: NotificationType;
  title: string;
  body?: string | null;
  /** App path to open, e.g. "/leave". */
  link?: string | null;
  /** Who caused it; never notified about their own action. */
  actorId?: string | null;
};

/**
 * Creates one notification per distinct recipient, skipping null ids and the actor.
 * Best effort: a failure is logged, never thrown, so it can't undo or fail the
 * request that triggered it. Call it after the triggering write has committed.
 */
export async function notify(recipientIds: readonly (string | null | undefined)[], n: NotifyInput): Promise<number> {
  const recipients = [...new Set(recipientIds.filter((id): id is string => !!id && id !== n.actorId))];
  if (recipients.length === 0) return 0;
  try {
    const { count } = await db.notification.createMany({
      data: recipients.map((recipientId) => ({
        recipientId,
        actorId: n.actorId ?? null,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        link: n.link ?? null,
      })),
    });
    return count;
  } catch (err) {
    console.error("notify failed", n.type, err);
    return 0;
  }
}

const include = { actor: { select: { id: true, firstName: true, lastName: true, photoUrl: true } } } satisfies Prisma.NotificationInclude;

function serialize(n: Prisma.NotificationGetPayload<{ include: typeof include }>) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.readAt !== null,
    createdAt: n.createdAt.toISOString(),
    actor: n.actor ? { id: n.actor.id, name: `${n.actor.firstName} ${n.actor.lastName}`, photoUrl: n.actor.photoUrl } : null,
  };
}

export async function listNotifications(employeeId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { recipientId: employeeId, ...(opts.unreadOnly ? { readAt: null } : {}) },
      include,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 20,
    }),
    unreadNotificationCount(employeeId),
  ]);
  return { items: rows.map(serialize), unreadCount };
}

export const unreadNotificationCount = (employeeId: string) =>
  db.notification.count({ where: { recipientId: employeeId, readAt: null } });

/** Marks the given notifications (or all, when `ids` is omitted) read; only the recipient's own. */
export async function markNotificationsRead(employeeId: string, ids?: readonly string[]): Promise<number> {
  const { count } = await db.notification.updateMany({
    where: { recipientId: employeeId, readAt: null, ...(ids ? { id: { in: [...ids] } } : {}) },
    data: { readAt: new Date() },
  });
  return count;
}
