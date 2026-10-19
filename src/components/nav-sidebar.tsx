"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@/lib/session";
import { apiFetch } from "@/lib/api-client";
import { Avatar, cx } from "@/components/ui";
import { ClockIcon, HomeIcon, LogOutIcon, OrgIcon, PlaneIcon, UsersIcon } from "@/components/icons";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { href: "/employees", label: "Employees", icon: UsersIcon },
  { href: "/org-chart", label: "Org chart", icon: OrgIcon },
  { href: "/leave", label: "Leave", icon: PlaneIcon },
  { href: "/attendance", label: "Attendance", icon: ClockIcon },
];

const ROLE_LABEL = { ADMIN: "Admin", MANAGER: "Manager", EMPLOYEE: "Employee" } as const;

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx("flex items-center gap-2.5", className)}>
      <span className="relative inline-flex size-9 items-center justify-center rounded-xl bg-brand">
        <span className="absolute left-2 top-2 size-2.5 rounded-full bg-marigold" />
        <span className="absolute bottom-2 right-2 size-3.5 rounded-full bg-white/90" />
      </span>
      <span className="font-display text-lg font-semibold tracking-tight">PeopleHub</span>
    </div>
  );
}

export function NavSidebar({ session }: { session: Session }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-night px-4 py-6 text-white lg:flex">
        <Logo className="px-2" />
        <nav className="mt-10 flex flex-1 flex-col gap-1">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "bg-night-2 text-white" : "text-white/55 hover:bg-white/5 hover:text-white",
                )}
              >
                {active && <span className="absolute -left-4 top-2 bottom-2 w-1 rounded-r-full bg-marigold" />}
                <Icon size={19} className={active ? "text-marigold" : ""} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="rounded-2xl bg-night-2 p-3">
          <div className="flex items-center gap-3">
            <Avatar name={session.name} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{session.name}</p>
              <p className="text-xs text-white/50">{ROLE_LABEL[session.role]}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold text-white/60 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/5 hover:text-white"
          >
            <LogOutIcon size={14} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile / tablet top bar */}
      <header className="sticky top-0 z-20 bg-night text-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Logo />
          <div className="flex items-center gap-2">
            <Avatar name={session.name} size="sm" />
            <button onClick={logout} aria-label="Sign out" className="rounded-lg p-2 text-white/60 hover:bg-white/5 hover:text-white">
              <LogOutIcon size={18} />
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium",
                  active ? "bg-night-2 text-white" : "text-white/55",
                )}
              >
                <Icon size={16} className={active ? "text-marigold" : ""} />
                {label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
