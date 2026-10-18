import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "./db";
import { ApiError, badRequest, forbidden, unauthorized } from "./errors";
import { SESSION_COOKIE, verifySession, type Role, type Session } from "./session";

export { ApiError, badRequest, conflict, forbidden, notFound, unauthorized } from "./errors";

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/** For pages: redirect to /login when signed out. */
export async function requirePageSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** For API handlers: throw 401/403. */
export async function requireSession(...roles: Role[]): Promise<Session> {
  const s = await getSession();
  if (!s) throw unauthorized();
  if (roles.length && !roles.includes(s.role)) throw forbidden();
  return s;
}

export const isAdmin = (s: Session) => s.role === "ADMIN";
export const isManagerOrAdmin = (s: Session) => s.role === "ADMIN" || s.role === "MANAGER";

/** True when `employeeId` reports directly to the session user. */
export async function isDirectManagerOf(s: Session, employeeId: string): Promise<boolean> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { reportingManagerId: true } });
  return e?.reportingManagerId === s.employeeId;
}

/** Self, direct manager, or admin may view an employee's leave/attendance. */
export async function assertCanViewEmployee(s: Session, employeeId: string) {
  if (employeeId === s.employeeId || isAdmin(s)) return;
  if (await isDirectManagerOf(s, employeeId)) return;
  throw forbidden();
}

/** Admin or the applicant's direct manager may decide a request; never your own. */
export async function assertCanApprove(s: Session, applicantId: string) {
  if (applicantId === s.employeeId) throw forbidden("You can't approve your own request");
  if (isAdmin(s)) return;
  if (await isDirectManagerOf(s, applicantId)) return;
  throw forbidden("Only the reporting manager or an admin can decide this request");
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
