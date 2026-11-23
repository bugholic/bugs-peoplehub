import { redirect } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { AuthShell } from "@/app/auth-shell";
import { Button } from "@/components/ui";

export default async function NoAccessPage() {
  if (!(await auth()).userId) redirect("/sign-in");
  return (
    <AuthShell>
      <div className="w-full max-w-sm text-center">
        <h2 className="font-display text-3xl font-semibold tracking-tight">No employee record</h2>
        <p className="mt-2 text-ink-2">
          You&apos;re signed in, but no active employee uses a verified email matching this account. Ask an admin to add you,
          then sign in again.
        </p>
        <SignOutButton redirectUrl="/sign-in">
          <Button className="mt-6 h-11 w-full">Sign out</Button>
        </SignOutButton>
      </div>
    </AuthShell>
  );
}
