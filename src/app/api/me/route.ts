import { NextResponse } from "next/server";
import { db } from "@/lib/db";
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
  return NextResponse.json({ session, employee });
});
