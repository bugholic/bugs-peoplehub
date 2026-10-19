import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireSession, route, readJson, badRequest, isAdmin } from "@/lib/authz";
import { employeeCreateSchema, employeeListQuery, parseQuery } from "@/lib/validators";
import { toIsoDate } from "@/lib/dates";

function serialize<T extends { joinDate: Date }>(e: T) {
  return { ...e, joinDate: toIsoDate(e.joinDate) };
}

const summary = {
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
  reportingManagerId: true,
} satisfies Prisma.EmployeeSelect;

export const GET = route(async (req) => {
  const session = await requireSession();
  const q = parseQuery(employeeListQuery, req);
  const status = q.status === "ALL" ? undefined : isAdmin(session) ? q.status : "ACTIVE";

  const where: Prisma.EmployeeWhereInput = {
    status,
    departmentId: q.departmentId,
    locationId: q.locationId,
    ...(q.q
      ? {
          OR: [
            { firstName: { contains: q.q, mode: "insensitive" } },
            { lastName: { contains: q.q, mode: "insensitive" } },
            { empCode: { contains: q.q, mode: "insensitive" } },
            { email: { contains: q.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      select: summary,
      orderBy: { firstName: "asc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);

  return NextResponse.json({ items: items.map(serialize), total, page: q.page, pageSize: q.pageSize });
});

export const POST = route(async (req) => {
  await requireSession("ADMIN");
  const body = employeeCreateSchema.parse(await readJson(req));

  const employee = await db.$transaction(async (tx) => {
    let userId: string | undefined;
    if (body.password) {
      const existing = await tx.user.findUnique({ where: { email: body.email } });
      if (existing) throw badRequest("A user with this email already exists", "EMAIL_TAKEN");
      const passwordHash = await bcrypt.hash(body.password, 10);
      const user = await tx.user.create({ data: { email: body.email, passwordHash, role: body.role } });
      userId = user.id;
    }
    return tx.employee.create({
      data: {
        empCode: body.empCode,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        joinDate: new Date(`${body.joinDate}T00:00:00Z`),
        departmentId: body.departmentId,
        designationId: body.designationId,
        locationId: body.locationId,
        reportingManagerId: body.reportingManagerId,
        userId,
      },
      select: summary,
    });
  });

  return NextResponse.json(serialize(employee), { status: 201 });
});
