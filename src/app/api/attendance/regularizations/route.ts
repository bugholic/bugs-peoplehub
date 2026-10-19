import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireSession, route, readJson } from "@/lib/authz";
import { regularizationSchema, regularizationListQuery, parseQuery } from "@/lib/validators";
import { requestRegularization } from "@/lib/attendance";
import { toIsoDate } from "@/lib/dates";

const include = {
  employee: { select: { id: true, firstName: true, lastName: true, empCode: true } },
  approver: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.RegularizationRequestInclude;

function serialize(r: Prisma.RegularizationRequestGetPayload<{ include: typeof include }>) {
  return {
    id: r.id,
    employee: { id: r.employee.id, name: `${r.employee.firstName} ${r.employee.lastName}`, empCode: r.employee.empCode },
    date: toIsoDate(r.date),
    checkIn: r.checkIn.toISOString(),
    checkOut: r.checkOut.toISOString(),
    reason: r.reason,
    status: r.status,
    approver: r.approver ? { id: r.approver.id, name: `${r.approver.firstName} ${r.approver.lastName}` } : null,
    decisionNote: r.decisionNote,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export const GET = route(async (req) => {
  const session = await requireSession();
  const q = parseQuery(regularizationListQuery, req);
  const where: Prisma.RegularizationRequestWhereInput = { status: q.status };
  if (q.scope === "mine") {
    where.employeeId = session.employeeId;
  } else {
    where.employee = { reportingManagerId: session.employeeId };
  }
  const items = await db.regularizationRequest.findMany({ where, include, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ items: items.map(serialize) });
});

export const POST = route(async (req) => {
  const session = await requireSession();
  const body = regularizationSchema.parse(await readJson(req));
  const created = await requestRegularization(session.employeeId, body);
  const full = await db.regularizationRequest.findUniqueOrThrow({ where: { id: created.id }, include });
  return NextResponse.json(serialize(full), { status: 201 });
});
