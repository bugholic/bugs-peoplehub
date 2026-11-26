import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireSession, route, readJson, can, forbidden } from "@/lib/authz";
import { leaveApplySchema, leaveCombinedApplySchema, leaveListQuery, parseQuery } from "@/lib/validators";
import { onLeaveSubmitted } from "@/lib/notification-events";
import { applyCombinedLeave, applyLeave, leaveRequestInclude, serializeLeaveRequest } from "@/lib/leave";

export const GET = route(async (req) => {
  const session = await requireSession();
  const q = parseQuery(leaveListQuery, req);

  const where: Prisma.LeaveRequestWhereInput = { status: q.status };
  if (q.year) {
    where.fromDate = { gte: new Date(Date.UTC(q.year, 0, 1)), lte: new Date(Date.UTC(q.year, 11, 31)) };
  }
  if (q.scope === "mine") {
    where.employeeId = session.employeeId;
  } else if (q.scope === "team") {
    if (!can(session, "leave.approve_team") && !can(session, "leave.approve_all")) throw forbidden();
    // Direct reports, plus anything routed to you (escalated from a manager below you).
    where.OR = [{ employee: { reportingManagerId: session.employeeId } }, { approverId: session.employeeId }];
  } else {
    if (!can(session, "leave.approve_all")) throw forbidden();
  }

  const requests = await db.leaveRequest.findMany({
    where,
    include: leaveRequestInclude,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items: requests.map(serializeLeaveRequest) });
});

export const POST = route(async (req) => {
  const session = await requireSession();
  const json = await readJson(req);
  // A body with `parts` is a combined leave (several types over one range); it returns every part.
  if (json && typeof json === "object" && "parts" in json) {
    const created = await applyCombinedLeave(session.employeeId, leaveCombinedApplySchema.parse(json));
    await onLeaveSubmitted(created[0].id, session.organizationId);
    const parts = await db.leaveRequest.findMany({
      where: { id: { in: created.map((c) => c.id) } },
      include: leaveRequestInclude,
      orderBy: { fromDate: "asc" },
    });
    return NextResponse.json({ groupId: created[0].groupId, items: parts.map(serializeLeaveRequest) }, { status: 201 });
  }
  const body = leaveApplySchema.parse(json);
  const created = await applyLeave(session.employeeId, body);
  await onLeaveSubmitted(created.id, session.organizationId);
  const full = await db.leaveRequest.findUniqueOrThrow({ where: { id: created.id }, include: leaveRequestInclude });
  return NextResponse.json(serializeLeaveRequest(full), { status: 201 });
});
