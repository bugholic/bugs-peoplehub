import { NextResponse } from "next/server";
import { requireSession, route } from "@/lib/authz";
import { readPunchLocation } from "@/lib/validators";
import { checkIn, serializeLog } from "@/lib/attendance";

export const POST = route(async (req) => {
  const session = await requireSession();
  const log = await checkIn(session.employeeId, await readPunchLocation(req));
  return NextResponse.json(serializeLog(log));
});
