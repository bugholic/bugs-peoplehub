import { describe, expect, it } from "vitest";
import { countLeaveDays, availableBalance, assertSufficientBalance } from "@/lib/leave";
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
