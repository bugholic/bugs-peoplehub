"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea, EmptyState, cx } from "@/components/ui";
import { formatDate, todayIso } from "@/lib/dates";

type LeaveType = { id: string; name: string; code: string; allowHalfDay: boolean };
type LeaveRequest = {
  id: string;
  employee: { id: string; name: string; empCode: string };
  leaveType: { name: string };
  fromDate: string;
  toDate: string;
  dayPart: string;
  days: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string;
};

type Me = { employeeId: string; role: "ADMIN" | "MANAGER" | "EMPLOYEE" };

const TABS = ["Apply", "My requests", "Approvals", "Admin"] as const;

export default function LeavePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Apply");

  useEffect(() => {
    apiFetch<{ session: Me }>("/api/me").then((r) => setMe(r.session)).catch(() => {});
  }, []);

  const isApprover = me?.role === "ADMIN" || me?.role === "MANAGER";
  const isAdmin = me?.role === "ADMIN";
  const visibleTabs = TABS.filter((t) => (t === "Approvals" ? isApprover : t === "Admin" ? isAdmin : true));

  return (
    <div>
      <PageHeader title="Leave" />
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

      {tab === "Apply" && <ApplyTab />}
      {tab === "My requests" && <MyRequestsTab />}
      {tab === "Approvals" && isApprover && <ApprovalsTab isAdmin={isAdmin} />}
      {tab === "Admin" && isAdmin && <AdminTab />}
    </div>
  );
}

function ApplyTab() {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [form, setForm] = useState({ leaveTypeId: "", fromDate: todayIso(), toDate: todayIso(), dayPart: "FULL", reason: "" });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ items: LeaveType[] }>("/api/leave/types").then((r) => {
      setTypes(r.items);
      if (r.items[0]) setForm((f) => ({ ...f, leaveTypeId: r.items[0].id }));
    });
  }, []);

  const selectedType = types.find((t) => t.id === form.leaveTypeId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await apiFetch("/api/leave/requests", { method: "POST", body: JSON.stringify(form) });
      setSuccess("Leave request submitted.");
      setForm((f) => ({ ...f, reason: "" }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Leave type">
          <Select value={form.leaveTypeId} onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From">
            <Input type="date" required value={form.fromDate} onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))} />
          </Field>
          <Field label="To">
            <Input type="date" required value={form.toDate} onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))} />
          </Field>
        </div>
        <Field label="Day part">
          <Select value={form.dayPart} onChange={(e) => setForm((f) => ({ ...f, dayPart: e.target.value }))}>
            <option value="FULL">Full day(s)</option>
            {selectedType?.allowHalfDay && (
              <>
                <option value="FIRST_HALF">First half (single day)</option>
                <option value="SECOND_HALF">Second half (single day)</option>
              </>
            )}
          </Select>
        </Field>
        <Field label="Reason">
          <Textarea required minLength={3} rows={3} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
        </Field>
        {error && <Alert>{error}</Alert>}
        {success && <Alert kind="success">{success}</Alert>}
        <Button type="submit" disabled={saving || !form.leaveTypeId}>
          {saving ? "Submitting…" : "Submit request"}
        </Button>
      </form>
    </Card>
  );
}

function MyRequestsTab() {
  const [items, setItems] = useState<LeaveRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const r = await apiFetch<{ items: LeaveRequest[] }>("/api/leave/requests?scope=mine");
      setItems(r.items);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function cancel(id: string) {
    setBusy(id);
    try {
      await apiFetch(`/api/leave/requests/${id}/cancel`, { method: "POST" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!items) return <Spinner />;
  if (items.length === 0) return <EmptyState>No leave requests yet.</EmptyState>;

  return (
    <div className="space-y-3">
      {items.map((r) => (
        <Card key={r.id} className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {r.leaveType.name} · {formatDate(r.fromDate)} – {formatDate(r.toDate)} ({r.days}d)
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{r.reason}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge status={r.status} />
            {(r.status === "PENDING" || (r.status === "APPROVED" && r.fromDate > todayIso())) && (
              <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => cancel(r.id)}>
                Cancel
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ApprovalsTab({ isAdmin }: { isAdmin: boolean }) {
  const [scope, setScope] = useState<"team" | "all">("team");
  const [items, setItems] = useState<LeaveRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const r = await apiFetch<{ items: LeaveRequest[] }>(`/api/leave/requests?scope=${scope}&status=PENDING`);
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
      await apiFetch(`/api/leave/requests/${id}/${decision}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {isAdmin && (
        <div className="mb-4 flex gap-1">
          <Button size="sm" variant={scope === "team" ? "primary" : "secondary"} onClick={() => setScope("team")}>
            My team
          </Button>
          <Button size="sm" variant={scope === "all" ? "primary" : "secondary"} onClick={() => setScope("all")}>
            Everyone
          </Button>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState>Nothing pending.</EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <Card key={r.id} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {r.employee.name} ({r.employee.empCode}) · {r.leaveType.name}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatDate(r.fromDate)} – {formatDate(r.toDate)} ({r.days}d) · {r.reason}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy === r.id} onClick={() => decide(r.id, "approve")}>
                  Approve
                </Button>
                <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decide(r.id, "reject")}>
                  Reject
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminTab() {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [holidays, setHolidays] = useState<{ id: string; date: string; name: string }[]>([]);
  const [typeForm, setTypeForm] = useState({ name: "", code: "", annualQuota: 12, paid: true, carryForward: false, allowHalfDay: true });
  const [holidayForm, setHolidayForm] = useState({ date: todayIso(), name: "" });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [t, h] = await Promise.all([
        apiFetch<{ items: LeaveType[] }>("/api/leave/types"),
        apiFetch<{ items: { id: string; date: string; name: string }[] }>(`/api/holidays?year=${Number(todayIso().slice(0, 4))}`),
      ]);
      setTypes(t.items);
      setHolidays(h.items);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function addType(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/api/leave/types", { method: "POST", body: JSON.stringify(typeForm) });
      setTypeForm({ name: "", code: "", annualQuota: 12, paid: true, carryForward: false, allowHalfDay: true });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function addHoliday(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/api/holidays", { method: "POST", body: JSON.stringify(holidayForm) });
      setHolidayForm({ date: todayIso(), name: "" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function removeHoliday(id: string) {
    try {
      await apiFetch(`/api/holidays/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="grid gap-5 md:grid-cols-2">
      {error && <div className="md:col-span-2"><Alert>{error}</Alert></div>}

      <Card>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Leave types</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {types.map((t) => (
            <li key={t.id} className="flex justify-between text-zinc-700 dark:text-zinc-300">
              <span>{t.name}</span>
              <span className="text-zinc-400">{t.code}</span>
            </li>
          ))}
        </ul>
        <form onSubmit={addType} className="mt-4 flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name" required value={typeForm.name} onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))} />
            <Input placeholder="Code" required value={typeForm.code} onChange={(e) => setTypeForm((f) => ({ ...f, code: e.target.value }))} />
          </div>
          <Input
            type="number"
            min={0}
            placeholder="Annual quota"
            required
            value={typeForm.annualQuota}
            onChange={(e) => setTypeForm((f) => ({ ...f, annualQuota: Number(e.target.value) }))}
          />
          <Button type="submit" size="sm">
            Add leave type
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Holidays ({todayIso().slice(0, 4)})</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between text-zinc-700 dark:text-zinc-300">
              <span>
                {formatDate(h.date)} · {h.name}
              </span>
              <button onClick={() => removeHoliday(h.id)} className="text-xs text-red-500 hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={addHoliday} className="mt-4 flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <Input type="date" required value={holidayForm.date} onChange={(e) => setHolidayForm((f) => ({ ...f, date: e.target.value }))} />
          <Input placeholder="Name" required value={holidayForm.name} onChange={(e) => setHolidayForm((f) => ({ ...f, name: e.target.value }))} />
          <Button type="submit" size="sm">
            Add holiday
          </Button>
        </form>
      </Card>
    </div>
  );
}
