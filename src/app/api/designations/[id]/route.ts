import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, route, notFound, conflict } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = route<Ctx>(async (_req, { params }) => {
  await requirePermission("org.structure");
  const { id } = await params;
  const existing = await db.designation.findUnique({ where: { id } });
  if (!existing) throw notFound("Designation");
  if ((await db.employee.count({ where: { designationId: id } })) > 0) {
    throw conflict("Reassign its employees before deleting this designation", "IN_USE");
  }
  await db.designation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
