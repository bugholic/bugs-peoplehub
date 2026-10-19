import { describe, expect, it } from "vitest";
import { zonedTimeToUtc, todayIso, isWeekend, parseIsoDate, monthRange, toIsoDate } from "@/lib/dates";

describe("zonedTimeToUtc", () => {
  it("converts IST wall-clock time to the correct UTC instant", () => {
    // 09:00 IST (UTC+5:30) on 2026-10-19 is 03:30 UTC.
    const instant = zonedTimeToUtc("2026-10-19", "09:00", "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-10-19T03:30:00.000Z");
  });

  it("round-trips through todayIso for a fixed instant", () => {
    const instant = zonedTimeToUtc("2026-10-19", "23:45", "Asia/Kolkata");
    expect(todayIso(instant, "Asia/Kolkata")).toBe("2026-10-19");
  });

  it("handles a UTC-negative zone", () => {
    // 09:00 in America/New_York (UTC-4 in October, DST) is 13:00 UTC.
    const instant = zonedTimeToUtc("2026-10-19", "09:00", "America/New_York");
    expect(instant.toISOString()).toBe("2026-10-19T13:00:00.000Z");
  });
});

describe("isWeekend", () => {
  it("flags Saturday and Sunday", () => {
    expect(isWeekend(parseIsoDate("2026-10-17"))).toBe(true);
    expect(isWeekend(parseIsoDate("2026-10-18"))).toBe(true);
  });

  it("does not flag weekdays", () => {
    expect(isWeekend(parseIsoDate("2026-10-19"))).toBe(false);
  });
});

describe("monthRange", () => {
  it("returns the first and last date of the month", () => {
    const { start, end } = monthRange("2026-02");
    expect(toIsoDate(start)).toBe("2026-02-01");
    expect(toIsoDate(end)).toBe("2026-02-28");
  });

  it("handles a leap-year February", () => {
    const { end } = monthRange("2028-02");
    expect(toIsoDate(end)).toBe("2028-02-29");
  });
});
