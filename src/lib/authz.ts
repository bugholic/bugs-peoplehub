import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "./db";
import { ApiError, badRequest, forbidden, unauthorized } from "./errors";
import { provisionEmployee } from "./provision";
import { roleFromOrgRole, type Role, type Session } from "./session";
import { effectivePermissions, type Permission } from "./permissions";

export { ApiError, badRequest, conflict, forbidden, notFound, unauthorized } from "./errors";

type Resolved =
  | { status: "signed-out" }
  | { status: "no-org" }
  | { status: "no-employee" }
  | { status: "ok"; session: Session };

/**
 * Clerk proves who the person is and which organization is active (and their org
 * role); our DB holds that organization's Employee record. Memoised per request.
 * The employee lookup is DB-only after the first visit; Clerk's API is called
 * only to provision a new member (see provisionEmployee).
 */
const resolve = cache(async (): Promise<Resolved> => {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) return { status: "signed-out" };
  if (!orgId) return { status: "no-org" };

  const linked = await db.employee.findFirst({ where: { clerkUserId: userId }, include: { accessRole: true } });
  const employee = linked ?? (await provisionEmployee(userId, orgId));
  if (!employee || employee.status !== "ACTIVE") return { status: "no-employee" };

  // A directory record linked just now may already have had a role assigned by an admin.
  const accessRole = linked
    ? linked.accessRole
    : employee.accessRoleId
      ? await db.accessRole.findUnique({ where: { id: employee.accessRoleId } })
      : null;
  const role = roleFromOrgRole(orgRole);
  // Clerk org admins can't be narrowed by a custom role, so an org can never lock itself out.
  const permissions = effectivePermissions(role, accessRole?.permissions);

  return {
    status: "ok",
    session: {
      userId,
      organizationId: orgId,
      employeeId: employee.id,
      role,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      accessRole: role !== "ADMIN" && accessRole ? { id: accessRole.id, name: accessRole.name } : null,
      permissions,
    },
  };
});

export async function getSession(): Promise<Session | null> {
  const r = await resolve();
  return r.status === "ok" ? r.session : null;
}

/** For pages: /sign-in when signed out, /select-org with no active org, /no-access when deactivated. */
export async function requirePageSession(): Promise<Session> {
  const r = await resolve();
  if (r.status === "signed-out") redirect("/sign-in");
  if (r.status === "no-org") redirect("/select-org");
  if (r.status === "no-employee") redirect("/no-access");
  return r.session;
}

/** For API handlers: throw 401/403. */
export async function requireSession(...roles: Role[]): Promise<Session> {
  const s = await getSession();
  if (!s) throw unauthorized();
  if (roles.length && !roles.includes(s.role)) throw forbidden();
  return s;
}

/** For pages: redirect to the dashboard unless the user holds at least one of `perms`. */
export async function requirePagePermission(...perms: Permission[]): Promise<Session> {
  const s = await requirePageSession();
  if (!perms.some((p) => can(s, p))) redirect("/dashboard");
  return s;
}

/** For API handlers: 401 when signed out, 403 unless the user holds at least one of `perms`. */
export async function requirePermission(...perms: Permission[]): Promise<Session> {
  const s = await requireSession();
  if (!perms.some((p) => can(s, p))) throw forbidden();
  return s;
}

export const can = (s: Session, p: Permission) => s.permissions.includes(p);

/** Clerk org admin: the only tier that can manage roles (so nobody can grant themselves more access). */
export const isAdmin = (s: Session) => s.role === "ADMIN";

/** True when `employeeId` reports directly to the session user. */
export async function isDirectManagerOf(s: Session, employeeId: string): Promise<boolean> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { reportingManagerId: true } });
  return e?.reportingManagerId === s.employeeId;
}

export type Module = "leave" | "attendance";

/** Self always; otherwise `<module>.approve_all`, or `<module>.approve_team` for a direct report. */
export async function assertCanViewEmployee(s: Session, employeeId: string, module: Module) {
  if (employeeId === s.employeeId || can(s, `${module}.approve_all`)) return;
  if (module === "attendance" && can(s, "attendance.edit")) return;
  if (can(s, `${module}.approve_team`) && (await isDirectManagerOf(s, employeeId))) return;
  throw forbidden();
}

/**
 * `<module>.approve_all`; or `<module>.approve_team` for the applicant's direct manager or
 * the request's assigned approver (e.g. a skip-level manager after escalation, see
 * src/lib/approvals.ts); never your own request.
 */
export async function assertCanApprove(s: Session, applicantId: string, module: Module, assignedApproverId?: string | null) {
  if (applicantId === s.employeeId) throw forbidden("You can't approve your own request");
  if (can(s, `${module}.approve_all`)) return;
  if (can(s, `${module}.approve_team`)) {
    if (assignedApproverId === s.employeeId) return;
    if (await isDirectManagerOf(s, applicantId)) return;
  }
  throw forbidden("You don't have permission to decide this request");
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler so thrown ApiError / ZodError become JSON error responses. */
export function route<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Request validation failed",
              details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
            },
          },
          { status: 422 },
        );
      }
      console.error(err);
      return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw badRequest("Body must be valid JSON");
  }
}
