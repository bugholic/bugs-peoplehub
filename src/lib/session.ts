import type { Permission } from "./permissions";

export type Role = "ADMIN" | "MANAGER" | "EMPLOYEE";

/** The app-level identity: a Clerk user in a Clerk organization, resolved to that org's Employee row. */
export type Session = {
  /** Clerk user id. */
  userId: string;
  /** Clerk organization id (the tenant). */
  organizationId: string;
  employeeId: string;
  /** Clerk org role. ADMIN is the organization owner tier and always holds every permission. */
  role: Role;
  name: string;
  /** Custom access role assigned to this employee, if any (otherwise permissions follow `role`). */
  accessRole: { id: string; name: string } | null;
  /** Effective permissions, resolved once per request. */
  permissions: Permission[];
};

/**
 * Clerk org role -> app role. `org:admin` is built in; `org:manager` is a custom
 * role created in the Clerk Dashboard (Organizations -> Roles). Anything else,
 * including the default `org:member`, is a regular employee.
 */
export function roleFromOrgRole(orgRole: string | null | undefined): Role {
  if (orgRole === "org:admin") return "ADMIN";
  if (orgRole === "org:manager") return "MANAGER";
  return "EMPLOYEE";
}

export const orgRoleFromRole = (role: Role) =>
  role === "ADMIN" ? "org:admin" : role === "MANAGER" ? "org:manager" : "org:member";
