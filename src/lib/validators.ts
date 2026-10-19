import { z } from "zod";
import { isIsoDate } from "./dates";
import { badRequest } from "./errors";

const isoDate = z.string().refine(isIsoDate, "Must be a date in YYYY-MM-DD format");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be a time in HH:mm format");
const id = z.string().min(1);

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const employeeCreateSchema = z.object({
  empCode: z.string().trim().min(1).max(20),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z.email(),
  phone: z.string().trim().max(30).optional().nullable(),
  joinDate: isoDate,
  departmentId: id.optional().nullable(),
  designationId: id.optional().nullable(),
  locationId: id.optional().nullable(),
  reportingManagerId: id.optional().nullable(),
  role: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]).default("EMPLOYEE"),
  password: z.string().min(8).optional(),
});

export const employeeUpdateSchema = employeeCreateSchema
  .omit({ password: true })
  .partial()
  .extend({
    // Redeclared without `.default(...)`: partial() keeps each field's default,
    // which would silently resurrect role: "EMPLOYEE" on every partial update.
    role: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  });

/** Fields an employee may change on their own profile. */
export const selfUpdateSchema = z.object({ phone: z.string().trim().max(30).nullable() }).strict();

export const employeeListQuery = z.object({
  q: z.string().trim().optional(),
  departmentId: id.optional(),
  locationId: id.optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const leaveApplySchema = z.object({
  leaveTypeId: id,
  fromDate: isoDate,
  toDate: isoDate,
  dayPart: z.enum(["FULL", "FIRST_HALF", "SECOND_HALF"]).default("FULL"),
  reason: z.string().trim().min(3).max(500),
});

export const leaveListQuery = z.object({
  scope: z.enum(["mine", "team", "all"]).default("mine"),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const decisionSchema = z.object({ note: z.string().trim().max(500).optional() });

export const leaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(10).toUpperCase(),
  annualQuota: z.number().min(0).max(365),
  paid: z.boolean().default(true),
  carryForward: z.boolean().default(false),
  allowHalfDay: z.boolean().default(true),
});

export const holidaySchema = z.object({
  date: isoDate,
  name: z.string().trim().min(1).max(100),
  locationId: id.nullable().optional(),
});

export const monthQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Must be YYYY-MM"),
  employeeId: id.optional(),
});

export const regularizationSchema = z.object({
  date: isoDate,
  checkIn: hhmm,
  checkOut: hhmm,
  reason: z.string().trim().min(3).max(500),
});

export const regularizationListQuery = z.object({
  scope: z.enum(["mine", "team"]).default("mine"),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const punchLocationSchema = z.object({
  latitude,
  longitude,
  accuracy: z.number().min(0).optional(),
});

/** The punch body is optional: no body (location unavailable or denied) means null. */
export async function readPunchLocation(req: Request) {
  const text = await req.text();
  if (!text.trim()) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw badRequest("Body must be valid JSON");
  }
  return punchLocationSchema.parse(body);
}

export const locationCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  latitude: latitude.nullable().optional(),
  longitude: longitude.nullable().optional(),
  radiusMeters: z.number().int().min(20).max(5000).default(200),
});

export const locationUpdateSchema = locationCreateSchema.partial().extend({
  // Redeclared without `.default(...)`, as in employeeUpdateSchema.
  radiusMeters: z.number().int().min(20).max(5000).optional(),
});

export const remoteRequestListQuery = z.object({
  scope: z.enum(["mine", "all"]).default("mine"),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

export function parseQuery<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  return schema.parse(params);
}
