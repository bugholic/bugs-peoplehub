import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route } from "@/lib/authz";
import { readPunchLocation } from "@/lib/validators";
import { checkOut, serializeLog } from "@/lib/attendance";
import { addDays, parseIsoDate, todayIso } from "@/lib/dates";
import { employeeTimeZone } from "@/lib/timezone";
import { onRemoteSubmitted } from "@/lib/notification-events";

export const POST = route(async (req) => {
  const session = await requireSession();
  // Checking out of a remote session creates today's remote request, or re-opens a decided one.
  // Note which request was already pending so HR is notified once, not on every check-out.
  // Yesterday too: an overnight check-out closes yesterday's session.
  const today = parseIsoDate(todayIso(new Date(), await employeeTimeZone(session.employeeId)));
  const pendingBefore = await db.remoteWorkRequest.findMany({
    where: { employeeId: session.employeeId, date: { in: [today, addDays(today, -1)] }, status: "PENDING" },
    select: { id: true },
  });
  const log = await checkOut(session.employeeId, await readPunchLocation(req));
  if (log.remoteRequest?.status === "PENDING" && !pendingBefore.some((p) => p.id === log.remoteRequest!.id)) {
    await onRemoteSubmitted(log.remoteRequest.id, session.organizationId);
  }
  return NextResponse.json(serializeLog(log));
});
