import { NextResponse } from "next/server";
import { route } from "@/lib/authz";
import { SESSION_COOKIE } from "@/lib/session";

export const POST = route(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
