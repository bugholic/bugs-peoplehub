import { Suspense } from "react";
import { OrganizationList } from "@clerk/nextjs";
import { AuthShell } from "@/app/auth-shell";

export default function SelectOrgPage() {
  return (
    <AuthShell>
      <Suspense>
        <OrganizationList hidePersonal afterSelectOrganizationUrl="/dashboard" afterCreateOrganizationUrl="/dashboard" />
      </Suspense>
    </AuthShell>
  );
}
