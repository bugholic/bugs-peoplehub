import { NextResponse } from "next/server";
import { requireSession, requirePermission, route, readJson, can, assertCanViewEmployee, forbidden } from "@/lib/authz";
import { adjustBalance, listAdjustments, serializeAdjustment } from "@/lib/leave";
import { onBalanceAdjusted } from "@/lib/notification-events";
import { balanceAdjustmentListQuery, balanceAdjustmentSchema, parseQuery } from "@/lib/validators";

/** An employee's balance adjustment history (defaults to self). */
export const GET = route(async (req) => {
  const session = await requireSession();
  const q = parseQuery(balanceAdjustmentListQuery, req);
  const employeeId = q.employeeId ?? session.employeeId;
  if (employeeId !== session.employeeId && !can(session, "leave.adjust_balances")) {
    await assertCanViewEmployee(session, employeeId, "leave");
  }
  return NextResponse.json({ items: await listAdjustments(employeeId, q.year) });
});

/** Credit or debit someone's leave balance (leave.adjust_balances; never your own). */
export const POST = route(async (req) => {
  const session = await requirePermission("leave.adjust_balances");
  const body = balanceAdjustmentSchema.parse(await readJson(req));
  if (body.employeeId === session.employeeId) throw forbidden("You can't adjust your own leave balance");
  const adjustment = serializeAdjustment(await adjustBalance(body, session.employeeId));
  await onBalanceAdjusted(adjustment, session.employeeId);
  return NextResponse.json(adjustment, { status: 201 });
});
