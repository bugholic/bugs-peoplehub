"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@/lib/session";
import { apiFetch } from "@/lib/api-client";
import { cx } from "@/components/ui";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/employees", label: "Employees" },
  { href: "/org-chart", label: "Org chart" },
  { href: "/leave", label: "Leave" },
  { href: "/attendance", label: "Attendance" },
];

export function NavSidebar({ session }: { session: Session }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-56 flex-col border-r border-zinc-200 bg-white px-4 py-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="px-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">PeopleHub</div>
      <nav className="mt-8 flex flex-1 flex-col gap-1">
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cx(
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
        <p className="font-medium text-zinc-900 dark:text-zinc-50">{session.name}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{session.role}</p>
        <button onClick={logout} className="mt-3 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
          Sign out
        </button>
      </div>
    </aside>
  );
}
