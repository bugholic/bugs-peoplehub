import { NextResponse } from "next/server";
import { requireSession, requirePermission, route, readJson } from "@/lib/authz";
import { shiftCreateSchema } from "@/lib/validators";
import { createShift, listShifts } from "@/lib/shifts";

export const GET = route(async () => {
  await requireSession();
  return NextResponse.json({ items: await listShifts() });
});

export const POST = route(async (req) => {
  await requirePermission("attendance.manage_shifts");
  const body = shiftCreateSchema.parse(await readJson(req));
  return NextResponse.json(await createShift(body), { status: 201 });
});
