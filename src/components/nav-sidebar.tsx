"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, useClerk } from "@clerk/nextjs";
import { Building2, CalendarDays, ChevronsUpDown, Clock, LayoutDashboard, LogOut, Network, Shield, UserRound, Users, type LucideIcon } from "lucide-react";
import type { Session } from "@/lib/session";
import type { Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notification-bell";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

type NavLink = { href: string; label: string; icon: LucideIcon };

const LINKS: NavLink[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/employees", label: "Employees", icon: Users },
  { href: "/org-chart", label: "Org chart", icon: Network },
  { href: "/leave", label: "Leave", icon: CalendarDays },
  { href: "/attendance", label: "Attendance", icon: Clock },
];

// Shown only to people allowed to use them (pages and APIs enforce it too; this just hides the links).
// `perm: "ADMIN"` = Clerk org admins only.
const ADMIN_LINKS: (NavLink & { perm: Permission | "ADMIN" })[] = [
  { href: "/settings", label: "Structure & branding", icon: Building2, perm: "org.structure" },
  { href: "/organization", label: "Members", icon: UserRound, perm: "org.members" },
  { href: "/roles", label: "Roles & permissions", icon: Shield, perm: "ADMIN" },
];

const ROLE_LABEL = { ADMIN: "Admin", MANAGER: "Manager", EMPLOYEE: "Employee" } as const;

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary">
        <span className="absolute left-1.5 top-1.5 size-2 rounded-full bg-marigold" />
        <span className="absolute bottom-1.5 right-1.5 size-3 rounded-full bg-white/90" />
      </span>
      {!compact && <span className="truncate text-base font-semibold tracking-tight">PeopleHub</span>}
    </div>
  );
}

function NavGroup({ label, links, pathname }: { label: string; links: NavLink[]; pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  if (links.length === 0) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {links.map(({ href, label: text, icon: Icon }) => (
            <SidebarMenuItem key={href}>
              <SidebarMenuButton asChild isActive={isActive(pathname, href)} tooltip={text}>
                {/* Close the mobile drawer after navigating. */}
                <Link href={href} onClick={() => isMobile && setOpenMobile(false)}>
                  <Icon />
                  <span>{text}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function UserMenu({ session }: { session: Session }) {
  const { signOut } = useClerk();
  const { isMobile } = useSidebar();
  const roleLabel = session.accessRole?.name ?? ROLE_LABEL[session.role];
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <Avatar name={session.name} size="sm" className="rounded-lg" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{session.name}</span>
                <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
            <DropdownMenuLabel className="font-normal">
              <p className="truncate text-sm font-medium">{session.name}</p>
              <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href={`/employees/${session.employeeId}`}>
                  <UserRound /> My profile
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => signOut({ redirectUrl: "/sign-in" })}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar({ session }: { session: Session }) {
  const pathname = usePathname();
  const admin = ADMIN_LINKS.filter((l) => (l.perm === "ADMIN" ? session.role === "ADMIN" : session.permissions.includes(l.perm)));

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <Logo />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {/* Clerk's switcher has no icon-only form, so it hides when the rail is collapsed. */}
        <div className="group-data-[collapsible=icon]:hidden [&_.cl-organizationSwitcherTrigger]:w-full [&_.cl-organizationSwitcherTrigger]:justify-between [&_.cl-rootBox]:w-full">
          <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/dashboard" afterCreateOrganizationUrl="/dashboard" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Workspace" links={LINKS} pathname={pathname} />
        <NavGroup label="Admin" links={admin} pathname={pathname} />
      </SidebarContent>
      <SidebarFooter>
        <UserMenu session={session} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** Sticky top bar inside the inset: sidebar toggle, current section, theme switch. */
export function SiteHeader() {
  const pathname = usePathname();
  const current = [...LINKS, ...ADMIN_LINKS].find((l) => isActive(pathname, l.href));
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 rounded-t-xl border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <span className="truncate text-sm font-medium">{current?.label ?? "PeopleHub"}</span>
      <div className="ml-auto flex items-center gap-1">
        <NotificationBell />
        <ThemeToggle />
      </div>
    </header>
  );
}
