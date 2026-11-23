import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Which organization Clerk reports as active for the "request" under test.
let activeOrg: string | null = null;
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: activeOrg }) }));

import { db, dbUnscoped } from "../db";

const A = "org_test_A";
const B = "org_test_B";

// Needs a real Postgres (DATABASE_URL); skipped otherwise.
describe.skipIf(!process.env.DATABASE_URL)("tenant-scoped db client", () => {
  let deptA: string;

  const cleanup = () => dbUnscoped.department.deleteMany({ where: { organizationId: { in: [A, B] } } });
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  it("stamps the active org on create, ignoring a caller-supplied one", async () => {
    activeOrg = A;
    const d = await db.department.create({ data: { name: "Eng", organizationId: B } });
    deptA = d.id;
    expect(d.organizationId).toBe(A);
  });

  it("allows the same name in another org (per-org uniqueness)", async () => {
    activeOrg = B;
    const d = await db.department.create({ data: { name: "Eng" } });
    expect(d.organizationId).toBe(B);
  });

  it("hides other orgs' rows from list, by-id read, update and delete", async () => {
    activeOrg = B;
    expect((await db.department.findMany()).map((d) => d.id)).not.toContain(deptA);
    expect(await db.department.findUnique({ where: { id: deptA } })).toBeNull();
    await expect(db.department.update({ where: { id: deptA }, data: { name: "hacked" } })).rejects.toThrow();
    expect((await db.department.deleteMany({ where: { id: deptA } })).count).toBe(0);
    expect(await db.department.count()).toBe(1);

    const untouched = await dbUnscoped.department.findUnique({ where: { id: deptA } });
    expect(untouched?.name).toBe("Eng");
  });

  it("keeps the scope inside interactive transactions", async () => {
    activeOrg = A;
    const id = await db.$transaction(async (tx) => {
      const d = await tx.department.create({ data: { name: "InTx" } });
      expect(await tx.department.count()).toBe(2); // Eng + InTx, not org B's rows
      return d.id;
    });
    expect((await dbUnscoped.department.findUnique({ where: { id } }))?.organizationId).toBe(A);
  });

  it("scopes upsert", async () => {
    activeOrg = B;
    const d = await db.department.upsert({ where: { id: deptA }, create: { name: "Upserted" }, update: {} });
    // deptA belongs to A, so B's upsert must create its own row rather than touch A's.
    expect(d.id).not.toBe(deptA);
    expect(d.organizationId).toBe(B);
  });

  it("fails closed when there is no active organization", async () => {
    activeOrg = null;
    await expect(db.department.findMany()).rejects.toMatchObject({ code: "NO_ORGANIZATION" });
    await expect(db.department.create({ data: { name: "x" } })).rejects.toMatchObject({ code: "NO_ORGANIZATION" });
  });
});
