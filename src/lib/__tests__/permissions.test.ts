import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ROLE_PRESETS, defaultPermissions, isPermission, sanitizePermissions } from "../permissions";

describe("permission catalog", () => {
  it("has unique keys", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it("presets only reference catalog permissions", () => {
    for (const p of ROLE_PRESETS) for (const k of p.permissions) expect(isPermission(k)).toBe(true);
  });

  it("sanitize drops unknown keys and duplicates", () => {
    expect(sanitizePermissions(["org.structure", "payroll.run", "org.structure"])).toEqual(["org.structure"]);
  });

  it("defaults mirror the pre-roles Clerk behaviour", () => {
    expect(defaultPermissions("ADMIN")).toEqual(ALL_PERMISSIONS);
    expect(defaultPermissions("MANAGER")).toEqual(["leave.approve_team", "attendance.approve_team", "attendance.report_team"]);
    expect(defaultPermissions("EMPLOYEE")).toEqual([]);
  });
});
