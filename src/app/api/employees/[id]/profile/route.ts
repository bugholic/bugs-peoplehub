import { NextResponse } from "next/server";
import { readJson, requireSession, route, forbidden } from "@/lib/authz";
import { employeeProfileSchema } from "@/lib/validators";
import { accessFor, getProfile, updateProfile } from "@/lib/employee-profile";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Extended profile of an employee, limited to the sections the caller may see
 * (personal / emergency / employment: self, direct manager, employees.edit;
 * sensitive: self, employees.view_sensitive, employees.edit_sensitive). `access` says which
 * sections can be seen and edited so the UI can render accordingly.
 */
export const GET = route<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const { id } = await params;
  const access = await accessFor(session, id);
  if (!Object.values(access.view).some(Boolean)) throw forbidden();
  return NextResponse.json(await getProfile(id, access));
});

/** Partial update; every field must be in a section the caller can edit, else 403 and nothing changes. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const { id } = await params;
  const access = await accessFor(session, id);
  const patch = employeeProfileSchema.parse(await readJson(req));
  return NextResponse.json(await updateProfile(id, patch, access));
});
