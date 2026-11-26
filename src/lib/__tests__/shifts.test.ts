import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_shifts";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: ORG }) }));

import { db, dbUnscoped } from "../db";
import { dayCredit, scheduledMinutes, shiftMetrics, shiftWindow, createShift, updateShift, deleteShift } from "../shifts";
import { checkIn, checkOut, decideRegularization, deriveDayStatus, getMonth } from "../attendance";
import { parseIsoDate, zonedTimeToUtc } from "../dates";

const TZ = "Asia/Kolkata";
const GENERAL = { startTime: "09:00", endTime: "18:00", graceMinutes: 15, halfDayMinutes: 240, fullDayMinutes: 480 };
const NIGHT = { ...GENERAL, startTime: "22:00", endTime: "06:00" };
const at = (date: string, hhmm: string) => zonedTimeToUtc(date, hhmm, TZ);

describe("shift window and length", () => {
  it("handles day and overnight shifts", () => {
    expect(scheduledMinutes(GENERAL)).toBe(540);
    expect(scheduledMinutes(NIGHT)).toBe(480);
    const w = shiftWindow(NIGHT, "2026-11-16", TZ);
    expect(w.start.toISOString()).toBe("2026-11-16T16:30:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-17T00:30:00.000Z");
  });

  it("credits full / half / short days", () => {
    expect(dayCredit(GENERAL, 480)).toBe("FULL");
    expect(dayCredit(GENERAL, 479)).toBe("HALF");
    expect(dayCredit(GENERAL, 240)).toBe("HALF");
    expect(dayCredit(GENERAL, 239)).toBe("SHORT");
  });
});

describe("shiftMetrics", () => {
  const day = "2026-11-16";
  const punches = (inAt: string, outAt: string | null, worked: number) => ({
    firstIn: at(day, inAt),
    lastOut: outAt ? at(day, outAt) : null,
    workedMinutes: worked,
    open: outAt === null,
    offDay: false,
  });

  it("is all zeros without a shift or a check-in", () => {
    expect(shiftMetrics(null, day, punches("10:00", "19:00", 540), TZ)).toEqual({ lateMinutes: 0, earlyExitMinutes: 0, overtimeMinutes: 0, credit: null });
    expect(shiftMetrics(GENERAL, day, { ...punches("10:00", "19:00", 0), firstIn: null }, TZ).credit).toBeNull();
  });

  it("is on time within the grace, late (from the shift start) beyond it", () => {
    expect(shiftMetrics(GENERAL, day, punches("09:15", "18:00", 525), TZ).lateMinutes).toBe(0);
    expect(shiftMetrics(GENERAL, day, punches("09:16", "18:00", 524), TZ).lateMinutes).toBe(16);
  });

  it("only knows lateness while a session is open", () => {
    expect(shiftMetrics(GENERAL, day, punches("09:40", null, 0), TZ)).toEqual({ lateMinutes: 40, earlyExitMinutes: 0, overtimeMinutes: 0, credit: null });
  });

  it("measures early exit, overtime and credit once the day is closed", () => {
    expect(shiftMetrics(GENERAL, day, punches("09:00", "13:00", 240), TZ)).toEqual({ lateMinutes: 0, earlyExitMinutes: 300, overtimeMinutes: 0, credit: "HALF" });
    expect(shiftMetrics(GENERAL, day, punches("08:30", "20:00", 690), TZ)).toEqual({ lateMinutes: 0, earlyExitMinutes: 0, overtimeMinutes: 150, credit: "FULL" });
  });

  it("measures an overnight shift across midnight", () => {
    const m = shiftMetrics(NIGHT, day, { firstIn: at(day, "22:30"), lastOut: at("2026-11-17", "05:00"), workedMinutes: 390, open: false, offDay: false }, TZ);
    expect(m).toEqual({ lateMinutes: 30, earlyExitMinutes: 60, overtimeMinutes: 0, credit: "HALF" });
  });

  it("counts all work on a weekend or holiday as overtime, with no lateness or credit", () => {
    expect(shiftMetrics(GENERAL, day, { ...punches("11:00", "15:00", 240), offDay: true }, TZ)).toEqual({
      lateMinutes: 0,
      earlyExitMinutes: 0,
      overtimeMinutes: 240,
      credit: null,
    });
  });
});

describe("deriveDayStatus with shift credit", () => {
  const base = { date: "2026-10-19", today: "2026-10-20", hasLog: true, holiday: false, leave: null };
  it("downgrades a finished short day", () => {
    expect(deriveDayStatus({ ...base, credit: "FULL" })).toBe("PRESENT");
    expect(deriveDayStatus({ ...base, credit: "HALF" })).toBe("HALF_DAY");
    expect(deriveDayStatus({ ...base, credit: "SHORT" })).toBe("ABSENT");
  });
  it("leaves today, leave days and holidays alone", () => {
    expect(deriveDayStatus({ ...base, date: "2026-10-20", credit: "SHORT" })).toBe("PRESENT");
    expect(deriveDayStatus({ ...base, leave: "HALF", credit: "SHORT" })).toBe("HALF_DAY_LEAVE");
    expect(deriveDayStatus({ ...base, holiday: true, credit: "SHORT" })).toBe("PRESENT");
  });
});

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.regularizationRequest.deleteMany({ where });
  await dbUnscoped.remoteWorkRequest.deleteMany({ where });
  await dbUnscoped.attendanceLog.deleteMany({ where });
  await dbUnscoped.employee.deleteMany({ where });
  await dbUnscoped.shift.deleteMany({ where });
}

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
// Punch times use the app time zone (APP_TZ), as the punch code does.
describe.skipIf(!process.env.DATABASE_URL)("shifts (T13, against the DB)", () => {
  let general: string;
  let night: string;
  let emp: string;
  let nightOwl: string;
  const local = (date: string, hhmm: string) => zonedTimeToUtc(date, hhmm);

  beforeAll(async () => {
    await cleanup();
    const mk = async (n: string, shiftId: string | null) =>
      (
        await db.employee.create({
          data: { empCode: n, firstName: n, lastName: "T", email: `${n}@t.test`, joinDate: parseIsoDate("2025-01-01"), shiftId },
        })
      ).id;
    emp = await mk("emp", null);
    nightOwl = await mk("owl", null);
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  it("makes the first shift the default and keeps exactly one default", async () => {
    general = (await createShift({ name: "General", ...GENERAL, isDefault: false })).id;
    expect((await db.shift.findUniqueOrThrow({ where: { id: general } })).isDefault).toBe(true);
    night = (await createShift({ name: "Night", ...NIGHT, isDefault: false })).id;
    await updateShift(night, { isDefault: true });
    expect((await db.shift.findMany({ where: { isDefault: true } })).map((s) => s.id)).toEqual([night]);
    await expect(updateShift(night, { isDefault: false })).rejects.toMatchObject({ code: "DEFAULT_REQUIRED" });
    await expect(deleteShift(night)).rejects.toMatchObject({ code: "DEFAULT_REQUIRED" });
    await expect(updateShift(general, { halfDayMinutes: 600 })).rejects.toMatchObject({ code: "INVALID_THRESHOLDS" });
    await expect(createShift({ name: "General", ...GENERAL, isDefault: false })).rejects.toMatchObject({ code: "DUPLICATE" });
    await updateShift(general, { isDefault: true });
    await db.employee.update({ where: { id: nightOwl }, data: { shiftId: night } });
  });

  it("records lateness at check-in and the rest at check-out (default shift)", async () => {
    const day = "2026-11-16"; // Monday
    const inLog = await checkIn(emp, null, local(day, "09:40"));
    expect(inLog.lateMinutes).toBe(40);
    expect(inLog.credit).toBeNull();
    const out = await checkOut(emp, null, local(day, "13:40"));
    expect(out).toMatchObject({ lateMinutes: 40, earlyExitMinutes: 260, overtimeMinutes: 0, credit: "HALF", workedMinutes: 240 });
  });

  it("shows a finished half day as HALF_DAY in the month and summary", async () => {
    const days = await getMonth(emp, "2026-11");
    const d = days.find((x) => x.date === "2026-11-16")!;
    expect(d).toMatchObject({ status: "HALF_DAY", lateMinutes: 40, earlyExitMinutes: 260 });
  });

  it("closes an overnight session from yesterday at today's check-out", async () => {
    await checkIn(nightOwl, null, local("2026-11-16", "22:05"));
    const out = await checkOut(nightOwl, null, local("2026-11-17", "06:30"));
    expect(out.date.toISOString().slice(0, 10)).toBe("2026-11-16");
    expect(out).toMatchObject({ workedMinutes: 505, lateMinutes: 0, earlyExitMinutes: 0, overtimeMinutes: 25, credit: "FULL" });
  });

  it("doesn't close a session left open long ago (forgotten check-out)", async () => {
    await checkIn(emp, null, local("2026-11-17", "09:00"));
    await expect(checkOut(emp, null, local("2026-11-18", "09:30"))).rejects.toMatchObject({ code: "NOT_CHECKED_IN" });
  });

  it("recomputes from approved regularized times", async () => {
    const r = await db.regularizationRequest.create({
      data: { employeeId: emp, date: parseIsoDate("2026-11-17"), checkIn: local("2026-11-17", "09:05"), checkOut: local("2026-11-17", "19:05"), reason: "forgot" },
    });
    await decideRegularization(r.id, emp, true);
    const log = await db.attendanceLog.findUniqueOrThrow({ where: { employeeId_date: { employeeId: emp, date: parseIsoDate("2026-11-17") } } });
    expect(log).toMatchObject({ lateMinutes: 0, earlyExitMinutes: 0, overtimeMinutes: 60, credit: "FULL", workedMinutes: 600 });
  });

  it("treats a weekend as overtime only", async () => {
    await checkIn(emp, null, local("2026-11-21", "10:00"));
    const out = await checkOut(emp, null, local("2026-11-21", "12:00"));
    expect(out).toMatchObject({ lateMinutes: 0, overtimeMinutes: 120, credit: null });
  });

  it("moves employees to the default when their shift is deleted", async () => {
    await updateShift(general, { isDefault: true });
    await deleteShift(night);
    expect((await db.employee.findUniqueOrThrow({ where: { id: nightOwl } })).shiftId).toBeNull();
  });
});
