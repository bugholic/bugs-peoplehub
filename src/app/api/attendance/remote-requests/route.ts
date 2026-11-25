import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, forbidden, requireSession, route } from "@/lib/authz";
import { parseQuery, remoteRequestListQuery } from "@/lib/validators";
import { remoteRequestInclude, serializeRemoteRequest } from "@/lib/attendance";

/** Remote work requests go to HR: only `attendance.remote_approve` sees everyone's. */
export const GET = route(async (req) => {
  const session = await requireSession();
  const q = parseQuery(remoteRequestListQuery, req);
  if (q.scope === "all" && !can(session, "attendance.remote_approve")) throw forbidden("You don't have permission to review remote work requests");
  const where: Prisma.RemoteWorkRequestWhereInput = { status: q.status };
  if (q.scope === "mine") where.employeeId = session.employeeId;
  const items = await db.remoteWorkRequest.findMany({ where, include: remoteRequestInclude, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ items: items.map(serializeRemoteRequest) });
});
