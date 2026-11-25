import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { RolesManager } from "./roles-manager";

export default async function RolesPage() {
  const session = await requirePageSession();
  // Org admins only: role management isn't a grantable permission, so it can't be used to self-escalate.
  if (session.role !== "ADMIN") redirect("/dashboard");
  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Create roles with exactly the access each group needs, then assign them to people."
      />
      <RolesManager />
    </>
  );
}
