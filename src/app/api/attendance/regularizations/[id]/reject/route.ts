import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route, notFound, assertCanApprove } from "@/lib/authz";
import { decisionSchema } from "@/lib/validators";
import { decideRegularization } from "@/lib/attendance";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const { id } = await params;
  const { note } = decisionSchema.parse(await req.json().catch(() => ({})));
  const existing = await db.regularizationRequest.findUnique({ where: { id } });
  if (!existing) throw notFound("Regularization request");
  await assertCanApprove(session, existing.employeeId);
  const updated = await decideRegularization(id, session.employeeId, false, note);
  return NextResponse.json(updated);
});
