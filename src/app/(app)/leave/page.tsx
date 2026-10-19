"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Avatar, Badge, Button, Card, CardTitle, EmptyState, Field, Input, PageHeader, Segmented, Select, Spinner, Tabs, Textarea, cx } from "@/components/ui";
import { CheckIcon, PlusIcon, XIcon } from "@/components/icons";
import { formatDate, parseIsoDate, todayIso } from "@/lib/dates";

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
      <PageHeader title="Leave" description="Request time off and keep track of approvals" />
      <Tabs tabs={visibleTabs} value={tab} onChange={setTab} />

      {tab === "Apply" && <ApplyTab />}
      {tab === "My requests" && <MyRequestsTab />}
      {tab === "Approvals" && isApprover && <ApprovalsTab isAdmin={isAdmin} />}
      {tab === "Admin" && isAdmin && <AdminTab />}
    </div>
  );
}

/** Compact date block: big day number, small month. */
function DateTile({ iso, className }: { iso: string; className?: string }) {
  const d = parseIsoDate(iso);
  return (
    <span className={cx("flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 leading-none ring-1 ring-inset ring-line", className)}>
      <span className="text-[10px] font-semibold text-brand-ink">{d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}</span>
      <span className="mt-0.5 font-display text-lg font-semibold text-ink">{d.getUTCDate()}</span>
    </span>
  );
}

function dateRange(r: LeaveRequest) {
  const range = r.fromDate === r.toDate ? formatDate(r.fromDate) : `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}`;
  const part = r.dayPart === "FIRST_HALF" ? ", first half" : r.dayPart === "SECOND_HALF" ? ", second half" : "";
  return `${range}${part} · ${r.days} ${r.days === 1 ? "day" : "days"}`;
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
      setSuccess("Request sent. You'll see it under My requests.");
      setForm((f) => ({ ...f, reason: "" }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <CardTitle>New leave request</CardTitle>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink-2">Leave type</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Leave type">
            {types.map((t) => {
              const active = form.leaveTypeId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setForm((f) => ({ ...f, leaveTypeId: t.id, dayPart: t.allowHalfDay ? f.dayPart : "FULL" }))}
                  className={cx(
                    "rounded-xl px-3.5 py-2 text-sm font-semibold ring-1 ring-inset transition-colors",
                    active ? "bg-brand-soft text-brand-ink ring-brand/40" : "bg-surface text-ink-2 ring-line hover:bg-surface-2",
                  )}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From">
            <Input type="date" required value={form.fromDate} onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))} />
          </Field>
          <Field label="To">
            <Input type="date" required value={form.toDate} onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))} />
          </Field>
        </div>
        <Field label="Duration">
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
          <Textarea required minLength={3} rows={3} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="A short note for your manager" />
        </Field>
        {error && <Alert>{error}</Alert>}
        {success && <Alert kind="success">{success}</Alert>}
        <Button type="submit" disabled={saving || !form.leaveTypeId} className="self-start">
          {saving ? "Sending…" : "Send request"}
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
  if (items.length === 0) return <EmptyState hint="Requests you send from the Apply tab will show up here.">No leave requests yet</EmptyState>;

  return (
    <div className="space-y-3">
      {items.map((r) => (
        <Card key={r.id} className="flex flex-wrap items-center gap-4 p-4 sm:p-4">
          <DateTile iso={r.fromDate} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{r.leaveType.name}</p>
            <p className="text-[13px] text-ink-2">{dateRange(r)}</p>
            <p className="truncate text-[13px] text-ink-3">{r.reason}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge status={r.status} />
            {(r.status === "PENDING" || (r.status === "APPROVED" && r.fromDate > todayIso())) && (
              <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => cancel(r.id)}>
                Cancel request
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
        <div className="mb-5">
          <Segmented
            options={[
              { value: "team", label: "My team" },
              { value: "all", label: "Everyone" },
            ]}
            value={scope}
            onChange={setScope}
          />
        </div>
      )}
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState hint="New requests from your team will appear here.">You&rsquo;re all caught up</EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <Card key={r.id} className="flex flex-wrap items-center gap-4 p-4 sm:p-4">
              <Avatar name={r.employee.name} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  <span className="font-semibold">{r.employee.name}</span> <span className="font-mono text-xs text-ink-3">{r.employee.empCode}</span>
                </p>
                <p className="text-[13px] text-ink-2">
                  {r.leaveType.name}, {dateRange(r)}
                </p>
                <p className="truncate text-[13px] text-ink-3">“{r.reason}”</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decide(r.id, "reject")}>
                  <XIcon size={14} />
                  Reject
                </Button>
                <Button size="sm" disabled={busy === r.id} onClick={() => decide(r.id, "approve")}>
                  <CheckIcon size={14} />
                  Approve
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
    <div className="grid gap-5 lg:grid-cols-2">
      {error && <div className="lg:col-span-2"><Alert>{error}</Alert></div>}

      <Card>
        <CardTitle>Leave types</CardTitle>
        <ul className="divide-y divide-line">
          {types.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
              <span className="font-medium text-ink">{t.name}</span>
              <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs text-ink-2 ring-1 ring-inset ring-line">{t.code}</span>
            </li>
          ))}
        </ul>
        <form onSubmit={addType} className="mt-5 flex flex-col gap-3 rounded-xl bg-surface-2 p-4 ring-1 ring-inset ring-line">
          <p className="text-[13px] font-semibold text-ink-2">Add a leave type</p>
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Name, e.g. Sick leave" required value={typeForm.name} onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))} />
            <Input placeholder="Code, e.g. SL" required value={typeForm.code} onChange={(e) => setTypeForm((f) => ({ ...f, code: e.target.value }))} />
          </div>
          <Field label="Days per year">
            <Input
              type="number"
              min={0}
              required
              value={typeForm.annualQuota}
              onChange={(e) => setTypeForm((f) => ({ ...f, annualQuota: Number(e.target.value) }))}
            />
          </Field>
          <Button type="submit" size="sm" className="self-start">
            <PlusIcon size={14} />
            Add leave type
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Holidays in {todayIso().slice(0, 4)}</CardTitle>
        {holidays.length === 0 ? (
          <p className="text-sm text-ink-3">No holidays added for this year.</p>
        ) : (
          <ul className="space-y-2">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center gap-3">
                <DateTile iso={h.date} className="size-11" />
                <span className="flex-1 text-sm font-medium text-ink">{h.name}</span>
                <Button size="sm" variant="ghost" onClick={() => removeHoliday(h.id)} className="text-rose-600 dark:text-rose-400" aria-label={`Remove ${h.name}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addHoliday} className="mt-5 flex flex-col gap-3 rounded-xl bg-surface-2 p-4 ring-1 ring-inset ring-line">
          <p className="text-[13px] font-semibold text-ink-2">Add a holiday</p>
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <Input type="date" required value={holidayForm.date} onChange={(e) => setHolidayForm((f) => ({ ...f, date: e.target.value }))} aria-label="Holiday date" />
            <Input placeholder="Name, e.g. Diwali" required value={holidayForm.name} onChange={(e) => setHolidayForm((f) => ({ ...f, name: e.target.value }))} aria-label="Holiday name" />
          </div>
          <Button type="submit" size="sm" className="self-start">
            <PlusIcon size={14} />
            Add holiday
          </Button>
        </form>
      </Card>
    </div>
  );
}
