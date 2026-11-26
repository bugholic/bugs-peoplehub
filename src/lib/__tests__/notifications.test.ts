import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_notifications";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: ORG }) }));

import { db, dbUnscoped } from "../db";
import { listNotifications, markNotificationsRead, notify, unreadNotificationCount } from "../notifications";

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.notification.deleteMany({ where });
  await dbUnscoped.employee.deleteMany({ where });
}

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
describe.skipIf(!process.env.DATABASE_URL)("notifications (T7, against the DB)", () => {
  let a: string;
  let b: string;
  let actor: string;

  beforeAll(async () => {
    await cleanup();
    const mk = async (n: string) =>
      (await db.employee.create({ data: { empCode: n, firstName: n, lastName: "T", email: `${n}@t.test`, joinDate: new Date() } })).id;
    [a, b, actor] = [await mk("NA"), await mk("NB"), await mk("NX")];
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  it("notifies each distinct recipient once, skipping nulls and the actor", async () => {
    const n = await notify([a, a, null, undefined, b, actor], { type: "LEAVE_SUBMITTED", title: "New leave request", link: "/leave", actorId: actor });
    expect(n).toBe(2);
    expect(await unreadNotificationCount(actor)).toBe(0);
  });

  it("lists newest first with the actor and an unread count", async () => {
    await notify([a], { type: "LEAVE_APPROVED", title: "Leave approved", actorId: actor });
    const res = await listNotifications(a);
    expect(res.unreadCount).toBe(2);
    expect(res.items.map((i) => i.title)).toEqual(["Leave approved", "New leave request"]);
    expect(res.items[0].actor?.id).toBe(actor);
  });

  it("marks only the recipient's own notifications read", async () => {
    const [theirs] = (await listNotifications(b)).items;
    expect(await markNotificationsRead(a, [theirs.id])).toBe(0); // someone else's id: no effect
    expect(await unreadNotificationCount(b)).toBe(1);

    const [newest] = (await listNotifications(a)).items;
    expect(await markNotificationsRead(a, [newest.id])).toBe(1);
    expect(await unreadNotificationCount(a)).toBe(1);
    expect((await listNotifications(a, { unreadOnly: true })).items).toHaveLength(1);

    expect(await markNotificationsRead(a)).toBe(1); // all
    expect(await unreadNotificationCount(a)).toBe(0);
  });

  it("returns 0 instead of throwing when there's no one to notify", async () => {
    expect(await notify([actor], { type: "LEAVE_CANCELLED", title: "x", actorId: actor })).toBe(0);
  });
});
