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

type Me = { employeeId: string; permissions: string[] };

const TABS = ["Apply", "My requests", "Approvals", "Admin"] as const;

export default function LeavePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Apply");

  useEffect(() => {
    apiFetch<{ session: Me }>("/api/me").then((r) => setMe(r.session)).catch(() => {});
  }, []);

  const can = (p: string) => me?.permissions.includes(p) ?? false;
  const canApproveAll = can("leave.approve_all");
  const isApprover = can("leave.approve_team") || canApproveAll;
  const canTypes = can("leave.manage_types");
  const canHolidays = can("holidays.manage");
  const isAdmin = canTypes || canHolidays;
  const visibleTabs = TABS.filter((t) => (t === "Approvals" ? isApprover : t === "Admin" ? isAdmin : true));

  return (
    <div>
      <PageHeader title="Leave" description="Request time off and keep track of approvals" />
      <Tabs tabs={visibleTabs} value={tab} onChange={setTab} />

      {tab === "Apply" && <ApplyTab />}
      {tab === "My requests" && <MyRequestsTab />}
      {tab === "Approvals" && isApprover && <ApprovalsTab canApproveAll={canApproveAll} canTeam={can("leave.approve_team")} />}
      {tab === "Admin" && isAdmin && <AdminTab canTypes={canTypes} canHolidays={canHolidays} />}
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

function ApprovalsTab({ canApproveAll, canTeam }: { canApproveAll: boolean; canTeam: boolean }) {
  // Org-wide approvers without the team permission start on (and only see) "Everyone".
  const [scope, setScope] = useState<"team" | "all">(canTeam || !canApproveAll ? "team" : "all");
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
      {canApproveAll && (
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

// Decimal columns arrive as JSON strings from Prisma.
type AdminLeaveType = LeaveType & {
  annualQuota: string | number;
  paid: boolean;
  carryForward: boolean;
  maxCarryForward: string | number | null;
};

/** Form state; maxCarryForward "" = no cap. */
type TypeDraft = {
  name: string;
  code: string;
  annualQuota: number;
  paid: boolean;
  carryForward: boolean;
  maxCarryForward: string;
  allowHalfDay: boolean;
};

const EMPTY_TYPE: TypeDraft = { name: "", code: "", annualQuota: 12, paid: true, carryForward: false, maxCarryForward: "", allowHalfDay: true };

const toDraft = (t: AdminLeaveType): TypeDraft => ({
  name: t.name,
  code: t.code,
  annualQuota: Number(t.annualQuota),
  paid: t.paid,
  carryForward: t.carryForward,
  maxCarryForward: t.maxCarryForward === null ? "" : String(Number(t.maxCarryForward)),
  allowHalfDay: t.allowHalfDay,
});

const toPayload = (d: TypeDraft) => ({
  ...d,
  maxCarryForward: d.carryForward && d.maxCarryForward !== "" ? Number(d.maxCarryForward) : null,
});

function typeSummary(t: AdminLeaveType) {
  const parts = [`${Number(t.annualQuota)} days/yr`, t.paid ? "Paid" : "Unpaid"];
  if (t.carryForward) {
    parts.push(t.maxCarryForward === null ? "Carry forward: all" : `Carry forward: up to ${Number(t.maxCarryForward)}`);
  }
  if (!t.allowHalfDay) parts.push("No half days");
  return parts.join(" · ");
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
      <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Shared by the add form and the inline editor. */
function LeaveTypeFields({ draft, onChange }: { draft: TypeDraft; onChange: (patch: Partial<TypeDraft>) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="Name, e.g. Sick leave" aria-label="Name" required value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
        <Input placeholder="Code, e.g. SL" aria-label="Code" required value={draft.code} onChange={(e) => onChange({ code: e.target.value })} />
      </div>
      <Field label="Days per year">
        <Input type="number" min={0} step={0.5} required value={draft.annualQuota} onChange={(e) => onChange({ annualQuota: Number(e.target.value) })} />
      </Field>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Check label="Paid" checked={draft.paid} onChange={(paid) => onChange({ paid })} />
        <Check label="Allow half days" checked={draft.allowHalfDay} onChange={(allowHalfDay) => onChange({ allowHalfDay })} />
        <Check label="Carry forward unused days" checked={draft.carryForward} onChange={(carryForward) => onChange({ carryForward })} />
      </div>
      {draft.carryForward && (
        <Field label="Max days carried into next year (blank = no limit)">
          <Input
            type="number"
            min={0}
            step={0.5}
            placeholder="No limit"
            value={draft.maxCarryForward}
            onChange={(e) => onChange({ maxCarryForward: e.target.value })}
          />
        </Field>
      )}
    </>
  );
}

function AdminTab({ canTypes, canHolidays }: { canTypes: boolean; canHolidays: boolean }) {
  const [types, setTypes] = useState<AdminLeaveType[]>([]);
  const [holidays, setHolidays] = useState<{ id: string; date: string; name: string }[]>([]);
  const [typeForm, setTypeForm] = useState<TypeDraft>(EMPTY_TYPE);
  const [editing, setEditing] = useState<{ id: string; draft: TypeDraft } | null>(null);
  const [holidayForm, setHolidayForm] = useState({ date: todayIso(), name: "" });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [t, h] = await Promise.all([
        apiFetch<{ items: AdminLeaveType[] }>("/api/leave/types", { cache: "no-store" }),
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
      await apiFetch("/api/leave/types", { method: "POST", body: JSON.stringify(toPayload(typeForm)) });
      setTypeForm(EMPTY_TYPE);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function saveType(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      await apiFetch(`/api/leave/types/${editing.id}`, { method: "PATCH", body: JSON.stringify(toPayload(editing.draft)) });
      setEditing(null);
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
          {types.map((t) =>
            editing?.id === t.id ? (
              <li key={t.id} className="py-3">
                <form onSubmit={saveType} className="flex flex-col gap-3 rounded-xl bg-surface-2 p-4 ring-1 ring-inset ring-line">
                  <LeaveTypeFields
                    draft={editing.draft}
                    onChange={(patch) => setEditing((ed) => (ed ? { ...ed, draft: { ...ed.draft, ...patch } } : ed))}
                  />
                  <p className="text-xs text-ink-3">A new days-per-year value applies to balance years created from now on.</p>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">Save</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{t.name}</span>
                  <span className="block text-xs text-ink-3">{typeSummary(t)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs text-ink-2 ring-1 ring-inset ring-line">{t.code}</span>
                  {canTypes && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ id: t.id, draft: toDraft(t) })} aria-label={`Edit ${t.name}`}>
                      Edit
                    </Button>
                  )}
                </span>
              </li>
            ),
          )}
        </ul>
        {canTypes && <form onSubmit={addType} className="mt-5 flex flex-col gap-3 rounded-xl bg-surface-2 p-4 ring-1 ring-inset ring-line">
          <p className="text-[13px] font-semibold text-ink-2">Add a leave type</p>
          <LeaveTypeFields draft={typeForm} onChange={(patch) => setTypeForm((f) => ({ ...f, ...patch }))} />
          <Button type="submit" size="sm" className="self-start">
            <PlusIcon size={14} />
            Add leave type
          </Button>
        </form>}
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
                {canHolidays && <Button size="sm" variant="ghost" onClick={() => removeHoliday(h.id)} className="text-rose-600 dark:text-rose-400" aria-label={`Remove ${h.name}`}>
                  Remove
                </Button>}
              </li>
            ))}
          </ul>
        )}
        {canHolidays && <form onSubmit={addHoliday} className="mt-5 flex flex-col gap-3 rounded-xl bg-surface-2 p-4 ring-1 ring-inset ring-line">
          <p className="text-[13px] font-semibold text-ink-2">Add a holiday</p>
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <Input type="date" required value={holidayForm.date} onChange={(e) => setHolidayForm((f) => ({ ...f, date: e.target.value }))} aria-label="Holiday date" />
            <Input placeholder="Name, e.g. Diwali" required value={holidayForm.name} onChange={(e) => setHolidayForm((f) => ({ ...f, name: e.target.value }))} aria-label="Holiday name" />
          </div>
          <Button type="submit" size="sm" className="self-start">
            <PlusIcon size={14} />
            Add holiday
          </Button>
        </form>}
      </Card>
    </div>
  );
}
