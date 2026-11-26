import { z } from "zod";
import { isIsoDate, isValidTimeZone } from "./dates";
import { isValidWeekOff, normalizeWeekOff } from "./week-off";
import { badRequest } from "./errors";
import { isPermission } from "./permissions";
import { normalizePhone } from "./phone";
import { BLOOD_GROUPS, EMPLOYMENT_TYPES, GENDERS, MARITAL_STATUSES } from "./profile-fields";

const isoDate = z.string().refine(isIsoDate, "Must be a date in YYYY-MM-DD format");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be a time in HH:mm format");
const id = z.string().min(1);

/** Accepts any common format; stores E.164. A number without a country code gets +91 (see lib/phone.ts). */
const phone = z
  .string()
  .max(30)
  .nullable()
  .transform((v, ctx) => {
    try {
      return normalizePhone(v);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  });

export const employeeCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z.email(),
  phone: phone.optional(),
  joinDate: isoDate,
  departmentId: id.optional().nullable(),
  designationId: id.optional().nullable(),
  locationId: id.optional().nullable(),
  reportingManagerId: id.optional().nullable(),
  // null = the organization default shift
  shiftId: id.optional().nullable(),
});

// Roles live in Clerk (organization roles), not on the employee record.
export const employeeUpdateSchema = employeeCreateSchema.partial().extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

/** Fields an employee may change on their own profile. */
export const selfUpdateSchema = z.object({ phone }).strict();

// ---- Extended profile (T20). Every field may be null to clear it; send only the fields to change. ----
const optText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable();
/** Upper-cased, spaces and dashes removed, then matched against `re`. "" clears. */
const idNumber = (re: RegExp, what: string) =>
  z
    .string()
    .max(40)
    .transform((v) => v.replace(/[\s-]/g, "").toUpperCase())
    .refine((v) => v === "" || re.test(v), `Not a valid ${what}`)
    .transform((v) => v || null)
    .nullable();

export const employeeProfileSchema = z
  .object({
    dateOfBirth: isoDate.refine((d) => d < new Date().toISOString().slice(0, 10), "Must be in the past").nullable(),
    gender: z.enum(GENDERS).nullable(),
    maritalStatus: z.enum(MARITAL_STATUSES).nullable(),
    bloodGroup: z.enum(BLOOD_GROUPS).nullable(),
    nationality: optText(60),
    personalEmail: z.union([z.literal("").transform(() => null), z.email().max(120)]).nullable(),
    currentAddress: optText(300),
    permanentAddress: optText(300),

    emergencyName: optText(100),
    emergencyRelation: optText(50),
    emergencyPhone: phone,

    employmentType: z.enum(EMPLOYMENT_TYPES).nullable(),
    probationEndDate: isoDate.nullable(),
    noticePeriodDays: z.number().int().min(0).max(365).nullable(),

    panNumber: idNumber(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN (like ABCDE1234F)"),
    aadhaarNumber: idNumber(/^\d{12}$/, "Aadhaar number (12 digits)"),
    passportNumber: idNumber(/^[A-Z0-9]{6,9}$/, "passport number"),
    bankAccountName: optText(100),
    bankName: optText(100),
    bankAccountNumber: idNumber(/^\d{6,20}$/, "account number (6-20 digits)"),
    bankIfsc: idNumber(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC (like HDFC0001234)"),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

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

/** Combined leave: one date range split across leave types, in order (full days only). */
export const leaveCombinedApplySchema = z.object({
  fromDate: isoDate,
  toDate: isoDate,
  reason: z.string().trim().min(3).max(500),
  parts: z
    .array(z.object({ leaveTypeId: id, days: z.number().int().min(1).max(366) }))
    .min(2, "A combined leave needs at least two leave types")
    .max(5),
});

export const leavePreviewQuery = leaveApplySchema.omit({ reason: true });

export const leaveListQuery = z.object({
  scope: z.enum(["mine", "team", "all"]).default("mine"),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// First day back at work (everything from here on is released); optional note shown to the employee on a revoke.
export const leaveShortenSchema = z.object({ returnOn: isoDate, note: z.string().trim().max(500).optional() }).strict();

export const decisionSchema = z.object({ note: z.string().trim().max(500).optional() });

const leaveTypeFields = {
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(10).toUpperCase(),
  annualQuota: z.number().min(0).max(365),
  paid: z.boolean(),
  carryForward: z.boolean(),
  // Cap on unused days carried into the next year; null = no cap. Only used when carryForward is on.
  maxCarryForward: z.number().min(0).max(365).multipleOf(0.5).nullable(),
  allowHalfDay: z.boolean(),
};

export const leaveTypeSchema = z.object({
  ...leaveTypeFields,
  paid: leaveTypeFields.paid.default(true),
  carryForward: leaveTypeFields.carryForward.default(false),
  maxCarryForward: leaveTypeFields.maxCarryForward.default(null),
  allowHalfDay: leaveTypeFields.allowHalfDay.default(true),
});

// Built from the default-free fields: `.partial()` keeps a field's `.default()`, which
// would silently reset e.g. `paid` to true on every partial edit.
export const leaveTypeUpdateSchema = z.object(leaveTypeFields).partial().strict();

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

const timeZone = z.string().refine(isValidTimeZone, "Must be an IANA time zone, e.g. Asia/Kolkata");

// Week-off pattern (src/lib/week-off.ts), stored canonical.
const weekOff = z
  .string()
  .max(100)
  .refine(isValidWeekOff, "Pattern like \"0,6\" or \"0,6#2,6#4\" (0 = Sunday); at least one weekday must stay working")
  .transform(normalizeWeekOff);

const hhmmOrNull = hhmm.nullable();

export const attendanceEditSchema = z
  .object({
    employeeId: z.string().min(1),
    date: isoDate,
    // Both set = the day's times (employee's zone; check-out <= check-in = next day); both null = clear the day.
    checkIn: hhmmOrNull,
    checkOut: hhmmOrNull,
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .refine((v) => (v.checkIn === null) === (v.checkOut === null), { message: "Set both times, or neither to clear the day", path: ["checkOut"] });

export const attendanceImportSchema = z
  .object({
    csv: z.string().min(1).max(500_000),
    dryRun: z.boolean().default(true),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const attendanceEditsQuery = z.object({ employeeId: z.string().min(1), month: z.string().regex(/^\d{4}-\d{2}$/).optional() });

export const organizationSettingsSchema = z
  .object({ timeZone, weekOff })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const locationCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  // null = the organization's zone
  timeZone: timeZone.nullable().optional(),
  // null = the organization's week-off pattern
  weekOff: weekOff.nullable().optional(),
  latitude: latitude.nullable().optional(),
  longitude: longitude.nullable().optional(),
  radiusMeters: z.number().int().min(20).max(5000).default(200),
});

export const locationUpdateSchema = locationCreateSchema.partial().extend({
  // Redeclared without `.default(...)`, as in employeeUpdateSchema.
  radiusMeters: z.number().int().min(20).max(5000).optional(),
});

const shiftFields = {
  name: z.string().trim().min(1).max(60),
  startTime: hhmm,
  endTime: hhmm,
  graceMinutes: z.number().int().min(0).max(240),
  halfDayMinutes: z.number().int().min(0).max(24 * 60),
  fullDayMinutes: z.number().int().min(1).max(24 * 60),
  isDefault: z.boolean(),
};
export const shiftCreateSchema = z
  .object(shiftFields)
  .extend({
    graceMinutes: shiftFields.graceMinutes.default(15),
    halfDayMinutes: shiftFields.halfDayMinutes.default(240),
    fullDayMinutes: shiftFields.fullDayMinutes.default(480),
    isDefault: shiftFields.isDefault.default(false),
  })
  .strict();
// Built from the default-free fields: .partial() would keep the defaults and overwrite on PATCH.
export const shiftUpdateSchema = z.object(shiftFields).partial().strict();

export const remoteRequestListQuery = z.object({
  scope: z.enum(["mine", "all"]).default("mine"),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

export function parseQuery<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  return schema.parse(params);
}

export const nameSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const addMemberSchema = z.object({
  email: z.email(),
  role: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]).default("EMPLOYEE"),
});

export const accessRoleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).nullable().optional(),
  // Unknown keys are rejected rather than silently dropped, so a typo can't look like it saved.
  permissions: z.array(z.string().refine(isPermission, "Unknown permission")).max(100),
});

export const accessRoleUpdateSchema = accessRoleSchema.partial();

export const assignAccessRoleSchema = z.object({ accessRoleId: id.nullable() });

export const balanceAdjustmentSchema = z.object({
  employeeId: id,
  leaveTypeId: id,
  year: z.number().int().min(2000).max(2100),
  // Signed: positive credits, negative debits. Half-day granularity.
  days: z
    .number()
    .min(-365)
    .max(365)
    .multipleOf(0.5)
    .refine((n) => n !== 0, "An adjustment can't be zero days"),
  reason: z.string().trim().min(3).max(500),
});

export const balanceAdjustmentListQuery = z.object({
  employeeId: id.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const notificationListQuery = z.object({
  unread: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** `ids` omitted = mark all read. */
export const notificationReadSchema = z.object({ ids: z.array(id).min(1).max(200).optional() }).strict();
