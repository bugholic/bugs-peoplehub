import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, route, notFound, forbidden, badRequest, can } from "@/lib/authz";
import { MAX_PHOTO_BYTES, deleteObject, getObject, photoKey, putObject, sniffImage } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/** Streams the photo. Auth + tenant checked here; the bucket itself stays private. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const { id } = await params;
  const employee = await db.employee.findUnique({ where: { id }, select: { id: true, photoUrl: true } });
  if (!employee?.photoUrl) throw notFound("Photo");

  const obj = await getObject(photoKey(session.organizationId, id));
  if (!obj) throw notFound("Photo");
  return new Response(obj.body.transformToWebStream(), {
    headers: {
      "Content-Type": obj.contentType,
      // photoUrl carries ?v=<timestamp>, so a new upload busts this cache.
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

/** An employee may change their own photo; `employees.edit` may change anyone's. */
async function authorize(id: string) {
  const session = await requireSession();
  if (id !== session.employeeId && !can(session, "employees.edit")) throw forbidden();
  if (!(await db.employee.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Employee");
  return session;
}

export const PUT = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const session = await authorize(id);

  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) throw badRequest('Send the image as multipart form field "file"');
  if (file.size === 0 || file.size > MAX_PHOTO_BYTES) throw badRequest("Photo must be between 1 byte and 2 MB", "PHOTO_SIZE");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) throw badRequest("Photo must be a JPEG, PNG or WebP image", "PHOTO_TYPE");

  await putObject(photoKey(session.organizationId, id), bytes, type);
  const photoUrl = `/api/employees/${id}/photo?v=${Date.now()}`;
  await db.employee.update({ where: { id }, data: { photoUrl } });
  return NextResponse.json({ photoUrl });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  const session = await authorize(id);
  await deleteObject(photoKey(session.organizationId, id));
  await db.employee.update({ where: { id }, data: { photoUrl: null } });
  return NextResponse.json({ ok: true });
});
