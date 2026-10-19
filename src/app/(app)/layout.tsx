import type { ReactNode } from "react";
import { requirePageSession } from "@/lib/authz";
import { NavSidebar } from "@/components/nav-sidebar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requirePageSession();

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <NavSidebar session={session} />
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-12 lg:py-12">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
