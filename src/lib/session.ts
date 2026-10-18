import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "ph_session";
const MAX_AGE_SECONDS = 60 * 60 * 8;

export type Role = "ADMIN" | "MANAGER" | "EMPLOYEE";

export type Session = {
  userId: string;
  employeeId: string;
  role: Role;
  name: string;
};

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(secret);
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    const { userId, employeeId, role, name } = payload as Record<string, unknown>;
    if (typeof userId !== "string" || typeof employeeId !== "string" || typeof role !== "string") return null;
    return { userId, employeeId, role: role as Role, name: String(name ?? "") };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};
