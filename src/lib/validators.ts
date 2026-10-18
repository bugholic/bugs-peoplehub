import { z } from "zod";
import { isIsoDate } from "./dates";

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
  .extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() });

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

export function parseQuery<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  return schema.parse(params);
}
