import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { forbidden, requireSession, route, notFound } from "@/lib/authz";
import { decisionSchema } from "@/lib/validators";
import { decideRemoteRequest, remoteRequestInclude, serializeRemoteRequest } from "@/lib/attendance";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, { params }) => {
  const session = await requireSession("ADMIN");
  const { id } = await params;
  const { note } = decisionSchema.parse(await req.json().catch(() => ({})));
  const existing = await db.remoteWorkRequest.findUnique({ where: { id } });
  if (!existing) throw notFound("Remote work request");
  if (existing.employeeId === session.employeeId) throw forbidden("You can't approve your own request");
  await decideRemoteRequest(id, session.employeeId, true, note);
  const updated = await db.remoteWorkRequest.findUniqueOrThrow({ where: { id }, include: remoteRequestInclude });
  return NextResponse.json(serializeRemoteRequest(updated));
});
