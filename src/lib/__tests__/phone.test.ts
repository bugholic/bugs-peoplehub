import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, splitPhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it("adds +91 to a bare 10-digit number", () => {
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
  });
  it("drops the domestic trunk 0", () => {
    expect(normalizePhone("09876543210")).toBe("+919876543210");
  });
  it("keeps an explicit country code and strips formatting", () => {
    expect(normalizePhone("+1 (415) 555-0132")).toBe("+14155550132");
    expect(normalizePhone("00971 50 123 4567")).toBe("+971501234567");
  });
  it("maps empty input to null", () => {
    expect(normalizePhone("  ")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
  it("rejects junk and wrong-length Indian numbers", () => {
    expect(() => normalizePhone("abc")).toThrow();
    expect(() => normalizePhone("+91 12345")).toThrow();
  });
});

describe("splitPhone / formatPhone", () => {
  it("prefers the longest matching dial code", () => {
    expect(splitPhone("+971501234567")).toEqual({ dial: "971", national: "501234567" });
  });
  it("treats legacy numbers without + as the default country", () => {
    expect(splitPhone("9876543210")).toEqual({ dial: "91", national: "9876543210" });
  });
  it("formats Indian numbers 5-5", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
  });
});
