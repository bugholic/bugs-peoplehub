import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, requirePermission, route, readJson, conflict } from "@/lib/authz";
import { nameSchema } from "@/lib/validators";

export const GET = route(async () => {
  await requireSession();
  const items = await db.designation.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ items });
});

export const POST = route(async (req) => {
  await requirePermission("org.structure");
  const { name } = nameSchema.parse(await readJson(req));
  if (await db.designation.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) {
    throw conflict("A designation with this name already exists", "DUPLICATE");
  }
  const item = await db.designation.create({ data: { name } });
  return NextResponse.json(item, { status: 201 });
});
