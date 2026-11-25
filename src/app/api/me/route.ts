import { NextResponse } from "next/server";
import { db, dbUnscoped } from "@/lib/db";
import { requireSession, route } from "@/lib/authz";

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
  const org = await dbUnscoped.organization.findUnique({ where: { id: session.organizationId }, select: { bannerUrl: true } });
  return NextResponse.json({ session, employee, organization: { bannerUrl: org?.bannerUrl ?? null } });
});
