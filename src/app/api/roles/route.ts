import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route, readJson } from "@/lib/authz";
import { accessRoleSchema } from "@/lib/validators";
import { assertUniqueRoleName, clerkRolesByUser, serializeAccessRole } from "@/lib/access-roles";

/**
 * Roles plus the active members they can be assigned to. Role management is limited
 * to Clerk org admins: it isn't a grantable permission, so nobody can escalate themselves.
 */
export const GET = route(async () => {
  const session = await requireSession("ADMIN");
  const [roles, employees, clerkRoles] = await Promise.all([
    db.accessRole.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { employees: { where: { status: "ACTIVE" } } } } },
    }),
    db.employee.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        empCode: true,
        firstName: true,
        lastName: true,
        email: true,
        photoUrl: true,
        clerkUserId: true,
        accessRoleId: true,
        designation: { select: { name: true } },
      },
      orderBy: { firstName: "asc" },
    }),
    clerkRolesByUser(session.organizationId),
  ]);

  return NextResponse.json({
    items: roles.map(serializeAccessRole),
    members: employees.map((e) => ({
      id: e.id,
      empCode: e.empCode,
      name: `${e.firstName} ${e.lastName}`.trim(),
      email: e.email,
      photoUrl: e.photoUrl,
      designation: e.designation?.name ?? null,
      accessRoleId: e.accessRoleId,
      hasLogin: e.clerkUserId !== null,
      // Clerk org role; ADMIN always has full access whatever role is assigned.
      orgRole: (e.clerkUserId && clerkRoles.get(e.clerkUserId)) || "EMPLOYEE",
    })),
  });
});

export const POST = route(async (req) => {
  await requireSession("ADMIN");
  const body = accessRoleSchema.parse(await readJson(req));
  await assertUniqueRoleName(body.name);
  const role = await db.accessRole.create({
    data: { name: body.name, description: body.description || null, permissions: [...new Set(body.permissions)] },
  });
  return NextResponse.json(serializeAccessRole(role), { status: 201 });
});
