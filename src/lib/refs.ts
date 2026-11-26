import { db } from "./db";
import { badRequest } from "./errors";

type Refs = {
  departmentId?: string | null;
  designationId?: string | null;
  locationId?: string | null;
  reportingManagerId?: string | null;
  shiftId?: string | null;
};

/**
 * The tenant client scopes rows, not ids a caller sends. Before writing foreign keys taken
 * from a request body, confirm each one exists in the active organization.
 */
export async function assertRefsInOrg(r: Refs) {
  const checks: Array<[string | null | undefined, string, (id: string) => Promise<number>]> = [
    [r.departmentId, "department", (id) => db.department.count({ where: { id } })],
    [r.designationId, "designation", (id) => db.designation.count({ where: { id } })],
    [r.locationId, "location", (id) => db.location.count({ where: { id } })],
    [r.shiftId, "shift", (id) => db.shift.count({ where: { id } })],
    [r.reportingManagerId, "reporting manager", (id) => db.employee.count({ where: { id } })],
  ];
  for (const [id, label, count] of checks) {
    if (id && (await count(id)) === 0) throw badRequest(`Unknown ${label}`, "INVALID_REFERENCE");
  }
}
