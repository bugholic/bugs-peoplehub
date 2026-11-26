import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_attendance_jobs";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: ORG }) }));

import { db, dbUnscoped } from "../db";
import { autoCloseOpenSessions, flagMissingAttendance, previousWorkingDay } from "../jobs/attendance";
import { checkIn, getMonth } from "../attendance";
import { createShift } from "../shifts";
import { parseIsoDate, zonedTimeToUtc } from "../dates";

describe("previousWorkingDay", () => {
  it("skips weekends and holidays", () => {
    expect(previousWorkingDay("2026-11-17", new Set())).toBe("2026-11-16"); // Tue -> Mon
    expect(previousWorkingDay("2026-11-16", new Set())).toBe("2026-11-13"); // Mon -> Fri
    expect(previousWorkingDay("2026-11-16", new Set(["2026-11-13"]))).toBe("2026-11-12"); // Fri is a holiday
  });
});

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.notification.deleteMany({ where });
  await dbUnscoped.regularizationRequest.deleteMany({ where });
  await dbUnscoped.remoteWorkRequest.deleteMany({ where });
  await dbUnscoped.attendanceLog.deleteMany({ where });
  await dbUnscoped.leaveRequest.deleteMany({ where });
  await dbUnscoped.leaveType.deleteMany({ where });
  await dbUnscoped.employee.deleteMany({ where });
  await dbUnscoped.shift.deleteMany({ where });
  await dbUnscoped.location.deleteMany({ where });
}

const OFFICE = { latitude: 12.9716, longitude: 77.5946 };
const local = (date: string, hhmm: string) => zonedTimeToUtc(date, hhmm); // APP_TZ (no Organization row -> default zone)
const MON = "2026-11-16";
const TUE_LATE_MORNING = local("2026-11-17", "11:30");

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
describe.skipIf(!process.env.DATABASE_URL)("attendance jobs (T16, against the DB)", () => {
  const ids: Record<string, string> = {};
  const titles = async (id: string, type: string) => (await db.notification.findMany({ where: { recipientId: id, type } })).map((n) => n.title);

  beforeAll(async () => {
    await cleanup();
    const office = await db.location.create({ data: { name: "HQ", ...OFFICE, radiusMeters: 300 } });
    await createShift({ name: "General", startTime: "09:00", endTime: "18:00", graceMinutes: 15, halfDayMinutes: 240, fullDayMinutes: 480, isDefault: true });
    for (const n of ["forgot", "remote", "present", "absent", "onleave", "corrected", "nologin"]) {
      ids[n] = (
        await db.employee.create({
          data: {
            empCode: n,
            firstName: n,
            lastName: "T",
            email: `${n}@t.test`,
            joinDate: parseIsoDate("2025-01-01"),
            locationId: office.id,
            clerkUserId: n === "nologin" ? null : `aj_${n}`,
          },
        })
      ).id;
    }
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  it("closes a forgotten office session at the shift end and flags it", async () => {
    await checkIn(ids.forgot, OFFICE, local(MON, "09:10"));
    await checkIn(ids.remote, null, local(MON, "09:30")); // remote: can't be verified
    expect(await autoCloseOpenSessions(TUE_LATE_MORNING)).toBe(2);

    const day = (await getMonth(ids.forgot, "2026-11")).find((d) => d.date === MON)!;
    expect(day).toMatchObject({ autoClosed: true, workedMinutes: 530, earlyExitMinutes: 0, status: "PRESENT" });
    expect(day.checkOut).toBe(local(MON, "18:00").toISOString());
    expect(await titles(ids.forgot, "ATTENDANCE_AUTO_CLOSED")).toEqual(["You didn't check out on 16 Nov 2026"]);

    const remote = (await getMonth(ids.remote, "2026-11")).find((d) => d.date === MON)!;
    expect(remote).toMatchObject({ autoClosed: true, workedMinutes: 0, status: "ABSENT" });
  });

  it("leaves a session alone while a check-out can still reach it", async () => {
    await checkIn(ids.present, OFFICE, local(MON, "22:00")); // 13.5h before TUE_LATE_MORNING
    expect(await autoCloseOpenSessions(TUE_LATE_MORNING)).toBe(0);
  });

  it("flags only people with nothing on their last working day, once", async () => {
    const el = await db.leaveType.create({ data: { name: "Earned", code: "EL", annualQuota: 12 } });
    await db.leaveRequest.create({
      data: { employeeId: ids.onleave, leaveTypeId: el.id, fromDate: parseIsoDate(MON), toDate: parseIsoDate(MON), days: 1, reason: "x", status: "APPROVED" },
    });
    await db.regularizationRequest.create({
      data: { employeeId: ids.corrected, date: parseIsoDate(MON), checkIn: local(MON, "09:00"), checkOut: local(MON, "18:00"), reason: "forgot" },
    });

    expect(await flagMissingAttendance(TUE_LATE_MORNING)).toBe(1);
    expect(await titles(ids.absent, "ATTENDANCE_MISSING")).toEqual(["No attendance on 16 Nov 2026"]);
    for (const n of ["forgot", "remote", "present", "onleave", "corrected", "nologin"]) {
      expect(await titles(ids[n], "ATTENDANCE_MISSING")).toEqual([]);
    }
    // The cron firing twice doesn't double up.
    expect(await flagMissingAttendance(TUE_LATE_MORNING)).toBe(0);
  });
});
