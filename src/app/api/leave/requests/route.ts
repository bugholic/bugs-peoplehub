import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireSession, route, readJson, isAdmin } from "@/lib/authz";
import { leaveApplySchema, leaveListQuery, parseQuery } from "@/lib/validators";
import { applyLeave, leaveRequestInclude, serializeLeaveRequest } from "@/lib/leave";

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
    where.employee = { reportingManagerId: session.employeeId };
  } else {
    if (!isAdmin(session)) where.employee = { reportingManagerId: session.employeeId };
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
  const body = leaveApplySchema.parse(await readJson(req));
  const created = await applyLeave(session.employeeId, body);
  const full = await db.leaveRequest.findUniqueOrThrow({ where: { id: created.id }, include: leaveRequestInclude });
  return NextResponse.json(serializeLeaveRequest(full), { status: 201 });
});
