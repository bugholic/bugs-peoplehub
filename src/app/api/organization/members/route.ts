import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireSession, route, readJson, badRequest, notFound, conflict } from "@/lib/authz";
import { addMemberSchema } from "@/lib/validators";
import { orgRoleFromRole } from "@/lib/session";

type ClerkError = { status?: number; errors?: { code?: string; longMessage?: string; message?: string }[] };

/**
 * Adds an EXISTING Clerk user to the active organization without sending an email
 * (for instances where email invitations aren't available). They must already have signed up.
 * Their Employee record is created/linked on their first visit (see provisionEmployee).
 */
export const POST = route(async (req) => {
  const session = await requireSession("ADMIN");
  const body = addMemberSchema.parse(await readJson(req));
  const clerk = await clerkClient();

  const { data: users } = await clerk.users.getUserList({ emailAddress: [body.email], limit: 1 });
  const user = users[0];
  if (!user) throw notFound("A Clerk account with this email (ask them to sign up first)");

  try {
    await clerk.organizations.createOrganizationMembership({
      organizationId: session.organizationId,
      userId: user.id,
      role: orgRoleFromRole(body.role),
    });
  } catch (e) {
    const err = (e as ClerkError).errors?.[0];
    if (err?.code === "already_a_member_in_organization") throw conflict("They're already a member of this organization", "ALREADY_MEMBER");
    // e.g. the org:manager custom role hasn't been created in the Clerk Dashboard yet.
    if (err) throw badRequest(err.longMessage ?? err.message ?? "Clerk rejected the request", "CLERK_ERROR");
    throw e;
  }
  return NextResponse.json({ ok: true }, { status: 201 });
});
