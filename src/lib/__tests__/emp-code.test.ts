import { describe, expect, it } from "vitest";
import { formatEmpCode, orgPrefix } from "../emp-code";

describe("orgPrefix", () => {
  it("takes the first two letters, uppercased", () => {
    expect(orgPrefix("Acme Corp")).toBe("AC");
    expect(orgPrefix("greenmint labs")).toBe("GR");
  });
  it("skips digits, spaces, punctuation and accents", () => {
    expect(orgPrefix("3M Company")).toBe("MC");
    expect(orgPrefix("  -- x y")).toBe("XY");
    expect(orgPrefix("Élan")).toBe("EL");
  });
  it("pads short or letterless names", () => {
    expect(orgPrefix("X")).toBe("XO");
    expect(orgPrefix("123")).toBe("OR");
    expect(orgPrefix("")).toBe("OR");
  });
});

describe("formatEmpCode", () => {
  it("zero-pads to three digits and grows beyond", () => {
    expect(formatEmpCode("AC", 1)).toBe("AC001");
    expect(formatEmpCode("AC", 42)).toBe("AC042");
    expect(formatEmpCode("AC", 1000)).toBe("AC1000");
  });
});
