import { NextResponse } from "next/server";
import { readJson, requirePermission, route } from "@/lib/authz";
import { attendanceImportSchema } from "@/lib/validators";
import { importAttendance } from "@/lib/attendance-admin";

/**
 * Attendance CSV import (attendance.edit). Columns: employee (code or email), date (YYYY-MM-DD),
 * checkIn, checkOut (HH:mm in the employee's zone), optional reason. `dryRun` (default true)
 * only validates and reports what would change; with `dryRun: false` it applies all rows or,
 * if any row has an error, none.
 */
export const POST = route(async (req) => {
  const session = await requirePermission("attendance.edit");
  const body = attendanceImportSchema.parse(await readJson(req));
  return NextResponse.json(await importAttendance(body.csv, session.employeeId, { dryRun: body.dryRun, reason: body.reason }));
});
