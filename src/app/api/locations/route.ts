import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route, readJson } from "@/lib/authz";
import { locationCreateSchema } from "@/lib/validators";
import { assertGeofencePair, assertUniqueLocationName, serializeLocation } from "@/lib/locations";

export const GET = route(async () => {
  await requireSession();
  const locations = await db.location.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ items: locations.map(serializeLocation) });
});

export const POST = route(async (req) => {
  await requireSession("ADMIN");
  const body = locationCreateSchema.parse(await readJson(req));
  assertGeofencePair(body);
  await assertUniqueLocationName(body.name);
  const location = await db.location.create({ data: body });
  return NextResponse.json(serializeLocation(location), { status: 201 });
});
