import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** Neon Object Storage bucket declared in neon.ts. */
export const BUCKET = "assets";
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_BANNER_BYTES = 5 * 1024 * 1024;

// Credentials, endpoint and region come from the AWS_* vars `neon deploy` writes to .env.
// Neon requires path-style addressing.
const globalForS3 = globalThis as unknown as { s3?: S3Client };
const s3 = globalForS3.s3 ?? new S3Client({ forcePathStyle: true });
if (process.env.NODE_ENV !== "production") globalForS3.s3 = s3;

/** Tenant-prefixed so one org's objects can never be addressed with another org's id. */
export const photoKey = (organizationId: string, employeeId: string) =>
  `orgs/${organizationId}/employees/${employeeId}/photo`;

export const bannerKey = (organizationId: string) => `orgs/${organizationId}/banner`;

/** Identify the image from its bytes (never trust the client's Content-Type). */
export function sniffImage(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return res.Body ? { body: res.Body, contentType: res.ContentType ?? "application/octet-stream" } : null;
  } catch (e) {
    if ((e as { name?: string }).name === "NoSuchKey") return null;
    throw e;
  }
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
