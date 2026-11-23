import { Suspense } from "react";
import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/app/auth-shell";

export default function SignUpPage() {
  return (
    <AuthShell>
      <Suspense>
        <SignUp />
      </Suspense>
    </AuthShell>
  );
}
