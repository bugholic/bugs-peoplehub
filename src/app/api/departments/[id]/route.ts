import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, route, notFound, conflict } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = route<Ctx>(async (_req, { params }) => {
  await requirePermission("org.structure");
  const { id } = await params;
  const existing = await db.department.findUnique({ where: { id } });
  if (!existing) throw notFound("Department");
  if ((await db.employee.count({ where: { departmentId: id } })) > 0) {
    throw conflict("Reassign its employees before deleting this department", "IN_USE");
  }
  await db.department.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
