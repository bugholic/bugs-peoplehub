import { Suspense } from "react";
import { OrganizationProfile } from "@clerk/nextjs";
import { requirePagePermission } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { AddMember } from "../add-member";

export default async function OrganizationPage() {
  const session = await requirePagePermission("org.members");
  return (
    <>
      <PageHeader title="Organization" description="Invite people, manage members and their roles." />
      <AddMember canAddAdmin={session.role === "ADMIN"} />
      <Suspense>
        <OrganizationProfile routing="path" path="/organization" />
      </Suspense>
    </>
  );
}
