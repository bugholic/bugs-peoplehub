import { NextResponse } from "next/server";
import { requireSession, route, assertCanViewEmployee } from "@/lib/authz";
import { monthQuery, parseQuery } from "@/lib/validators";
import { getMonth, summarize } from "@/lib/attendance";

export const GET = route(async (req) => {
  const session = await requireSession();
  const q = parseQuery(monthQuery, req);
  const employeeId = q.employeeId ?? session.employeeId;
  if (employeeId !== session.employeeId) await assertCanViewEmployee(session, employeeId);
  const days = await getMonth(employeeId, q.month);
  return NextResponse.json({ employeeId, month: q.month, days, summary: summarize(days) });
});
