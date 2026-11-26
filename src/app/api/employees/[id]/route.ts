import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, requirePermission, route, readJson, notFound, forbidden, can } from "@/lib/authz";
import { employeeUpdateSchema, selfUpdateSchema } from "@/lib/validators";
import { toIsoDate } from "@/lib/dates";
import { assertRefsInOrg } from "@/lib/refs";
import { onEmployeeChanged } from "@/lib/approvals";

type Ctx = { params: Promise<{ id: string }> };

function serialize<T extends { joinDate: Date; clerkUserId: string | null }>(e: T) {
  const { clerkUserId, ...rest } = e;
  // hasLogin: this person has joined the organization in Clerk (the id itself stays server-side).
  return { ...rest, joinDate: toIsoDate(e.joinDate), hasLogin: clerkUserId !== null };
}

const detail = {
  id: true,
  empCode: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  photoUrl: true,
  joinDate: true,
  status: true,
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  shift: { select: { id: true, name: true, startTime: true, endTime: true } },
  reportingManager: { select: { id: true, firstName: true, lastName: true } },
  clerkUserId: true,
} as const;

export const GET = route<Ctx>(async (_req, { params }) => {
  await requireSession();
  const { id } = await params;
  const employee = await db.employee.findUnique({ where: { id }, select: detail });
  if (!employee) throw notFound("Employee");
  return NextResponse.json(serialize(employee));
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const { id } = await params;
  const existing = await db.employee.findUnique({ where: { id } });
  if (!existing) throw notFound("Employee");

  const admin = can(session, "employees.edit");
  if (!admin && id !== session.employeeId) throw forbidden();

  const body = await readJson(req);
  const { reportingManagerId, joinDate, ...rest } = admin
    ? employeeUpdateSchema.parse(body)
    : { ...selfUpdateSchema.parse(body), reportingManagerId: undefined, joinDate: undefined };

  await assertRefsInOrg({ ...rest, reportingManagerId });
  const employee = await db.employee.update({
    where: { id },
    data: {
      ...rest,
      ...(reportingManagerId !== undefined ? { reportingManagerId } : {}),
      ...(joinDate ? { joinDate: new Date(`${joinDate}T00:00:00Z`) } : {}),
    },
    select: detail,
  });
  await onEmployeeChanged(id, {
    managerChanged: reportingManagerId !== undefined && reportingManagerId !== existing.reportingManagerId,
    deactivated: existing.status === "ACTIVE" && employee.status === "INACTIVE",
  });
  return NextResponse.json(serialize(employee));
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  await requirePermission("employees.deactivate");
  const { id } = await params;
  const existing = await db.employee.findUnique({ where: { id } });
  if (!existing) throw notFound("Employee");
  const employee = await db.employee.update({ where: { id }, data: { status: "INACTIVE" }, select: detail });
  if (existing.status === "ACTIVE") await onEmployeeChanged(id, { managerChanged: false, deactivated: true });
  return NextResponse.json(serialize(employee));
});
