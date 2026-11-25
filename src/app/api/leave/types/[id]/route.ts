import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, route, readJson, conflict, notFound } from "@/lib/authz";
import { leaveTypeUpdateSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Edit a leave type. Carry-forward settings apply immediately (carry is computed on read).
 * A new annualQuota applies to balance years created from now on; already-created
 * LeaveBalance rows keep their grant (see docs/TODO.md T5).
 */
export const PATCH = route<Ctx>(async (req, { params }) => {
  await requirePermission("leave.manage_types");
  const { id } = await params;
  const body = leaveTypeUpdateSchema.parse(await readJson(req));

  const existing = await db.leaveType.findUnique({ where: { id } });
  if (!existing) throw notFound("Leave type");
  if (body.name !== undefined || body.code !== undefined) {
    const clash = await db.leaveType.findFirst({
      where: {
        id: { not: id },
        OR: [...(body.name ? [{ name: body.name }] : []), ...(body.code ? [{ code: body.code }] : [])],
      },
    });
    if (clash) throw conflict("A leave type with this name or code already exists", "DUPLICATE");
  }

  const type = await db.leaveType.update({ where: { id }, data: body });
  return NextResponse.json(type);
});
