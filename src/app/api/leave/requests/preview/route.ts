import { NextResponse } from "next/server";
import { requireSession, route } from "@/lib/authz";
import { leavePreviewQuery, parseQuery } from "@/lib/validators";
import { previewLeave } from "@/lib/leave";

/** What a leave request would take, with a suggested combined split when one type isn't enough. */
export const GET = route(async (req) => {
  const session = await requireSession();
  return NextResponse.json(await previewLeave(session.employeeId, parseQuery(leavePreviewQuery, req)));
});
