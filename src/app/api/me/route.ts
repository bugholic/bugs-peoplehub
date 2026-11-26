import { NextResponse } from "next/server";
import { db, dbUnscoped } from "@/lib/db";
import { requireSession, route } from "@/lib/authz";
import { employeeTimeZone } from "@/lib/timezone";

export const GET = route(async () => {
  const session = await requireSession();
  const employee = await db.employee.findUnique({
    where: { id: session.employeeId },
    select: {
      id: true,
      empCode: true,
      firstName: true,
      lastName: true,
      email: true,
      photoUrl: true,
      department: { select: { id: true, name: true } },
      designation: { select: { id: true, name: true } },
      reportingManagerId: true,
    },
  });
  const [org, timeZone] = await Promise.all([
    dbUnscoped.organization.findUnique({ where: { id: session.organizationId }, select: { bannerUrl: true, timeZone: true } }),
    employeeTimeZone(session.employeeId),
  ]);
  return NextResponse.json({
    session,
    employee,
    // timeZone: the signed-in person's zone (their location's, else the org's); use it to show times and "today".
    timeZone,
    organization: { bannerUrl: org?.bannerUrl ?? null, timeZone: org?.timeZone ?? timeZone },
  });
});
