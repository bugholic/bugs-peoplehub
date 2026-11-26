import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_week_off";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: ORG }) }));

import { db, dbUnscoped } from "../db";
import { describeWeekOff, isValidWeekOff, isWeekOff, normalizeWeekOff, weekOfMonth } from "../week-off";
import { parseIsoDate } from "../dates";
import { countLeaveDays, previewLeave, workingDates } from "../leave";
import { deriveDayStatus, getMonth } from "../attendance";
import { previousWorkingDay } from "../jobs/attendance";
import { employeeWeekOff, organizationWeekOff } from "../timezone";
import { createShift, shiftContext } from "../shifts";
import { locationCreateSchema, organizationSettingsSchema } from "../validators";

// November 2026: Sundays 1, 8, 15, 22, 29; Saturdays 7 (1st), 14 (2nd), 21 (3rd), 28 (4th).
const d = parseIsoDate;
const ALT_SAT = "0,6#2,6#4"; // Sundays + 2nd and 4th Saturday
const GULF = "5,6"; // Friday + Saturday

describe("week-off patterns (pure)", () => {
  it("validates and normalizes", () => {
    expect(normalizeWeekOff(" 6#4, 0 ,6#2,6#2")).toBe(ALT_SAT);
    expect(normalizeWeekOff("6#1,6#2,6#3,6#4,6#5")).toBe("6"); // every week collapses
    expect(normalizeWeekOff("")).toBe("");
    expect(isValidWeekOff("")).toBe(true); // seven-day week
    for (const bad of ["7", "6#6", "6#0", "sat", "0,1,2,3,4,5,6"]) expect(isValidWeekOff(bad)).toBe(false);
  });

  it("matches the n-th weekday of the month", () => {
    expect(weekOfMonth(d("2026-11-14"))).toBe(2);
    expect(weekOfMonth(d("2026-11-29"))).toBe(5);
    expect(isWeekOff(d("2026-11-14"), ALT_SAT)).toBe(true);
    expect(isWeekOff(d("2026-11-21"), ALT_SAT)).toBe(false); // 3rd Saturday works
    expect(isWeekOff(d("2026-11-28"), ALT_SAT)).toBe(true);
    expect(isWeekOff(d("2026-11-22"), ALT_SAT)).toBe(true);
    expect(isWeekOff(d("2026-11-20"), GULF)).toBe(true);
    expect(isWeekOff(d("2026-11-22"), GULF)).toBe(false);
    expect(isWeekOff(d("2026-11-21"))).toBe(true); // default Sat + Sun
  });

  it("describes a pattern", () => {
    expect(describeWeekOff("0,6")).toBe("Sat, Sun");
    expect(describeWeekOff(ALT_SAT)).toBe("2nd & 4th Sat, Sun");
    expect(describeWeekOff("0,6#1,6#3,6#5")).toBe("1st, 3rd & 5th Sat, Sun");
    expect(describeWeekOff("")).toBe("None");
  });

  it("drives leave counts, day status and the previous working day", () => {
    const none = new Set<string>();
    expect(countLeaveDays(d("2026-11-09"), d("2026-11-15"), "FULL", none, ALT_SAT)).toBe(5);
    expect(countLeaveDays(d("2026-11-16"), d("2026-11-22"), "FULL", none, ALT_SAT)).toBe(6); // 3rd Sat counts
    expect(countLeaveDays(d("2026-11-16"), d("2026-11-22"), "FULL", none, GULF)).toBe(5);
    expect(countLeaveDays(d("2026-11-16"), d("2026-11-22"), "FULL", none)).toBe(5);
    expect(workingDates(d("2026-11-19"), d("2026-11-22"), none, GULF)).toEqual(["2026-11-19", "2026-11-22"]);

    const day = { today: "2026-11-26", hasLog: false, holiday: false, leave: null };
    expect(deriveDayStatus({ ...day, date: "2026-11-21", weekOff: ALT_SAT })).toBe("ABSENT");
    expect(deriveDayStatus({ ...day, date: "2026-11-20", weekOff: GULF })).toBe("WEEKEND");

    expect(previousWorkingDay("2026-11-22", none, GULF)).toBe("2026-11-19"); // Sun -> Thu
    expect(previousWorkingDay("2026-11-23", none, ALT_SAT)).toBe("2026-11-21"); // Mon -> 3rd Sat
  });

  it("validates settings input", () => {
    expect(organizationSettingsSchema.parse({ weekOff: "6#4,0,6#2" })).toEqual({ weekOff: ALT_SAT });
    expect(organizationSettingsSchema.safeParse({ weekOff: "0,1,2,3,4,5,6" }).success).toBe(false);
    expect(organizationSettingsSchema.safeParse({}).success).toBe(false);
    expect(locationCreateSchema.parse({ name: "X", weekOff: null }).weekOff).toBeNull();
  });
});

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.attendanceLog.deleteMany({ where });
  await dbUnscoped.leaveBalance.deleteMany({ where });
  await dbUnscoped.leaveRequest.deleteMany({ where });
  await dbUnscoped.leaveType.deleteMany({ where });
  await dbUnscoped.employee.deleteMany({ where });
  await dbUnscoped.shift.deleteMany({ where });
  await dbUnscoped.location.deleteMany({ where });
  await dbUnscoped.organization.deleteMany({ where: { id: ORG } });
}

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
describe.skipIf(!process.env.DATABASE_URL)("week-off settings (T14, against the DB)", () => {
  let gulf: string; // org pattern (Fri + Sat)
  let india: string; // location override (Sun + 2nd/4th Sat)
  let el: string;

  beforeAll(async () => {
    await cleanup();
    await dbUnscoped.organization.create({ data: { id: ORG, name: "Week-off test", empPrefix: "WO", weekOff: GULF } });
    const office = await db.location.create({ data: { name: "Pune", weekOff: ALT_SAT } });
    const mk = async (n: string, locationId: string | null) =>
      (await db.employee.create({ data: { empCode: n, firstName: n, lastName: "T", email: `${n}@t.test`, joinDate: parseIsoDate("2025-01-01"), locationId } })).id;
    gulf = await mk("gulf", null);
    india = await mk("india", office.id);
    el = (await db.leaveType.create({ data: { name: "Earned", code: "EL", annualQuota: 24 } })).id;
    await createShift({ name: "General", startTime: "09:00", endTime: "18:00", graceMinutes: 15, halfDayMinutes: 240, fullDayMinutes: 480, isDefault: true });
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  it("resolves the location override, else the org pattern", async () => {
    expect(await organizationWeekOff()).toBe(GULF);
    expect(await employeeWeekOff(gulf)).toBe(GULF);
    expect(await employeeWeekOff(india)).toBe(ALT_SAT);
  });

  it("counts leave with the employee's pattern", async () => {
    const week = { leaveTypeId: el, fromDate: "2026-12-14", toDate: "2026-12-20", dayPart: "FULL" as const }; // Mon-Sun, Sat 19 = 3rd
    expect((await previewLeave(gulf, week)).days).toBe(5);
    expect((await previewLeave(india, week)).days).toBe(6);
  });

  it("marks week-offs in the month view and the shift's off days", async () => {
    const status = async (id: string, date: string) => (await getMonth(id, "2026-11")).find((x) => x.date === date)!.status;
    expect(await status(gulf, "2026-11-20")).toBe("WEEKEND"); // Friday
    expect(await status(gulf, "2026-11-22")).toBe("ABSENT"); // Sunday is a working day here
    expect(await status(india, "2026-11-14")).toBe("WEEKEND"); // 2nd Saturday
    expect(await status(india, "2026-11-21")).toBe("ABSENT"); // 3rd Saturday is working

    const ctx = await shiftContext(india, d("2026-11-14"), d("2026-11-21"), "Asia/Kolkata");
    expect([...ctx.offDays].sort()).toEqual(["2026-11-14", "2026-11-15"]);
  });
});
