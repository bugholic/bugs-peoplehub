"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Button, Card, PageHeader, Spinner } from "@/components/ui";
import { formatDate, formatMinutes, formatTime, todayIso } from "@/lib/dates";

type Me = { session: { name: string; role: "ADMIN" | "MANAGER" | "EMPLOYEE" }; employee: { id: string } };
type AttendanceToday = { checkIn: string | null; checkOut: string | null; workedMinutes: number; status: string } | null;
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

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [today, setToday] = useState<AttendanceToday>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [pendingLeave, setPendingLeave] = useState<LeaveRequest[]>([]);
  const [pendingReg, setPendingReg] = useState<Regularization[]>([]);
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

      const [attendance, bal, hol, leaveReqs, regReqs] = await Promise.all([
        apiFetch<{ days: { date: string; checkIn: string | null; checkOut: string | null; workedMinutes: number; status: string }[] }>(
          `/api/attendance?month=${month}`,
        ),
        apiFetch<{ balances: Balance[] }>("/api/leave/balances"),
        apiFetch<{ items: Holiday[] }>(`/api/holidays?year=${year}`),
        isApprover ? apiFetch<{ items: LeaveRequest[] }>("/api/leave/requests?scope=team&status=PENDING") : Promise.resolve({ items: [] }),
        isApprover ? apiFetch<{ items: Regularization[] }>("/api/attendance/regularizations?scope=team&status=PENDING") : Promise.resolve({ items: [] }),
      ]);

      setToday(attendance.days.find((d) => d.date === todayIso()) ?? null);
      setBalances(bal.balances);
      setHolidays(hol.items.filter((h) => h.date >= todayIso()).slice(0, 5));
      setPendingLeave(leaveReqs.items);
      setPendingReg(regReqs.items);
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

  async function punch(action: "check-in" | "check-out") {
    setBusy(action);
    setError(null);
    try {
      await apiFetch(`/api/attendance/${action}`, { method: "POST" });
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

  return (
    <div>
      <PageHeader title={`Welcome, ${me?.session.name.split(" ")[0]}`} description={todayFormatted()} />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Today</h2>
          <div className="mt-3 flex items-center justify-between text-sm">
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">Check-in</p>
              <p className="font-medium text-zinc-900 dark:text-zinc-50">{formatTime(today?.checkIn ? new Date(today.checkIn) : null)}</p>
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">Check-out</p>
              <p className="font-medium text-zinc-900 dark:text-zinc-50">{formatTime(today?.checkOut ? new Date(today.checkOut) : null)}</p>
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">Worked</p>
              <p className="font-medium text-zinc-900 dark:text-zinc-50">{formatMinutes(today?.workedMinutes ?? 0)}</p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button disabled={!!today?.checkIn || busy === "check-in"} onClick={() => punch("check-in")}>
              Check in
            </Button>
            <Button
              variant="secondary"
              disabled={!today?.checkIn || !!today?.checkOut || busy === "check-out"}
              onClick={() => punch("check-out")}
            >
              Check out
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Leave balance</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {balances.map((b) => (
              <div key={b.leaveTypeId} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{b.name}</p>
                <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {b.available}
                  <span className="text-xs font-normal text-zinc-400"> / {b.granted}</span>
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Upcoming holidays</h2>
          {holidays.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">None scheduled.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {holidays.map((h) => (
                <li key={h.id} className="flex justify-between">
                  <span className="text-zinc-700 dark:text-zinc-300">{h.name}</span>
                  <span className="text-zinc-400">{formatDate(h.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {(pendingLeave.length > 0 || pendingReg.length > 0) && (
          <Card>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Pending your approval</h2>
            <ul className="mt-3 space-y-3">
              {pendingLeave.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">
                      {r.employee.name} · {r.leaveType.name}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatDate(r.fromDate)} – {formatDate(r.toDate)} ({r.days}d) · {r.reason}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" disabled={busy === r.id} onClick={() => decideLeave(r.id, "approve")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decideLeave(r.id, "reject")}>
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
              {pendingReg.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{r.employee.name} · regularization</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatDate(r.date)}, {formatTime(new Date(r.checkIn))}–{formatTime(new Date(r.checkOut))} · {r.reason}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" disabled={busy === r.id} onClick={() => decideReg(r.id, "approve")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decideReg(r.id, "reject")}>
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function todayFormatted() {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());
}
