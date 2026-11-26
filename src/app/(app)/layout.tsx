import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { requirePageSession } from "@/lib/authz";
import { AppSidebar, SiteHeader } from "@/components/nav-sidebar";
import { ApiCacheScope } from "@/components/api-cache-scope";
import { TimeZoneScope } from "@/components/time-zone-scope";
import { employeeTimeZone } from "@/lib/timezone";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requirePageSession();
  // shadcn's SidebarProvider persists expanded/collapsed in this cookie; read it so SSR matches.
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const timeZone = await employeeTimeZone(session.employeeId);

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <ApiCacheScope scope={`${session.userId}:${session.organizationId}`} />
      <TimeZoneScope timeZone={timeZone} />
      <AppSidebar session={session} />
      <SidebarInset className="min-w-0">
        <SiteHeader />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
