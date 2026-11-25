import { describe, expect, it } from "vitest";
import { countLeaveDays, availableBalance, assertSufficientBalance, grantForYear, carriedInto } from "@/lib/leave";
import { parseIsoDate } from "@/lib/dates";
import { ApiError } from "@/lib/errors";

const d = parseIsoDate;

describe("countLeaveDays", () => {
  it("counts weekdays only, skipping weekends", () => {
    // 2026-10-19 Mon .. 2026-10-25 Sun -> 5 weekdays
    expect(countLeaveDays(d("2026-10-19"), d("2026-10-25"), "FULL", new Set())).toBe(5);
  });

  it("excludes holidays", () => {
    expect(countLeaveDays(d("2026-10-19"), d("2026-10-21"), "FULL", new Set(["2026-10-20"]))).toBe(2);
  });

  it("counts a half day as 0.5", () => {
    expect(countLeaveDays(d("2026-10-19"), d("2026-10-19"), "FIRST_HALF", new Set())).toBe(0.5);
  });

  it("counts a half day on a holiday/weekend as 0", () => {
    expect(countLeaveDays(d("2026-10-17"), d("2026-10-17"), "FIRST_HALF", new Set())).toBe(0); // Saturday
  });

  it("rejects a half day spanning more than one date", () => {
    expect(() => countLeaveDays(d("2026-10-19"), d("2026-10-20"), "FIRST_HALF", new Set())).toThrow(ApiError);
  });

  it("rejects an end date before the start date", () => {
    expect(() => countLeaveDays(d("2026-10-20"), d("2026-10-19"), "FULL", new Set())).toThrow(ApiError);
  });
});

describe("availableBalance / assertSufficientBalance", () => {
  it("subtracts used and pending from granted", () => {
    expect(availableBalance({ granted: 12, used: 3, pending: 2 })).toBe(7);
  });

  it("rounds to one decimal place", () => {
    expect(availableBalance({ granted: 10, used: 3.35, pending: 0 })).toBe(6.7);
  });

  it("throws when the requested days exceed the available balance", () => {
    expect(() => assertSufficientBalance({ granted: 5, used: 5, pending: 0 }, 0.5)).toThrow(ApiError);
  });

  it("allows a request that exactly matches the available balance", () => {
    expect(() => assertSufficientBalance({ granted: 5, used: 4.5, pending: 0 }, 0.5)).not.toThrow();
  });
});

describe("grantForYear (proration)", () => {
  it("grants nothing before the join year and the full quota after it", () => {
    expect(grantForYear(12, 2025, d("2026-03-01"))).toBe(0);
    expect(grantForYear(12, 2027, d("2026-03-01"))).toBe(12);
  });

  it("grants the full quota for a 1 January join", () => {
    expect(grantForYear(12, 2026, d("2026-01-01"))).toBe(12);
  });

  it("counts the join month when joining on or before the 15th", () => {
    expect(grantForYear(12, 2026, d("2026-11-15"))).toBe(2); // Nov + Dec
  });

  it("skips the join month when joining after the 15th", () => {
    expect(grantForYear(12, 2026, d("2026-11-16"))).toBe(1); // Dec only
  });

  it("rounds to the nearest half day", () => {
    expect(grantForYear(15, 2026, d("2026-08-01"))).toBe(6.5); // 15 * 5/12 = 6.25 -> 6.5
    expect(grantForYear(10, 2026, d("2026-12-20"))).toBe(0);
  });
});

describe("carriedInto (carry-forward)", () => {
  it("is zero with no prior years", () => {
    expect(carriedInto([{ year: 2026, granted: 15, used: 2 }], 2026)).toBe(0);
  });

  it("carries last year's unused balance", () => {
    expect(carriedInto([{ year: 2025, granted: 15, used: 5 }], 2026)).toBe(10);
  });

  it("compounds across years and ignores the target and later years", () => {
    const rows = [
      { year: 2024, granted: 15, used: 10 }, // 5 carried
      { year: 2025, granted: 15, used: 12 }, // 15 + 5 - 12 = 8
      { year: 2026, granted: 15, used: 15 },
    ];
    expect(carriedInto(rows, 2026)).toBe(8);
  });

  it("never carries a negative balance", () => {
    expect(carriedInto([{ year: 2025, granted: 5, used: 7 }], 2026)).toBe(0);
  });

  it("applies a cap each year", () => {
    expect(carriedInto([{ year: 2025, granted: 30, used: 0 }], 2026, 10)).toBe(10);
  });
});
