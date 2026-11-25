import { NextResponse } from "next/server";
import { dbUnscoped } from "@/lib/db";
import { requireSession, requirePermission, route, notFound, badRequest } from "@/lib/authz";
import { ensureOrganization } from "@/lib/org";
import { MAX_BANNER_BYTES, bannerKey, deleteObject, getObject, putObject, sniffImage } from "@/lib/storage";

/** Streams the active organization's banner to any member. The bucket stays private. */
export const GET = route(async () => {
  const session = await requireSession();
  const obj = await getObject(bannerKey(session.organizationId));
  if (!obj) throw notFound("Banner");
  return new Response(obj.body.transformToWebStream(), {
    headers: {
      "Content-Type": obj.contentType,
      // bannerUrl carries ?v=<timestamp>, so a new upload busts this cache.
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

/** Admins and HR (org.structure) set the company banner shown on profile headers. */
export const PUT = route(async (req) => {
  const session = await requirePermission("org.structure");

  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) throw badRequest('Send the image as multipart form field "file"');
  if (file.size === 0 || file.size > MAX_BANNER_BYTES) throw badRequest("Banner must be between 1 byte and 5 MB", "BANNER_SIZE");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) throw badRequest("Banner must be a JPEG, PNG or WebP image", "BANNER_TYPE");

  await ensureOrganization(session.organizationId);
  await putObject(bannerKey(session.organizationId), bytes, type);
  const bannerUrl = `/api/organization/banner?v=${Date.now()}`;
  await dbUnscoped.organization.update({ where: { id: session.organizationId }, data: { bannerUrl } });
  return NextResponse.json({ bannerUrl });
});

export const DELETE = route(async () => {
  const session = await requirePermission("org.structure");
  await deleteObject(bannerKey(session.organizationId));
  await dbUnscoped.organization.updateMany({ where: { id: session.organizationId }, data: { bannerUrl: null } });
  return NextResponse.json({ ok: true });
});
