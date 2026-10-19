import { NextResponse } from "next/server";
import { requireSession, route } from "@/lib/authz";
import { readPunchLocation } from "@/lib/validators";
import { checkOut, serializeLog } from "@/lib/attendance";

export const POST = route(async (req) => {
  const session = await requireSession();
  const log = await checkOut(session.employeeId, await readPunchLocation(req));
  return NextResponse.json(serializeLog(log));
});
