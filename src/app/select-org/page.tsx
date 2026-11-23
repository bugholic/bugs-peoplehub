import { Suspense } from "react";
import { redirect } from "next/navigation";
import { OrganizationList } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { AuthShell } from "@/app/auth-shell";

export default async function SelectOrgPage() {
  // A session with the "choose organization" task still pending counts as signed OUT for auth()
  // by default. This page is where that task is completed, so it must see that user; otherwise
  // /select-org -> /sign-in -> (Clerk sends the pending session back) -> /select-org loops.
  if (!(await auth({ treatPendingAsSignedOut: false })).userId) redirect("/sign-in");
  return (
    <AuthShell>
      <Suspense>
        <OrganizationList hidePersonal afterSelectOrganizationUrl="/dashboard" afterCreateOrganizationUrl="/dashboard" />
      </Suspense>
    </AuthShell>
  );
}
