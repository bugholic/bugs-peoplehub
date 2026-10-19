import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, route, readJson } from "@/lib/authz";
import { holidaySchema, parseQuery } from "@/lib/validators";
import { toIsoDate } from "@/lib/dates";

const query = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  locationId: z.string().min(1).optional(),
});

function serialize<T extends { date: Date }>(h: T) {
  return { ...h, date: toIsoDate(h.date) };
}

export const GET = route(async (req) => {
  await requireSession();
  const q = parseQuery(query, req);
  const holidays = await db.holiday.findMany({
    where: {
      date: { gte: new Date(Date.UTC(q.year, 0, 1)), lte: new Date(Date.UTC(q.year, 11, 31)) },
      ...(q.locationId ? { OR: [{ locationId: null }, { locationId: q.locationId }] } : {}),
    },
    include: { location: { select: { id: true, name: true } } },
    orderBy: { date: "asc" },
  });
  return NextResponse.json({ items: holidays.map(serialize) });
});

export const POST = route(async (req) => {
  await requireSession("ADMIN");
  const body = holidaySchema.parse(await readJson(req));
  const holiday = await db.holiday.create({
    data: { date: new Date(`${body.date}T00:00:00Z`), name: body.name, locationId: body.locationId },
  });
  return NextResponse.json(serialize(holiday), { status: 201 });
});
