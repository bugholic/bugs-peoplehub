import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, route, assertCanViewEmployee } from "@/lib/authz";
import { getBalances } from "@/lib/leave";
import { parseQuery } from "@/lib/validators";
import { todayIso } from "@/lib/dates";

const query = z.object({
  employeeId: z.string().min(1).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const GET = route(async (req) => {
  const session = await requireSession();
  const q = parseQuery(query, req);
  const employeeId = q.employeeId ?? session.employeeId;
  if (employeeId !== session.employeeId) await assertCanViewEmployee(session, employeeId);
  const year = q.year ?? Number(todayIso().slice(0, 4));
  const balances = await getBalances(employeeId, year);
  return NextResponse.json({ employeeId, year, balances });
});
