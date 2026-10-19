import { NextResponse } from "next/server";
import { requireSession, route } from "@/lib/authz";
import { toIsoDate } from "@/lib/dates";
import { checkOut } from "@/lib/attendance";

export const POST = route(async () => {
  const session = await requireSession();
  const log = await checkOut(session.employeeId);
  return NextResponse.json({ ...log, date: toIsoDate(log.date) });
});
