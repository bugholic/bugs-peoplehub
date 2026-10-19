import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route, readJson, conflict } from "@/lib/authz";
import { leaveTypeSchema } from "@/lib/validators";

export const GET = route(async () => {
  await requireSession();
  const types = await db.leaveType.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return NextResponse.json({ items: types });
});

export const POST = route(async (req) => {
  await requireSession("ADMIN");
  const body = leaveTypeSchema.parse(await readJson(req));
  const existing = await db.leaveType.findFirst({ where: { OR: [{ name: body.name }, { code: body.code }] } });
  if (existing) throw conflict("A leave type with this name or code already exists", "DUPLICATE");
  const type = await db.leaveType.create({ data: body });
  return NextResponse.json(type, { status: 201 });
});
