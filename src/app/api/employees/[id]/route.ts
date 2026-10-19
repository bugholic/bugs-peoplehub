import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route, readJson, notFound, forbidden, isAdmin } from "@/lib/authz";
import { employeeUpdateSchema, selfUpdateSchema } from "@/lib/validators";
import { toIsoDate } from "@/lib/dates";

type Ctx = { params: Promise<{ id: string }> };

function serialize<T extends { joinDate: Date }>(e: T) {
  return { ...e, joinDate: toIsoDate(e.joinDate) };
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
  reportingManager: { select: { id: true, firstName: true, lastName: true } },
  user: { select: { role: true } },
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

  const admin = isAdmin(session);
  if (!admin && id !== session.employeeId) throw forbidden();

  const body = await readJson(req);
  const { role, reportingManagerId, joinDate, ...rest } = admin
    ? employeeUpdateSchema.parse(body)
    : { ...selfUpdateSchema.parse(body), role: undefined, reportingManagerId: undefined, joinDate: undefined };

  const employee = await db.$transaction(async (tx) => {
    if (role && existing.userId) {
      await tx.user.update({ where: { id: existing.userId }, data: { role } });
    }
    return tx.employee.update({
      where: { id },
      data: {
        ...rest,
        ...(reportingManagerId !== undefined ? { reportingManagerId } : {}),
        ...(joinDate ? { joinDate: new Date(`${joinDate}T00:00:00Z`) } : {}),
      },
      select: detail,
    });
  });
  return NextResponse.json(serialize(employee));
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  await requireSession("ADMIN");
  const { id } = await params;
  const existing = await db.employee.findUnique({ where: { id } });
  if (!existing) throw notFound("Employee");
  const employee = await db.employee.update({ where: { id }, data: { status: "INACTIVE" }, select: detail });
  return NextResponse.json(serialize(employee));
});
