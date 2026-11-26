import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_employee_profile";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: ORG }) }));

import { db, dbUnscoped } from "../db";
import { maskTail, sectionAccess } from "../profile-fields";
import { accessFor, getProfile, updateProfile } from "../employee-profile";
import { employeeProfileSchema } from "../validators";
import { parseIsoDate } from "../dates";

const none = { self: false, manager: false, perms: [] as string[] };

describe("sectionAccess (T21)", () => {
  it("lets an employee see everything of their own but change only personal and emergency", () => {
    const a = sectionAccess({ ...none, self: true });
    expect(a.view).toEqual({ personal: true, emergency: true, employment: true, sensitive: true });
    expect(a.edit).toEqual({ personal: true, emergency: true, employment: false, sensitive: false });
  });

  it("gives a direct manager the general sections read-only, and no sensitive ones", () => {
    const a = sectionAccess({ ...none, manager: true });
    expect(a.view).toEqual({ personal: true, emergency: true, employment: true, sensitive: false });
    expect(Object.values(a.edit).some(Boolean)).toBe(false);
  });

  it("gives employees.edit the general sections but not the sensitive ones", () => {
    const a = sectionAccess({ ...none, perms: ["employees.edit"] });
    expect(a.edit).toEqual({ personal: true, emergency: true, employment: true, sensitive: false });
    expect(a.view.sensitive).toBe(false);
  });

  it("separates viewing from editing sensitive details", () => {
    expect(sectionAccess({ ...none, perms: ["employees.view_sensitive"] })).toMatchObject({ view: { sensitive: true }, edit: { sensitive: false } });
    expect(sectionAccess({ ...none, perms: ["employees.edit_sensitive"] })).toMatchObject({ view: { sensitive: true }, edit: { sensitive: true } });
  });

  it("shows nothing to an unrelated colleague", () => {
    const a = sectionAccess(none);
    expect([...Object.values(a.view), ...Object.values(a.edit)].some(Boolean)).toBe(false);
  });

  it("masks all but the last four characters", () => {
    expect(maskTail("123456789012")).toBe("XXXXXXXX9012");
    expect(maskTail("123")).toBe("123");
  });
});

describe("employeeProfileSchema", () => {
  it("normalizes identity numbers and bank details", () => {
    expect(
      employeeProfileSchema.parse({ panNumber: "abcde 1234-f", aadhaarNumber: "1234 5678 9012", bankIfsc: "hdfc0001234", emergencyPhone: "98765 43210" }),
    ).toEqual({ panNumber: "ABCDE1234F", aadhaarNumber: "123456789012", bankIfsc: "HDFC0001234", emergencyPhone: "+919876543210" });
  });

  it("treats blanks as clearing a field", () => {
    expect(employeeProfileSchema.parse({ nationality: "  ", panNumber: "", personalEmail: "", gender: null })).toEqual({
      nationality: null,
      panNumber: null,
      personalEmail: null,
      gender: null,
    });
  });

  it("rejects malformed values and empty updates", () => {
    for (const bad of [
      { panNumber: "12345" },
      { aadhaarNumber: "1234" },
      { bankIfsc: "ABCD1234567" },
      { bankAccountNumber: "12ab" },
      { gender: "ROBOT" },
      { dateOfBirth: "2999-01-01" },
      { noticePeriodDays: -1 },
      { noticePeriodDays: 1.5 },
      { unknownField: "x" },
      {},
    ]) {
      expect(employeeProfileSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.employeeProfile.deleteMany({ where });
  await dbUnscoped.employee.deleteMany({ where });
}

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
describe.skipIf(!process.env.DATABASE_URL)("employee profile (T20/T21, against the DB)", () => {
  const ids: Record<string, string> = {};
  const session = (who: string, perms: string[] = []) => ({ employeeId: ids[who], permissions: perms as never });

  beforeAll(async () => {
    await cleanup();
    ids.boss = (await db.employee.create({ data: { empCode: "B", firstName: "boss", lastName: "T", email: "boss@t.test", joinDate: parseIsoDate("2020-01-01") } })).id;
    for (const n of ["ann", "peer", "hr"]) {
      ids[n] = (
        await db.employee.create({
          data: { empCode: n, firstName: n, lastName: "T", email: `${n}@t.test`, joinDate: parseIsoDate("2020-01-01"), reportingManagerId: n === "ann" ? ids.boss : null },
        })
      ).id;
    }
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  it("returns null fields before anything is saved, and only viewable sections", async () => {
    const self = await getProfile(ids.ann, await accessFor(session("ann"), ids.ann));
    expect(Object.keys(self.data)).toEqual(["personal", "emergency", "employment", "sensitive"]);
    expect(self.data.personal?.dateOfBirth).toBeNull();

    const manager = await getProfile(ids.ann, await accessFor(session("boss"), ids.ann));
    expect(Object.keys(manager.data)).toEqual(["personal", "emergency", "employment"]);
  });

  it("lets the employee save personal details and stores dates as dates", async () => {
    const r = await updateProfile(ids.ann, { dateOfBirth: "1995-04-12", bloodGroup: "O+", emergencyName: "Mum", emergencyPhone: "+919876543210" }, await accessFor(session("ann"), ids.ann));
    expect(r.data.personal).toMatchObject({ dateOfBirth: "1995-04-12", bloodGroup: "O+" });
    expect(r.data.emergency).toMatchObject({ emergencyName: "Mum", emergencyPhone: "+919876543210" });
    // A second partial update keeps the first.
    const again = await updateProfile(ids.ann, { gender: "FEMALE" }, await accessFor(session("ann"), ids.ann));
    expect(again.data.personal).toMatchObject({ dateOfBirth: "1995-04-12", gender: "FEMALE" });
  });

  it("refuses edits outside the caller's sections, writing nothing", async () => {
    // Employees can't change employment or sensitive fields on themselves...
    await expect(updateProfile(ids.ann, { gender: "OTHER", bankAccountNumber: "123456789" }, await accessFor(session("ann"), ids.ann))).rejects.toMatchObject({ status: 403 });
    await expect(updateProfile(ids.ann, { employmentType: "CONTRACT" }, await accessFor(session("ann"), ids.ann))).rejects.toMatchObject({ status: 403 });
    // ...and a manager or unrelated colleague can't edit anything.
    await expect(updateProfile(ids.ann, { nationality: "x" }, await accessFor(session("boss"), ids.ann))).rejects.toMatchObject({ status: 403 });
    await expect(updateProfile(ids.ann, { nationality: "x" }, await accessFor(session("peer"), ids.ann))).rejects.toMatchObject({ status: 403 });
    const row = await db.employeeProfile.findUniqueOrThrow({ where: { employeeId: ids.ann } });
    expect([row.gender, row.bankAccountNumber, row.employmentType]).toEqual(["FEMALE", null, null]);
  });

  it("lets HR set employment details, and only sensitive-edit holders set bank details", async () => {
    const hr = session("hr", ["employees.edit"]);
    const r = await updateProfile(ids.ann, { employmentType: "FULL_TIME", probationEndDate: "2026-06-30", noticePeriodDays: 60 }, await accessFor(hr, ids.ann));
    expect(r.data.employment).toEqual({ employmentType: "FULL_TIME", probationEndDate: "2026-06-30", noticePeriodDays: 60 });
    expect(r.data.sensitive).toBeUndefined(); // HR without sensitive access doesn't even see it
    await expect(updateProfile(ids.ann, { bankName: "HDFC" }, await accessFor(hr, ids.ann))).rejects.toMatchObject({ status: 403 });

    const payroll = session("hr", ["employees.edit_sensitive"]);
    const s = await updateProfile(ids.ann, { bankName: "HDFC", bankAccountNumber: "123456789", panNumber: "ABCDE1234F" }, await accessFor(payroll, ids.ann));
    expect(s.data.sensitive).toMatchObject({ bankName: "HDFC", bankAccountNumber: "123456789", panNumber: "ABCDE1234F" });

    // The employee can read their own sensitive details, a view-only holder can too, the manager can't.
    expect((await getProfile(ids.ann, await accessFor(session("ann"), ids.ann))).data.sensitive?.panNumber).toBe("ABCDE1234F");
    expect((await getProfile(ids.ann, await accessFor(session("peer", ["employees.view_sensitive"]), ids.ann))).data.sensitive?.bankName).toBe("HDFC");
    expect((await getProfile(ids.ann, await accessFor(session("boss"), ids.ann))).data.sensitive).toBeUndefined();
  });

  it("clears a field with null", async () => {
    const r = await updateProfile(ids.ann, { bloodGroup: null }, await accessFor(session("ann"), ids.ann));
    expect(r.data.personal?.bloodGroup).toBeNull();
  });
});
