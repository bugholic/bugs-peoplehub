import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route, readJson, notFound } from "@/lib/authz";
import { accessRoleUpdateSchema } from "@/lib/validators";
import { assertUniqueRoleName, serializeAccessRole } from "@/lib/access-roles";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { params }) => {
  await requireSession("ADMIN");
  const { id } = await params;
  const body = accessRoleUpdateSchema.parse(await readJson(req));
  const existing = await db.accessRole.findUnique({ where: { id } });
  if (!existing) throw notFound("Role");
  if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) await assertUniqueRoleName(body.name, id);

  const role = await db.accessRole.update({
    where: { id },
    data: {
      name: body.name,
      ...(body.description !== undefined ? { description: body.description || null } : {}),
      ...(body.permissions ? { permissions: [...new Set(body.permissions)] } : {}),
    },
    include: { _count: { select: { employees: { where: { status: "ACTIVE" } } } } },
  });
  return NextResponse.json(serializeAccessRole(role));
});

/** Members holding the role fall back to their Clerk org role's default permissions (FK is ON DELETE SET NULL). */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  await requireSession("ADMIN");
  const { id } = await params;
  const existing = await db.accessRole.findUnique({ where: { id } });
  if (!existing) throw notFound("Role");
  await db.accessRole.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
