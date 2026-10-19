import { describe, expect, it } from "vitest";
import { combineWorkMode, deriveDayStatus, validateRegularization, workedMinutes } from "@/lib/attendance";
import { ApiError } from "@/lib/errors";

describe("combineWorkMode", () => {
  it("takes the first session's mode", () => {
    expect(combineWorkMode(null, "REMOTE")).toBe("REMOTE");
  });

  it("stays put while sessions match", () => {
    expect(combineWorkMode("OFFICE", "OFFICE")).toBe("OFFICE");
  });

  it("becomes HYBRID once office and remote mix, and stays HYBRID", () => {
    expect(combineWorkMode("OFFICE", "REMOTE")).toBe("HYBRID");
    expect(combineWorkMode("HYBRID", "OFFICE")).toBe("HYBRID");
  });
});

describe("deriveDayStatus", () => {
  const base = { date: "2026-10-19", today: "2026-10-20", hasLog: false, holiday: false, leave: null as "FULL" | "HALF" | null };

  it("is PRESENT when there's a check-in, even with no leave", () => {
    expect(deriveDayStatus({ ...base, hasLog: true })).toBe("PRESENT");
  });

  it("is HALF_DAY_LEAVE when checked in on a half-day leave", () => {
    expect(deriveDayStatus({ ...base, hasLog: true, leave: "HALF" })).toBe("HALF_DAY_LEAVE");
  });

  it("is LEAVE for a full-day approved leave with no check-in", () => {
    expect(deriveDayStatus({ ...base, leave: "FULL" })).toBe("LEAVE");
  });

  it("is HOLIDAY when no log and no leave", () => {
    expect(deriveDayStatus({ ...base, holiday: true })).toBe("HOLIDAY");
  });

  it("is WEEKEND for a Saturday with nothing else going on", () => {
    expect(deriveDayStatus({ ...base, date: "2026-10-17" })).toBe("WEEKEND");
  });

  it("is UPCOMING for a future weekday", () => {
    expect(deriveDayStatus({ ...base, date: "2026-10-21", today: "2026-10-20" })).toBe("UPCOMING");
  });

  it("is ABSENT for a past weekday with nothing recorded", () => {
    expect(deriveDayStatus({ ...base, date: "2026-10-19", today: "2026-10-20" })).toBe("ABSENT");
  });
});

describe("validateRegularization", () => {
  it("rejects a future date", () => {
    expect(() =>
      validateRegularization("2026-10-21", "2026-10-20", new Date("2026-10-21T03:30:00Z"), new Date("2026-10-21T12:30:00Z")),
    ).toThrow(ApiError);
  });

  it("rejects check-out at or before check-in", () => {
    expect(() =>
      validateRegularization("2026-10-19", "2026-10-20", new Date("2026-10-19T12:30:00Z"), new Date("2026-10-19T03:30:00Z")),
    ).toThrow(ApiError);
  });

  it("rejects a span longer than 24 hours", () => {
    const checkIn = new Date("2026-10-19T03:30:00Z");
    const checkOut = new Date(checkIn.getTime() + 25 * 60 * 60000);
    expect(() => validateRegularization("2026-10-19", "2026-10-20", checkIn, checkOut)).toThrow(ApiError);
  });

  it("accepts a normal same-day span", () => {
    expect(() =>
      validateRegularization("2026-10-19", "2026-10-20", new Date("2026-10-19T03:30:00Z"), new Date("2026-10-19T12:30:00Z")),
    ).not.toThrow();
  });
});

describe("workedMinutes", () => {
  it("computes minutes between two instants", () => {
    expect(workedMinutes(new Date("2026-10-19T03:30:00Z"), new Date("2026-10-19T12:30:00Z"))).toBe(540);
  });

  it("never goes negative", () => {
    expect(workedMinutes(new Date("2026-10-19T12:30:00Z"), new Date("2026-10-19T03:30:00Z"))).toBe(0);
  });
});
