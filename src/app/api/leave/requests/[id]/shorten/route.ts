import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertCanApprove, notFound, readJson, requireSession, route } from "@/lib/authz";
import { leaveShortenSchema } from "@/lib/validators";
import { leaveRequestInclude, serializeLeaveRequest, shortenLeave } from "@/lib/leave";
import { onLeaveShortened } from "@/lib/notification-events";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Ends approved leave early: everything from `returnOn` (the first day back) is released and
 * the balance restored. The applicant can do it to their own leave (returning early, including
 * leave that has already started); a manager or HR who could approve it can do it as a revoke
 * (the optional `note` goes to the employee). `returnOn` can't be in the past.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const { id } = await params;
  const { returnOn, note } = leaveShortenSchema.parse(await readJson(req));
  const existing = await db.leaveRequest.findUnique({ where: { id } });
  if (!existing) throw notFound("Leave request");
  const revoke = existing.employeeId !== session.employeeId;
  if (revoke) await assertCanApprove(session, existing.employeeId, "leave", existing.approverId);

  const result = await shortenLeave(id, returnOn, note, revoke ? session.employeeId : undefined);
  await onLeaveShortened(id, session.organizationId, session.employeeId, result, returnOn, note);
  const full = await db.leaveRequest.findUniqueOrThrow({ where: { id }, include: leaveRequestInclude });
  return NextResponse.json({ ...result, revoked: revoke, request: serializeLeaveRequest(full) });
});
