import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: null }) }));
vi.mock("@/lib/jobs/daily", () => ({
  runDailyJobs: vi.fn(async () => [{ organizationId: "org_x", result: { repaired: 0, escalated: 1, reminded: 3 } }]),
}));

import { GET } from "@/app/api/cron/daily/route";

const call = (auth?: string) =>
  GET(new Request("http://localhost/api/cron/daily", { headers: auth ? { authorization: auth } : {} }), undefined);

describe("GET /api/cron/daily", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is disabled (503) until CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer anything")).status).toBe(503);
  });

  it("rejects a missing or wrong secret (401)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-value")).status).toBe(401);
  });

  it("runs the daily jobs with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const res = await call("Bearer s3cret-value");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ organizationId: "org_x", result: { repaired: 0, escalated: 1, reminded: 3 } }] });
  });
});
