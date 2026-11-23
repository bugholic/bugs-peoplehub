import { Suspense } from "react";
import { redirect } from "next/navigation";
import { OrganizationList } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { AuthShell } from "@/app/auth-shell";

export default async function SelectOrgPage() {
  if (!(await auth()).userId) redirect("/sign-in");
  return (
    <AuthShell>
      <Suspense>
        <OrganizationList hidePersonal afterSelectOrganizationUrl="/dashboard" afterCreateOrganizationUrl="/dashboard" />
      </Suspense>
    </AuthShell>
  );
}
