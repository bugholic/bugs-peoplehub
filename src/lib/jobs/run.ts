import { dbUnscoped, runAsOrganization } from "../db";

/** Every organization with employees. Not tenant-scoped by design: this is a job's fan-out. */
export async function organizationIds(): Promise<string[]> {
  const rows = await dbUnscoped.employee.findMany({ distinct: ["organizationId"], select: { organizationId: true } });
  return rows.map((r) => r.organizationId).filter(Boolean);
}

export type OrgResult<T> = { organizationId: string; result?: T; error?: string };

/**
 * Runs `fn` once per organization with the tenant-scoped `db` bound to it. One org
 * failing is logged and reported, and doesn't stop the rest.
 */
export async function forEachOrganization<T>(job: string, fn: (organizationId: string) => Promise<T>): Promise<OrgResult<T>[]> {
  const results: OrgResult<T>[] = [];
  for (const organizationId of await organizationIds()) {
    try {
      results.push({ organizationId, result: await runAsOrganization(organizationId, () => fn(organizationId)) });
    } catch (err) {
      console.error(`job ${job} failed for`, organizationId, err);
      results.push({ organizationId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
