import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route, readJson, notFound } from "@/lib/authz";
import { assignAccessRoleSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

/** Assign a custom role to an employee, or `null` to fall back to their Clerk org role's defaults. Org admins only. */
export const PUT = route<Ctx>(async (req, { params }) => {
  await requireSession("ADMIN");
  const { id } = await params;
  const { accessRoleId } = assignAccessRoleSchema.parse(await readJson(req));

  if (!(await db.employee.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Employee");
  // Scoped lookup: a role id from another organization reads as not found.
  if (accessRoleId && !(await db.accessRole.findUnique({ where: { id: accessRoleId }, select: { id: true } }))) {
    throw notFound("Role");
  }

  await db.employee.update({ where: { id }, data: { accessRoleId } });
  return NextResponse.json({ id, accessRoleId });
});
