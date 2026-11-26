import { NextResponse } from "next/server";
import { requirePermission, route, readJson } from "@/lib/authz";
import { shiftUpdateSchema } from "@/lib/validators";
import { deleteShift, updateShift } from "@/lib/shifts";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { params }) => {
  await requirePermission("attendance.manage_shifts");
  const { id } = await params;
  const body = shiftUpdateSchema.parse(await readJson(req));
  return NextResponse.json(await updateShift(id, body));
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  await requirePermission("attendance.manage_shifts");
  const { id } = await params;
  await deleteShift(id);
  return NextResponse.json({ ok: true });
});
