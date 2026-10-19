import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route } from "@/lib/authz";

export const GET = route(async () => {
  await requireSession();
  const [departments, designations, locations, managers] = await Promise.all([
    db.department.findMany({ orderBy: { name: "asc" } }),
    db.designation.findMany({ orderBy: { name: "asc" } }),
    db.location.findMany({ orderBy: { name: "asc" } }),
    db.employee.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, empCode: true },
      orderBy: { firstName: "asc" },
    }),
  ]);
  return NextResponse.json({
    departments,
    designations,
    locations,
    managers: managers.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`, empCode: m.empCode })),
  });
});
