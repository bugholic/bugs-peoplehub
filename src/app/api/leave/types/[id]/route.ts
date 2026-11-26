import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, route, readJson, conflict } from "@/lib/authz";
import { updateLeaveType } from "@/lib/leave";
import { leaveTypeUpdateSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Edit a leave type. Carry-forward settings apply immediately (carry is computed on read).
 * A new annualQuota also moves this year's and next year's existing balances by the
 * difference, logged as QUOTA_CHANGE adjustments (see src/lib/leave.ts#updateLeaveType).
 */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const session = await requirePermission("leave.manage_types");
  const { id } = await params;
  const body = leaveTypeUpdateSchema.parse(await readJson(req));

  if (body.name !== undefined || body.code !== undefined) {
    const clash = await db.leaveType.findFirst({
      where: {
        id: { not: id },
        OR: [...(body.name ? [{ name: body.name }] : []), ...(body.code ? [{ code: body.code }] : [])],
      },
    });
    if (clash) throw conflict("A leave type with this name or code already exists", "DUPLICATE");
  }

  const { type, balancesUpdated } = await updateLeaveType(id, body, session.employeeId);
  return NextResponse.json({ ...type, balancesUpdated });
});
