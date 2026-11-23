import { Suspense } from "react";
import { OrganizationProfile } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { AddMember } from "../add-member";

export default async function OrganizationPage() {
  const session = await requirePageSession();
  if (session.role !== "ADMIN") redirect("/dashboard");
  return (
    <>
      <PageHeader title="Organization" description="Invite people, manage members and their roles." />
      <AddMember />
      <Suspense>
        <OrganizationProfile routing="path" path="/organization" />
      </Suspense>
    </>
  );
}
