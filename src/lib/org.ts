import { clerkClient } from "@clerk/nextjs/server";
import { dbUnscoped } from "./db";
import { formatEmpCode, orgPrefix } from "./emp-code";

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** Registers the Clerk org locally the first time it's seen, fixing its employee-code prefix. */
export async function ensureOrganization(organizationId: string) {
  const existing = await dbUnscoped.organization.findUnique({ where: { id: organizationId } });
  if (existing) return existing;

  const clerk = await clerkClient();
  const org = await clerk.organizations.getOrganization({ organizationId });
  try {
    return await dbUnscoped.organization.create({
      data: { id: organizationId, name: org.name, empPrefix: orgPrefix(org.name) },
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e; // a concurrent request registered it first
    return dbUnscoped.organization.findUniqueOrThrow({ where: { id: organizationId } });
  }
}

/**
 * Next employee code for the organization, e.g. "AC001". The serial is an atomic
 * increment, so concurrent calls never get the same number (gaps are possible if a
 * later insert fails; codes are never reused).
 */
export async function nextEmpCode(organizationId: string): Promise<string> {
  await ensureOrganization(organizationId);
  const { empPrefix, empSerial } = await dbUnscoped.organization.update({
    where: { id: organizationId },
    data: { empSerial: { increment: 1 } },
    select: { empPrefix: true, empSerial: true },
  });
  return formatEmpCode(empPrefix, empSerial);
}
