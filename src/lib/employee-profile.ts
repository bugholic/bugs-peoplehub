import type { EmployeeProfile } from "@/generated/prisma/client";
import { db } from "./db";
import { forbidden, notFound } from "./errors";
import { parseIsoDate, toIsoDate } from "./dates";
import { PROFILE_FIELDS, PROFILE_SECTIONS, SECTION_LABELS, sectionAccess, sectionOf, type ProfileSection, type SectionAccess } from "./profile-fields";
import type { Session } from "./session";

/**
 * Extended profile (docs/TODO.md T20/T21): reading and writing the EmployeeProfile row, one
 * section at a time, gated by src/lib/profile-fields.ts#sectionAccess.
 */

const DATE_FIELDS = new Set(["dateOfBirth", "probationEndDate"]);

/** The viewer's access to an employee's profile sections. */
export async function accessFor(session: Pick<Session, "employeeId" | "permissions">, employeeId: string): Promise<SectionAccess> {
  const self = session.employeeId === employeeId;
  let manager = false;
  if (!self) {
    const e = await db.employee.findUnique({ where: { id: employeeId }, select: { reportingManagerId: true } });
    if (!e) throw notFound("Employee");
    manager = e.reportingManagerId === session.employeeId;
  }
  return sectionAccess({ self, manager, perms: session.permissions });
}

export type ProfileData = Partial<Record<ProfileSection, Record<string, string | number | null>>>;

function toValue(key: string, v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (DATE_FIELDS.has(key)) return toIsoDate(v as Date);
  return v as string | number;
}

/** Only the sections the viewer may see; each field is null when never set. */
export function serializeProfile(row: EmployeeProfile | null, access: SectionAccess): ProfileData {
  const out: ProfileData = {};
  for (const section of PROFILE_SECTIONS) {
    if (!access.view[section]) continue;
    out[section] = Object.fromEntries(
      PROFILE_FIELDS.filter((f) => f.section === section).map((f) => [f.key, toValue(f.key, row ? (row as Record<string, unknown>)[f.key] : null)]),
    );
  }
  return out;
}

export async function getProfile(employeeId: string, access: SectionAccess) {
  const row = await db.employeeProfile.findUnique({ where: { employeeId } });
  return { access, data: serializeProfile(row, access) };
}

/**
 * Applies a validated partial update. Every field's section must be editable by the caller;
 * otherwise nothing is written and the error names the sections that were refused.
 */
export async function updateProfile(employeeId: string, patch: Record<string, unknown>, access: SectionAccess) {
  const refused = new Set<ProfileSection>();
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const section = sectionOf(key);
    if (!section) continue;
    if (!access.edit[section]) refused.add(section);
    data[key] = DATE_FIELDS.has(key) && typeof value === "string" ? parseIsoDate(value) : value;
  }
  if (refused.size > 0) {
    throw forbidden(`You can't change ${[...refused].map((s) => SECTION_LABELS[s].title.toLowerCase()).join(" or ")} details for this employee`);
  }
  const row = await db.employeeProfile.upsert({ where: { employeeId }, create: { employeeId, ...data }, update: data });
  return { access, data: serializeProfile(row, access) };
}
