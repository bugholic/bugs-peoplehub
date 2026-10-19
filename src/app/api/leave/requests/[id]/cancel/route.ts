import { NextResponse } from "next/server";
import { requireSession, route } from "@/lib/authz";
import { cancelLeave, leaveRequestInclude, serializeLeaveRequest } from "@/lib/leave";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const { id } = await params;
  await cancelLeave(id, session.employeeId);
  const full = await db.leaveRequest.findUniqueOrThrow({ where: { id }, include: leaveRequestInclude });
  return NextResponse.json(serializeLeaveRequest(full));
});
