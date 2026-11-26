import { NextResponse } from "next/server";
import { readJson, requireSession, route } from "@/lib/authz";
import { markNotificationsRead, unreadNotificationCount } from "@/lib/notifications";
import { notificationReadSchema } from "@/lib/validators";

/** Mark some (`ids`) or all of your own notifications read. */
export const POST = route(async (req) => {
  const session = await requireSession();
  const body = notificationReadSchema.parse(await readJson(req));
  const updated = await markNotificationsRead(session.employeeId, body.ids);
  return NextResponse.json({ updated, unreadCount: await unreadNotificationCount(session.employeeId) });
});
