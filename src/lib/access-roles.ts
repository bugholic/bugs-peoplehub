import { clerkClient } from "@clerk/nextjs/server";
import type { AccessRole } from "@/generated/prisma/client";
import { db } from "./db";
import { conflict } from "./errors";
import { effectivePermissions, sanitizePermissions, type Permission } from "./permissions";
import { roleFromOrgRole, type Role } from "./session";

export function serializeAccessRole(r: AccessRole & { _count?: { employees: number } }) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    permissions: sanitizePermissions(r.permissions),
    memberCount: r._count?.employees ?? 0,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Case-insensitive name uniqueness within the organization (the DB constraint is case-sensitive). */
export async function assertUniqueRoleName(name: string, exceptId?: string) {
  const clash = await db.accessRole.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (clash) throw conflict("A role with this name already exists", "DUPLICATE");
}

/**
 * Clerk org role per Clerk user id, for labelling who is an org admin (always full access)
 * and what an unassigned member falls back to. One Clerk API call; on failure, returns an
 * empty map and the UI treats everyone as a regular member.
 */
export async function clerkRolesByUser(organizationId: string): Promise<Map<string, Role>> {
  const roles = new Map<string, Role>();
  try {
    const clerk = await clerkClient();
    const { data } = await clerk.organizations.getOrganizationMembershipList({ organizationId, limit: 500 });
    for (const m of data) if (m.publicUserData?.userId) roles.set(m.publicUserData.userId, roleFromOrgRole(m.role));
  } catch (e) {
    console.error("Could not load Clerk memberships", e);
  }
  return roles;
}

/**
 * Ids of active, signed-up employees who effectively hold `permission` (same rule as
 * src/lib/authz.ts via effectivePermissions). One Clerk API call for org roles; if it
 * fails, Clerk admins without a custom role are missed (best effort, for notifications).
 */
export async function employeesWithPermission(organizationId: string, permission: Permission): Promise<string[]> {
  const [employees, roles] = await Promise.all([
    db.employee.findMany({
      where: { status: "ACTIVE", clerkUserId: { not: null } },
      select: { id: true, clerkUserId: true, accessRole: { select: { permissions: true } } },
    }),
    clerkRolesByUser(organizationId),
  ]);
  return employees
    .filter((e) => effectivePermissions(roles.get(e.clerkUserId!) ?? "EMPLOYEE", e.accessRole?.permissions).includes(permission))
    .map((e) => e.id);
}
