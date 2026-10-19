import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route } from "@/lib/authz";

export const GET = route(async () => {
  await requireSession();
  const employees = await db.employee.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      photoUrl: true,
      reportingManagerId: true,
      designation: { select: { name: true } },
    },
    orderBy: { firstName: "asc" },
  });
  const nodes = employees.map((e) => ({
    id: e.id,
    name: `${e.firstName} ${e.lastName}`,
    title: e.designation?.name ?? null,
    photoUrl: e.photoUrl,
    managerId: e.reportingManagerId,
  }));
  return NextResponse.json({ nodes });
});
