import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route, notFound } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = route<Ctx>(async (_req, { params }) => {
  await requireSession("ADMIN");
  const { id } = await params;
  const existing = await db.holiday.findUnique({ where: { id } });
  if (!existing) throw notFound("Holiday");
  await db.holiday.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
