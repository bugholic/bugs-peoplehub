"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Avatar, Button, Card, CardTitle, PageHeader, Spinner } from "@/components/ui";
import { CheckIcon, LogInIcon, LogOutIcon, PinIcon, XIcon } from "@/components/icons";
import { APP_TZ, formatDate, formatMinutes, formatTime, parseIsoDate, todayIso } from "@/lib/dates";
import { punch as punchWithLocation, punchMessage, WORK_MODE_LABEL, type PunchAction, type PunchLog } from "@/lib/punch";

type Me = { session: { name: string; role: "ADMIN" | "MANAGER" | "EMPLOYEE" }; employee: { id: string } };
type AttendanceDay = Omit<PunchLog, "remoteRequest"> & {
  status: string;
  remoteStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
};
type AttendanceToday = AttendanceDay | null;
type Balance = { leaveTypeId: string; code: string; name: string; available: number; granted: number };
type Holiday = { id: string; date: string; name: string };
type LeaveRequest = {
  id: string;
  employee: { name: string; empCode: string };
  leaveType: { name: string };
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
};
type Regularization = { id: string; employee: { name: string; empCode: string }; date: string; checkIn: string; checkOut: string; reason: string };
type RemoteRequest = { id: string; employee: { id: string; name: string }; date: string; checkIn: string; checkOut: string; workedMinutes: number };

// A standard working day, used to fill the progress ring.
const WORKDAY_MINUTES = 9 * 60;

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [today, setToday] = useState<AttendanceToday>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [pendingLeave, setPendingLeave] = useState<LeaveRequest[]>([]);
  const [pendingReg, setPendingReg] = useState<Regularization[]>([]);
  const [pendingRemote, setPendingRemote] = useState<RemoteRequest[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const meRes = await apiFetch<Me>("/api/me");
      setMe(meRes);
      const month = todayIso().slice(0, 7);
      const year = Number(todayIso().slice(0, 4));
      const isApprover = meRes.session.role === "ADMIN" || meRes.session.role === "MANAGER";

      const isHr = meRes.session.role === "ADMIN";

      const [attendance, bal, hol, leaveReqs, regReqs, remoteReqs] = await Promise.all([
        apiFetch<{ days: AttendanceDay[] }>(`/api/attendance?month=${month}`),
        apiFetch<{ balances: Balance[] }>("/api/leave/balances"),
        apiFetch<{ items: Holiday[] }>(`/api/holidays?year=${year}`),
        isApprover ? apiFetch<{ items: LeaveRequest[] }>("/api/leave/requests?scope=team&status=PENDING") : Promise.resolve({ items: [] }),
        isApprover ? apiFetch<{ items: Regularization[] }>("/api/attendance/regularizations?scope=team&status=PENDING") : Promise.resolve({ items: [] }),
        isHr ? apiFetch<{ items: RemoteRequest[] }>("/api/attendance/remote-requests?scope=all&status=PENDING") : Promise.resolve({ items: [] }),
      ]);

      setToday(attendance.days.find((d) => d.date === todayIso()) ?? null);
      setBalances(bal.balances);
      setHolidays(hol.items.filter((h) => h.date >= todayIso()).slice(0, 5));
      setPendingLeave(leaveReqs.items);
      setPendingReg(regReqs.items);
      // HR can't decide their own remote day, so keep it out of their queue.
      setPendingRemote(remoteReqs.items.filter((r) => r.employee.id !== meRes.employee.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function punch(action: PunchAction) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      setNotice(punchMessage(action, await punchWithLocation(action)));
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function decideLeave(id: string, decision: "approve" | "reject") {
    setBusy(id);
    try {
      await apiFetch(`/api/leave/requests/${id}/${decision}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function decideRemote(id: string, decision: "approve" | "reject") {
    setBusy(id);
    try {
      await apiFetch(`/api/attendance/remote-requests/${id}/${decision}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function decideReg(id: string, decision: "approve" | "reject") {
    setBusy(id);
    try {
      await apiFetch(`/api/attendance/regularizations/${id}/${decision}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner />;

  const pendingCount = pendingLeave.length + pendingReg.length + pendingRemote.length;

  return (
    <div>
      <PageHeader title={`${greeting()}, ${me?.session.name.split(" ")[0]}`} description={todayFormatted()} />
      {error && <div className="mb-5"><Alert>{error}</Alert></div>}

      <div className="grid gap-5 lg:grid-cols-3">
        <TodayCard today={today} busy={busy} notice={notice} onPunch={punch} />

        <Card>
          <CardTitle action={<Link href="/leave" className="text-[13px] font-semibold text-brand-ink hover:underline">Apply</Link>}>
            Leave balance
          </CardTitle>
          {balances.length === 0 ? (
            <p className="text-sm text-ink-3">No leave types set up yet.</p>
          ) : (
            <ul className="space-y-4">
              {balances.map((b) => {
                const pct = b.granted > 0 ? Math.min(100, (b.available / b.granted) * 100) : 0;
                return (
                  <li key={b.leaveTypeId}>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-medium text-ink-2">{b.name}</span>
                      <span className="font-display text-lg font-semibold tabular-nums text-ink">
                        {b.available}
                        <span className="text-sm font-normal text-ink-3"> / {b.granted} days</span>
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {pendingCount > 0 && (
          <Card className="lg:col-span-2">
            <CardTitle
              action={
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
                  {pendingCount} waiting
                </span>
              }
            >
              Needs your approval
            </CardTitle>
            <ul className="-mx-2 divide-y divide-line">
              {pendingLeave.map((r) => (
                <ApprovalRow
                  key={r.id}
                  name={r.employee.name}
                  title={r.leaveType.name}
                  detail={`${formatDate(r.fromDate)} – ${formatDate(r.toDate)}, ${r.days} ${r.days === 1 ? "day" : "days"}`}
                  reason={r.reason}
                  disabled={busy === r.id}
                  onApprove={() => decideLeave(r.id, "approve")}
                  onReject={() => decideLeave(r.id, "reject")}
                />
              ))}
              {pendingReg.map((r) => (
                <ApprovalRow
                  key={r.id}
                  name={r.employee.name}
                  title="Attendance correction"
                  detail={`${formatDate(r.date)}, ${formatTime(new Date(r.checkIn))}–${formatTime(new Date(r.checkOut))}`}
                  reason={r.reason}
                  disabled={busy === r.id}
                  onApprove={() => decideReg(r.id, "approve")}
                  onReject={() => decideReg(r.id, "reject")}
                />
              ))}
              {pendingRemote.map((r) => (
                <ApprovalRow
                  key={r.id}
                  name={r.employee.name}
                  title="Remote work"
                  detail={`${formatDate(r.date)}, ${formatTime(new Date(r.checkIn))}–${formatTime(new Date(r.checkOut))}, ${formatMinutes(r.workedMinutes)} worked outside the office`}
                  disabled={busy === r.id}
                  onApprove={() => decideRemote(r.id, "approve")}
                  onReject={() => decideRemote(r.id, "reject")}
                />
              ))}
            </ul>
          </Card>
        )}

        <Card className={pendingCount > 0 ? "" : "lg:col-span-3"}>
          <CardTitle>Upcoming holidays</CardTitle>
          {holidays.length === 0 ? (
            <p className="text-sm text-ink-3">No more holidays this year.</p>
          ) : (
            <ul className={pendingCount > 0 ? "space-y-3" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-5"}>
              {holidays.map((h) => {
                const d = parseIsoDate(h.date);
                return (
                  <li key={h.id} className="flex items-center gap-3 rounded-xl bg-surface-2 p-2.5 ring-1 ring-inset ring-line">
                    <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-lg bg-surface leading-none ring-1 ring-line">
                      <span className="text-[10px] font-semibold text-rose-500">{d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}</span>
                      <span className="mt-0.5 font-display text-lg font-semibold text-ink">{d.getUTCDate()}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{h.name}</span>
                      <span className="block text-xs text-ink-3">{d.toLocaleString("en-GB", { weekday: "long", timeZone: "UTC" })}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function TodayCard({
  today,
  busy,
  notice,
  onPunch,
}: {
  today: AttendanceToday;
  busy: string | null;
  notice: string | null;
  onPunch: (a: PunchAction) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const onTheClock = !!today?.openSince;
  const checkedOut = !onTheClock && !!today?.checkOut;
  // Closed sessions plus the open one, counted live so the ring moves.
  const openMinutes = onTheClock ? Math.max(0, Math.floor((now.getTime() - new Date(today!.openSince!).getTime()) / 60000)) : 0;
  const worked = (today?.workedMinutes ?? 0) + openMinutes;
  const pct = Math.min(1, worked / WORKDAY_MINUTES);
  const R = 52;
  const C = 2 * Math.PI * R;
  const sessionCount = today?.sessions.length ?? 0;

  const state = onTheClock ? (sessionCount > 1 ? `On the clock · session ${sessionCount}` : "On the clock") : checkedOut ? "Checked out" : "Not checked in";

  return (
    <section className="relative overflow-hidden rounded-2xl bg-night p-6 text-white shadow-card ring-1 ring-inset ring-white/5 sm:p-7 lg:col-span-2">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-brand/35 blur-3xl" />
      <div className="relative flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm text-white/60">
            <span className={`size-2 rounded-full ${onTheClock ? "animate-pulse bg-emerald-400" : checkedOut ? "bg-marigold" : "bg-white/30"}`} />
            {state}
            {today?.workMode && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/80 ring-1 ring-inset ring-white/15">
                <PinIcon size={12} />
                {WORK_MODE_LABEL[today.workMode]}
              </span>
            )}
          </p>
          <p className="mt-2 font-display text-6xl font-semibold tabular-nums tracking-tight sm:text-7xl">{formatTime(now, APP_TZ)}</p>

          <dl className="mt-6 flex gap-8 text-sm">
            <div>
              <dt className="text-white/50">First in</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{formatTime(today?.checkIn ? new Date(today.checkIn) : null)}</dd>
            </div>
            <div>
              <dt className="text-white/50">{onTheClock ? "In since" : "Last out"}</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">
                {formatTime(onTheClock ? new Date(today!.openSince!) : today?.checkOut ? new Date(today.checkOut) : null)}
              </dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-wrap gap-2">
            {!onTheClock ? (
              <button
                disabled={busy === "check-in"}
                onClick={() => onPunch("check-in")}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-marigold px-5 text-sm font-semibold text-night transition-transform hover:brightness-105 active:translate-y-px disabled:opacity-60"
              >
                <LogInIcon size={17} />
                {busy === "check-in" ? "Locating…" : checkedOut ? "Check in again" : "Check in"}
              </button>
            ) : (
              <button
                disabled={busy === "check-out"}
                onClick={() => onPunch("check-out")}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-night transition-transform hover:bg-white/90 active:translate-y-px disabled:opacity-60"
              >
                <LogOutIcon size={17} />
                {busy === "check-out" ? "Locating…" : "Check out"}
              </button>
            )}
          </div>
          {(notice || today?.remoteStatus) && (
            <p className="mt-3 max-w-sm text-[13px] text-white/60">
              {notice ?? (today!.remoteStatus === "PENDING" ? "Today's remote work request is waiting for HR." : `HR ${today!.remoteStatus!.toLowerCase()} today's remote work.`)}
            </p>
          )}
        </div>

        <div className="relative mx-auto size-40 shrink-0 sm:mx-0">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90">
            <circle cx="60" cy="60" r={R} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="9" />
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke="var(--marigold)"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - pct)}
              className="transition-[stroke-dashoffset] duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-2xl font-semibold tabular-nums">{formatMinutes(worked)}</span>
            <span className="text-xs text-white/50">of {WORKDAY_MINUTES / 60}h today</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function ApprovalRow({
  name,
  title,
  detail,
  reason,
  disabled,
  onApprove,
  onReject,
}: {
  name: string;
  title: string;
  detail: string;
  reason?: string;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-2 py-3.5">
      <Avatar name={name} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          <span className="font-semibold">{name}</span> <span className="text-ink-3">requested</span> {title.toLowerCase()}
        </p>
        <p className="truncate text-[13px] text-ink-3">
          {detail}
          {reason ? `. “${reason}”` : ""}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="secondary" disabled={disabled} onClick={onReject} aria-label={`Reject ${name}'s request`}>
          <XIcon size={14} />
          Reject
        </Button>
        <Button size="sm" disabled={disabled} onClick={onApprove} aria-label={`Approve ${name}'s request`}>
          <CheckIcon size={14} />
          Approve
        </Button>
      </div>
    </li>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: APP_TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function todayFormatted() {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
}
