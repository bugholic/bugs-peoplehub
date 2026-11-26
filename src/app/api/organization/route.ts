import { NextResponse } from "next/server";
import { dbUnscoped } from "@/lib/db";
import { readJson, requirePermission, requireSession, route } from "@/lib/authz";
import { ensureOrganization } from "@/lib/org";
import { organizationSettingsSchema } from "@/lib/validators";

const select = { name: true, timeZone: true, weekOff: true, bannerUrl: true } as const;

/** Organization-wide settings. */
export const GET = route(async () => {
  const session = await requireSession();
  await ensureOrganization(session.organizationId);
  return NextResponse.json(await dbUnscoped.organization.findUniqueOrThrow({ where: { id: session.organizationId }, select }));
});

/** Admins and HR (org.structure) set the organization time zone and week-off pattern; locations can override both. */
export const PATCH = route(async (req) => {
  const session = await requirePermission("org.structure");
  const body = organizationSettingsSchema.parse(await readJson(req));
  await ensureOrganization(session.organizationId);
  return NextResponse.json(await dbUnscoped.organization.update({ where: { id: session.organizationId }, data: body, select }));
});
