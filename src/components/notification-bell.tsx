"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Item = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
  actor: { id: string; name: string; photoUrl: string | null } | null;
};

// No push channel yet (docs/TODO.md T10), so poll; also refresh on tab focus and on open.
const POLL_MS = 60_000;

function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Header bell: unread badge, latest notifications, mark one / all read. */
export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: Item[]; unreadCount: number }>("/api/notifications?limit=15", { cache: "no-store" });
      setItems(res.items);
      setUnread(res.unreadCount);
    } catch {
      // Transient (offline, signed out mid-session): keep what we have; the next poll retries.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const timer = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function markRead(ids?: string[]) {
    // Optimistic; the response carries the authoritative count.
    setItems((xs) => xs.map((x) => (!ids || ids.includes(x.id) ? { ...x, read: true } : x)));
    setUnread((u) => (ids ? Math.max(0, u - ids.length) : 0));
    try {
      const res = await apiFetch<{ unreadCount: number }>("/api/notifications/read", {
        method: "POST",
        body: JSON.stringify(ids ? { ids } : {}),
      });
      setUnread(res.unreadCount);
    } catch {
      load();
    }
  }

  function open(item: Item) {
    if (!item.read) markRead([item.id]);
    if (item.link) router.push(item.link);
  }

  return (
    <DropdownMenu onOpenChange={(isOpen) => isOpen && load()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell className="size-[1.1rem]" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => markRead()}>
              <CheckCheck className="size-3.5" />
              Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          <div className="max-h-[26rem] overflow-y-auto p-1">
            {items.map((n) => (
              <DropdownMenuItem key={n.id} onSelect={() => open(n)} className="items-start gap-3 px-2 py-2.5">
                <Avatar name={n.actor?.name ?? "PeopleHub"} photoUrl={n.actor?.photoUrl} size="sm" className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm leading-snug", n.read ? "text-muted-foreground" : "font-medium text-foreground")}>{n.title}</p>
                  {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.read && <span aria-label="Unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
