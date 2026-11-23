import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The org row already exists in these tests, so Clerk is never called.
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: null }), clerkClient: async () => ({}) }));

import { dbUnscoped } from "../db";
import { nextEmpCode } from "../org";

const ORG = "org_test_empcode";

describe.skipIf(!process.env.DATABASE_URL)("nextEmpCode", () => {
  beforeAll(async () => {
    await dbUnscoped.organization.deleteMany({ where: { id: ORG } });
    await dbUnscoped.organization.create({ data: { id: ORG, name: "Acme Corp", empPrefix: "AC" } });
  });
  afterAll(async () => {
    await dbUnscoped.organization.deleteMany({ where: { id: ORG } });
    await dbUnscoped.$disconnect();
  });

  it("starts at 001 with the org's prefix", async () => {
    expect(await nextEmpCode(ORG)).toBe("AC001");
    expect(await nextEmpCode(ORG)).toBe("AC002");
  });

  it("hands out distinct codes under concurrency", async () => {
    const codes = await Promise.all(Array.from({ length: 15 }, () => nextEmpCode(ORG)));
    expect(new Set(codes).size).toBe(15);
    expect([...codes].sort()[0]).toBe("AC003");
  });
});
