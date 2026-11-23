import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Who Clerk says is making the request.
const who = { userId: "user_a", orgId: "org_test_photoA", orgRole: "org:member" as string | null };
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ ...who }),
  currentUser: async () => null,
  clerkClient: async () => ({}),
}));

import { dbUnscoped } from "../db";
import { deleteObject, getObject, photoKey } from "../storage";
import { DELETE, GET, PUT } from "@/app/api/employees/[id]/photo/route";

const A = "org_test_photoA";
const B = "org_test_photoB";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const asUser = (userId: string, orgId: string, orgRole: string) => Object.assign(who, { userId, orgId, orgRole });
const upload = (bytes: BlobPart, name = "p.png", type = "image/png") => {
  const body = new FormData();
  body.append("file", new File([bytes], name, { type }));
  return new Request("http://x/api/photo", { method: "PUT", body });
};

describe.skipIf(!process.env.DATABASE_URL || !process.env.AWS_ENDPOINT_URL_S3)("employee photo route (Neon Postgres + Object Storage)", () => {
  let ann: string; // org A, member
  let bob: string; // org A, another member
  let eve: string; // org B

  const mk = (organizationId: string, n: string, clerkUserId: string) =>
    dbUnscoped.employee
      .create({ data: { organizationId, empCode: n, firstName: n, lastName: "T", email: `${n}@t.test`, joinDate: new Date(), clerkUserId } })
      .then((e) => e.id);

  const cleanup = async () => {
    for (const e of await dbUnscoped.employee.findMany({ where: { organizationId: { in: [A, B] } } })) {
      await deleteObject(photoKey(e.organizationId, e.id)).catch(() => {});
    }
    await dbUnscoped.employee.deleteMany({ where: { organizationId: { in: [A, B] } } });
  };

  beforeAll(async () => {
    await cleanup();
    ann = await mk(A, "ann", "user_a");
    bob = await mk(A, "bob", "user_b");
    eve = await mk(B, "eve", "user_e");
  });
  afterAll(async () => {
    await cleanup();
    await dbUnscoped.$disconnect();
  });

  it("lets an employee upload their own photo and serves the same bytes back", async () => {
    asUser("user_a", A, "org:member");
    const put = await PUT(upload(PNG), ctx(ann));
    expect(put.status).toBe(200);
    const { photoUrl } = await put.json();
    expect(photoUrl.startsWith(`/api/employees/${ann}/photo?v=`)).toBe(true);
    expect(photoUrl).toMatch(/\?v=\d+$/);

    // Persisted in Postgres, object present in the bucket under the org prefix.
    expect((await dbUnscoped.employee.findUnique({ where: { id: ann } }))?.photoUrl).toBe(photoUrl);
    expect(await getObject(photoKey(A, ann))).not.toBeNull();

    const res = await GET(new Request("http://x"), ctx(ann));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("rejects non-images even with an image content type, and oversize files", async () => {
    asUser("user_a", A, "org:member");
    const html = await PUT(upload("<html><script>alert(1)</script></html>", "x.png", "image/png"), ctx(ann));
    expect(html.status).toBe(400);
    expect((await html.json()).error.code).toBe("PHOTO_TYPE");

    const big = await PUT(upload(new Uint8Array(2 * 1024 * 1024 + 1).fill(0xff)), ctx(ann));
    expect(big.status).toBe(400);
    expect((await big.json()).error.code).toBe("PHOTO_SIZE");
  });

  it("forbids changing a colleague's photo unless admin", async () => {
    asUser("user_a", A, "org:member");
    expect((await PUT(upload(PNG), ctx(bob))).status).toBe(403);
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), ctx(bob))).status).toBe(403);

    asUser("user_a", A, "org:admin");
    expect((await PUT(upload(PNG), ctx(bob))).status).toBe(200);
  });

  it("does not expose or touch another organization's employee", async () => {
    asUser("user_e", B, "org:admin"); // admin, but of org B
    expect((await GET(new Request("http://x"), ctx(ann))).status).toBe(404);
    expect((await PUT(upload(PNG), ctx(ann))).status).toBe(404);
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), ctx(ann))).status).toBe(404);
    expect(await getObject(photoKey(A, ann))).not.toBeNull(); // untouched
    expect(eve).toBeTruthy();
  });

  it("removes the photo from the bucket and the row", async () => {
    asUser("user_a", A, "org:member");
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), ctx(ann))).status).toBe(200);
    expect((await dbUnscoped.employee.findUnique({ where: { id: ann } }))?.photoUrl).toBeNull();
    expect(await getObject(photoKey(A, ann))).toBeNull();
    expect((await GET(new Request("http://x"), ctx(ann))).status).toBe(404);
  });
});
