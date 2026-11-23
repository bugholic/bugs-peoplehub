import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireSession, route, readJson, isAdmin } from "@/lib/authz";
import { assertRefsInOrg } from "@/lib/refs";
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

  await assertRefsInOrg(body);

  // A directory record with no login yet: the person is linked to it by verified email
  // when they join the organization (see provisionEmployee). Invite them from Organization -> Members.
  const employee = await db.employee.create({
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
    },
    select: summary,
  });

  return NextResponse.json(serialize(employee), { status: 201 });
});
