"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Spinner, Textarea, cx } from "@/components/ui";
import { formatDate, formatMinutes, formatTime, todayIso } from "@/lib/dates";

type Day = { date: string; status: string; checkIn: string | null; checkOut: string | null; workedMinutes: number; leaveType: string | null };
type Summary = { present: number; absent: number; leave: number; holidays: number; workedMinutes: number };
type Regularization = {
  id: string;
  employee: { name: string; empCode: string };
  date: string;
  checkIn: string;
  checkOut: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
};
type Me = { role: "ADMIN" | "MANAGER" | "EMPLOYEE" };

const TABS = ["My attendance", "Regularizations", "Team report"] as const;

export default function AttendancePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("My attendance");

  useEffect(() => {
    apiFetch<{ session: Me }>("/api/me").then((r) => setMe(r.session)).catch(() => {});
  }, []);

  const isApprover = me?.role === "ADMIN" || me?.role === "MANAGER";
  const visibleTabs = TABS.filter((t) => (t === "Team report" ? isApprover : true));

  return (
    <div>
      <PageHeader title="Attendance" />
      <div className="mb-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {visibleTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === t ? "border-zinc-900 text-zinc-900 dark:border-white dark:text-white" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "My attendance" && <MyAttendanceTab />}
      {tab === "Regularizations" && <RegularizationsTab isApprover={isApprover} />}
      {tab === "Team report" && isApprover && <TeamReportTab />}
    </div>
  );
}

function MyAttendanceTab() {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [days, setDays] = useState<Day[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regForm, setRegForm] = useState({ date: todayIso(), checkIn: "09:00", checkOut: "18:00", reason: "" });
  const [regMessage, setRegMessage] = useState<string | null>(null);

  async function load() {
    try {
      const r = await apiFetch<{ days: Day[]; summary: Summary }>(`/api/attendance?month=${month}`);
      setDays(r.days);
      setSummary(r.summary);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function punch(action: "check-in" | "check-out") {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/attendance/${action}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitReg(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setRegMessage(null);
    try {
      await apiFetch("/api/attendance/regularizations", { method: "POST", body: JSON.stringify(regForm) });
      setRegMessage("Regularization request submitted.");
      setRegForm((f) => ({ ...f, reason: "" }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const today = days?.find((d) => d.date === todayIso());

  return (
    <div className="space-y-5">
      {error && <Alert>{error}</Alert>}

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-600 dark:text-zinc-300">
          Today: {formatTime(today?.checkIn ? new Date(today.checkIn) : null)} – {formatTime(today?.checkOut ? new Date(today.checkOut) : null)}
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !!today?.checkIn} onClick={() => punch("check-in")}>
            Check in
          </Button>
          <Button size="sm" variant="secondary" disabled={busy || !today?.checkIn || !!today?.checkOut} onClick={() => punch("check-out")}>
            Check out
          </Button>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
        {summary && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Present {summary.present} · Absent {summary.absent} · Leave {summary.leave} · Worked {formatMinutes(summary.workedMinutes)}
          </p>
        )}
      </div>

      {!days ? (
        <Spinner />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">In</th>
                <th className="px-4 py-2 font-medium">Out</th>
                <th className="px-4 py-2 font-medium">Worked</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{formatDate(d.date)}</td>
                  <td className="px-4 py-2">
                    <Badge status={d.status} />
                  </td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{formatTime(d.checkIn ? new Date(d.checkIn) : null)}</td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{formatTime(d.checkOut ? new Date(d.checkOut) : null)}</td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{formatMinutes(d.workedMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="max-w-lg">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Request a regularization</h2>
        <form onSubmit={submitReg} className="mt-3 flex flex-col gap-3">
          <Field label="Date">
            <Input type="date" required max={todayIso()} value={regForm.date} onChange={(e) => setRegForm((f) => ({ ...f, date: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in">
              <Input type="time" required value={regForm.checkIn} onChange={(e) => setRegForm((f) => ({ ...f, checkIn: e.target.value }))} />
            </Field>
            <Field label="Check-out">
              <Input type="time" required value={regForm.checkOut} onChange={(e) => setRegForm((f) => ({ ...f, checkOut: e.target.value }))} />
            </Field>
          </div>
          <Field label="Reason">
            <Textarea required minLength={3} rows={2} value={regForm.reason} onChange={(e) => setRegForm((f) => ({ ...f, reason: e.target.value }))} />
          </Field>
          {regMessage && <Alert kind="success">{regMessage}</Alert>}
          <Button type="submit" className="self-start">
            Submit
          </Button>
        </form>
      </Card>
    </div>
  );
}

function RegularizationsTab({ isApprover }: { isApprover: boolean }) {
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [items, setItems] = useState<Regularization[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const r = await apiFetch<{ items: Regularization[] }>(`/api/attendance/regularizations?scope=${scope}`);
      setItems(r.items);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  async function decide(id: string, decision: "approve" | "reject") {
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

  return (
    <div>
      {isApprover && (
        <div className="mb-4 flex gap-1">
          <Button size="sm" variant={scope === "mine" ? "primary" : "secondary"} onClick={() => setScope("mine")}>
            Mine
          </Button>
          <Button size="sm" variant={scope === "team" ? "primary" : "secondary"} onClick={() => setScope("team")}>
            Team
          </Button>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState>Nothing here.</EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <Card key={r.id} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {scope === "team" ? `${r.employee.name} (${r.employee.empCode}) · ` : ""}
                  {formatDate(r.date)}, {formatTime(new Date(r.checkIn))}–{formatTime(new Date(r.checkOut))}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{r.reason}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge status={r.status} />
                {scope === "team" && r.status === "PENDING" && (
                  <>
                    <Button size="sm" disabled={busy === r.id} onClick={() => decide(r.id, "approve")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decide(r.id, "reject")}>
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamReportTab() {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [rows, setRows] = useState<{ empCode: string; name: string; present: number; absent: number; leave: number; holidays: number; workedMinutes: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ items: typeof rows }>(`/api/attendance/report?month=${month}`)
      .then((r) => setRows(r.items ?? []))
      .catch((err) => setError(errorMessage(err)));
  }, [month]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
        <a
          href={`/api/attendance/report?month=${month}&format=csv`}
          className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        >
          Download CSV
        </a>
      </div>
      {error && <Alert>{error}</Alert>}
      {!rows ? (
        <Spinner />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-4 py-2 font-medium">Present</th>
                <th className="px-4 py-2 font-medium">Absent</th>
                <th className="px-4 py-2 font-medium">Leave</th>
                <th className="px-4 py-2 font-medium">Worked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.empCode} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">
                    {r.name} <span className="text-zinc-400">({r.empCode})</span>
                  </td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{r.present}</td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{r.absent}</td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{r.leave}</td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{formatMinutes(r.workedMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
