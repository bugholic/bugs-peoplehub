import { Suspense } from "react";
import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/app/auth-shell";

export default function SignInPage() {
  return (
    <AuthShell>
      <Suspense>
        <SignIn />
      </Suspense>
    </AuthShell>
  );
}
