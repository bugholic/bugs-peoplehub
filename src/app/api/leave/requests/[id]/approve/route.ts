import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route, notFound, assertCanApprove } from "@/lib/authz";
import { decisionSchema } from "@/lib/validators";
import { approveLeave, leaveRequestInclude, serializeLeaveRequest } from "@/lib/leave";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const { id } = await params;
  const { note } = decisionSchema.parse(await req.json().catch(() => ({})));
  const existing = await db.leaveRequest.findUnique({ where: { id } });
  if (!existing) throw notFound("Leave request");
  await assertCanApprove(session, existing.employeeId);
  await approveLeave(id, session.employeeId, note);
  const full = await db.leaveRequest.findUniqueOrThrow({ where: { id }, include: leaveRequestInclude });
  return NextResponse.json(serializeLeaveRequest(full));
});
