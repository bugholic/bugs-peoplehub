import { db, dbUnscoped, currentOrganizationId } from "./db";
import { APP_TZ } from "./dates";
import { DEFAULT_WEEK_OFF } from "./week-off";

export { isValidTimeZone } from "./dates";

/**
 * Time zones (docs/TODO.md T15). "Today", punch dates, shift windows, regularization times
 * and the times shown to a person all use *their* zone: their location's `timeZone` if set,
 * else the organization's (`Organization.timeZone`, default Asia/Kolkata).
 */

/** The active organization's zone. */
export async function organizationTimeZone(organizationId?: string): Promise<string> {
  const id = organizationId ?? (await currentOrganizationId());
  const org = await dbUnscoped.organization.findUnique({ where: { id }, select: { timeZone: true } });
  return org?.timeZone ?? APP_TZ;
}

/** An employee's zone: their location's override, else the organization's. */
export async function employeeTimeZone(employeeId: string): Promise<string> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { location: { select: { timeZone: true } } } });
  return e?.location?.timeZone ?? (await organizationTimeZone());
}

/**
 * Week-off pattern (docs/TODO.md T14) for people at a location: its override, else the
 * organization's (`Organization.weekOff`, default Sat + Sun). See src/lib/week-off.ts.
 */
export async function organizationWeekOff(organizationId?: string): Promise<string> {
  const id = organizationId ?? (await currentOrganizationId());
  const org = await dbUnscoped.organization.findUnique({ where: { id }, select: { weekOff: true } });
  return org?.weekOff ?? DEFAULT_WEEK_OFF;
}

export async function locationWeekOff(locationId: string | null): Promise<string> {
  const loc = locationId ? await db.location.findUnique({ where: { id: locationId }, select: { weekOff: true } }) : null;
  return loc?.weekOff ?? (await organizationWeekOff());
}

export async function employeeWeekOff(employeeId: string): Promise<string> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { location: { select: { weekOff: true } } } });
  return e?.location?.weekOff ?? (await organizationWeekOff());
}
