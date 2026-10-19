import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route, readJson, notFound } from "@/lib/authz";
import { locationUpdateSchema } from "@/lib/validators";
import { assertGeofencePair, assertUniqueLocationName, serializeLocation } from "@/lib/locations";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { params }) => {
  await requireSession("ADMIN");
  const { id } = await params;
  const body = locationUpdateSchema.parse(await readJson(req));
  assertGeofencePair(body);
  const existing = await db.location.findUnique({ where: { id } });
  if (!existing) throw notFound("Location");
  if (body.name && body.name !== existing.name) await assertUniqueLocationName(body.name);
  const location = await db.location.update({ where: { id }, data: body });
  return NextResponse.json(serializeLocation(location));
});
