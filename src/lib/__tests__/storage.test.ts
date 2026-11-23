import { afterAll, describe, expect, it } from "vitest";
import { BUCKET, deleteObject, getObject, photoKey, putObject, sniffImage } from "../storage";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("sniffImage", () => {
  it("recognises JPEG, PNG and WebP by magic bytes", () => {
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
  it("rejects everything else, including HTML claiming to be an image", () => {
    expect(sniffImage(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("photoKey", () => {
  it("is prefixed by organization", () => {
    expect(photoKey("org_1", "emp_9")).toBe("orgs/org_1/employees/emp_9/photo");
  });
});

// Round trip against the real Neon bucket (needs the AWS_* vars from `neon deploy`).
describe.skipIf(!process.env.AWS_ENDPOINT_URL_S3)("Neon Object Storage round trip", () => {
  const key = `orgs/org_test_storage/employees/test/photo-${Date.now()}`;
  afterAll(() => deleteObject(key));

  it("uploads, reads back identical bytes with the stored content type, then deletes", async () => {
    expect(BUCKET).toBe("assets");
    await putObject(key, PNG, "image/png");

    const got = await getObject(key);
    expect(got?.contentType).toBe("image/png");
    expect(new Uint8Array(await got!.body.transformToByteArray())).toEqual(PNG);

    await deleteObject(key);
    expect(await getObject(key)).toBeNull();
  });
});
