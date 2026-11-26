import { NextResponse } from "next/server";
import { assertCanViewEmployee, readJson, requirePermission, requireSession, route } from "@/lib/authz";
import { attendanceEditSchema, attendanceEditsQuery, parseQuery } from "@/lib/validators";
import { editAttendanceDay, listAttendanceEdits } from "@/lib/attendance-admin";
import { monthRange } from "@/lib/dates";

/** Audit trail of admin edits/imports for one employee (optionally one month). Visible to whoever can see their attendance. */
export const GET = route(async (req) => {
  const session = await requireSession();
  const q = parseQuery(attendanceEditsQuery, req);
  await assertCanViewEmployee(session, q.employeeId, "attendance");
  return NextResponse.json({ items: await listAttendanceEdits(q.employeeId, q.month ? monthRange(q.month) : undefined) });
});

/** Set or clear one day of someone else's attendance (attendance.edit); audited and the employee is notified. */
export const POST = route(async (req) => {
  const session = await requirePermission("attendance.edit");
  const body = attendanceEditSchema.parse(await readJson(req));
  return NextResponse.json(await editAttendanceDay(body, session.employeeId), { status: 201 });
});
