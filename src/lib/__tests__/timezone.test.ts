import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORG = "org_test_timezones";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: ORG }) }));

import { db, dbUnscoped } from "../db";
import { isValidTimeZone, timeZoneOptions, todayIso, toIsoDate, zonedTimeToUtc, parseIsoDate } from "../dates";
import { employeeTimeZone, organizationTimeZone } from "../timezone";
import { checkIn, checkOut, requestRegularization } from "../attendance";
import { createShift } from "../shifts";
import { organizationSettingsSchema } from "../validators";

describe("time zone helpers", () => {
  it("accepts IANA zones only", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("EST")).toBe(false); // abbreviation, not a region zone
    expect(organizationSettingsSchema.safeParse({ timeZone: "Nowhere" }).success).toBe(false);
  });
  it("lists zones with UTC first", () => {
    const z = timeZoneOptions();
    expect(z[0]).toBe("UTC");
    expect(z).toContain("Europe/London");
  });
  it("puts the same instant on different calendar days", () => {
    const instant = new Date("2026-11-16T02:00:00Z"); // 07:30 Kolkata, 21:00 New York the day before
    expect(todayIso(instant, "Asia/Kolkata")).toBe("2026-11-16");
    expect(todayIso(instant, "America/New_York")).toBe("2026-11-15");
  });
});

async function cleanup() {
  const where = { organizationId: ORG };
  await dbUnscoped.regularizationRequest.deleteMany({ where });
  await dbUnscoped.remoteWorkRequest.deleteMany({ where });
  await dbUnscoped.attendanceLog.deleteMany({ where });
  await dbUnscoped.employee.deleteMany({ where });
  await dbUnscoped.shift.deleteMany({ where });
  await dbUnscoped.location.deleteMany({ where });
  await dbUnscoped.organization.deleteMany({ where: { id: ORG } });
}

// Needs a real Postgres (DATABASE_URL); skipped otherwise. Uses a throwaway org and cleans up after itself.
describe.skipIf(!process.env.DATABASE_URL)("time zones (T15, against the DB)", () => {
  let ny: string; // org zone
  let london: string; // location override

  beforeAll(async () => {
    await cleanup();
    await dbUnscoped.organization.create({ data: { id: ORG, name: "TZ test", empPrefix: "TZ", timeZone: "America/New_York" } });
    const uk = await db.location.create({ data: { name: "London", timeZone: "Europe/London" } });
    const mk = async (n: string, locationId: string | null) =>
      (await db.employee.create({ data: { empCode: n, firstName: n, lastName: "T", email: `${n}@t.test`, joinDate: parseIsoDate("2025-01-01"), locationId } })).id;
    ny = await mk("ny", null);
    london = await mk("ldn", uk.id);
    await createShift({ name: "General", startTime: "09:00", endTime: "17:00", graceMinutes: 0, halfDayMinutes: 240, fullDayMinutes: 420, isDefault: true });
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  it("resolves the location override, else the org zone", async () => {
    expect(await organizationTimeZone()).toBe("America/New_York");
    expect(await employeeTimeZone(ny)).toBe("America/New_York");
    expect(await employeeTimeZone(london)).toBe("Europe/London");
  });

  it("files a punch under the employee's own calendar day and shift", async () => {
    // 14:30 UTC on Mon 16 Nov = 09:30 in New York: late by 30 min against a 09:00 NY shift.
    const log = await checkIn(ny, null, new Date("2026-11-16T14:30:00Z"));
    expect(toIsoDate(log.date)).toBe("2026-11-16");
    expect(log.lateMinutes).toBe(30);
    await checkOut(ny, null, new Date("2026-11-16T22:00:00Z"));

    // 23:30 UTC on Mon 16 Nov is still Monday in London but already Tuesday in Kolkata.
    const ldn = await checkIn(london, null, new Date("2026-11-16T23:30:00Z"));
    expect(toIsoDate(ldn.date)).toBe("2026-11-16");
  });

  it("reads regularization times in the employee's zone", async () => {
    const r = await requestRegularization(london, { date: "2026-11-10", checkIn: "09:00", checkOut: "17:00", reason: "forgot" });
    expect(r.checkIn.toISOString()).toBe(zonedTimeToUtc("2026-11-10", "09:00", "Europe/London").toISOString());
    expect(r.checkIn.toISOString()).toBe("2026-11-10T09:00:00.000Z"); // GMT in November
  });
});
