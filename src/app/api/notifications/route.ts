import { NextResponse } from "next/server";
import { requireSession, route } from "@/lib/authz";
import { listNotifications } from "@/lib/notifications";
import { notificationListQuery, parseQuery } from "@/lib/validators";

/** The signed-in employee's notifications, newest first, plus their unread count. */
export const GET = route(async (req) => {
  const session = await requireSession();
  const q = parseQuery(notificationListQuery, req);
  return NextResponse.json(await listNotifications(session.employeeId, { unreadOnly: q.unread, limit: q.limit }));
});
