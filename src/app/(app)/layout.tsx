import type { ReactNode } from "react";
import { requirePageSession } from "@/lib/authz";
import { NavSidebar } from "@/components/nav-sidebar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requirePageSession();

  return (
    <div className="flex min-h-screen">
      <NavSidebar session={session} />
      <main className="flex-1 px-6 py-8 md:px-10">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
