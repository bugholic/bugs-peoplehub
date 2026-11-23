import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route, readJson, conflict } from "@/lib/authz";
import { nameSchema } from "@/lib/validators";

export const GET = route(async () => {
  await requireSession();
  const items = await db.department.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ items });
});

export const POST = route(async (req) => {
  await requireSession("ADMIN");
  const { name } = nameSchema.parse(await readJson(req));
  if (await db.department.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) {
    throw conflict("A department with this name already exists", "DUPLICATE");
  }
  const item = await db.department.create({ data: { name } });
  return NextResponse.json(item, { status: 201 });
});
