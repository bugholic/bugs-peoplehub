import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { route, readJson, ApiError } from "@/lib/authz";
import { loginSchema } from "@/lib/validators";
import { signSession, sessionCookieOptions, SESSION_COOKIE, type Session } from "@/lib/session";

export const POST = route(async (req) => {
  const body = loginSchema.parse(await readJson(req));
  const user = await db.user.findUnique({ where: { email: body.email }, include: { employee: true } });
  const invalid = () => new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  if (!user || !user.employee || user.employee.status !== "ACTIVE") throw invalid();
  if (!(await bcrypt.compare(body.password, user.passwordHash))) throw invalid();

  const session: Session = {
    userId: user.id,
    employeeId: user.employee.id,
    role: user.role,
    name: `${user.employee.firstName} ${user.employee.lastName}`,
  };
  const token = await signSession(session);
  const res = NextResponse.json({ session });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
});
