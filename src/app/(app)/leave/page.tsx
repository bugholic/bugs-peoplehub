"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { useTabParam } from "@/hooks/use-tab-param";
import { Alert, Avatar, Badge, Button, Card, CardTitle, EmptyState, Field, Input, PageHeader, Segmented, Select, Spinner, Tabs, Textarea, cx } from "@/components/ui";
import { CheckIcon, PlusIcon, XIcon } from "@/components/icons";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate, parseIsoDate, todayIso } from "@/lib/dates";

type LeaveType = {
  id: string;
  name: string;
  code: string;
  allowHalfDay: boolean;
};
type LeaveRequest = {
  id: string;
  employee: { id: string; name: string; empCode: string };
  leaveType: { name: string };
  fromDate: string;
  toDate: string;
  dayPart: string;
  days: number;
  groupId: string | null;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string;
};

/** One application: a single request, or the parts of a combined leave (same groupId), in date order. */
type Application = {
  key: string;
  lead: LeaveRequest;
  parts: LeaveRequest[];
  fromDate: string;
  toDate: string;
  days: number;
};

function groupRequests(items: LeaveRequest[]): Application[] {
  const out: Application[] = [];
  const byGroup = new Map<string, Application>();
  for (const r of items) {
    const existing = r.groupId ? byGroup.get(r.groupId) : undefined;
    if (existing) {
      existing.parts.push(r);
      continue;
    }
    const app = {
      key: r.groupId ?? r.id,
      lead: r,
      parts: [r],
      fromDate: r.fromDate,
      toDate: r.toDate,
      days: 0,
    };
    if (r.groupId) byGroup.set(r.groupId, app);
    out.push(app);
  }
  for (const a of out) {
    a.parts.sort((x, y) => x.fromDate.localeCompare(y.fromDate));
    a.lead = a.parts[0];
    a.fromDate = a.parts[0].fromDate;
    a.toDate = a.parts[a.parts.length - 1].toDate;
    a.days = a.parts.reduce((n, x) => n + x.days, 0);
  }
  return out;
}

const dayCount = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** "Casual leave" or "Casual leave 12 days + Earned leave 3 days". */
function typeLabel(a: Application) {
  return a.parts.length === 1 ? a.lead.leaveType.name : a.parts.map((x) => `${x.leaveType.name} ${dayCount(x.days)}`).join(" + ");
}

function applicationRange(a: Application) {
  if (a.parts.length === 1) return dateRange(a.lead);
  const range = a.fromDate === a.toDate ? formatDate(a.fromDate) : `${formatDate(a.fromDate)} – ${formatDate(a.toDate)}`;
  return `${range} · ${dayCount(a.days)}`;
}

type Me = { employeeId: string; permissions: string[] };

const TABS = ["Apply", "My requests", "Approvals", "Admin"] as const;

export default function LeavePage() {
  // useTabParam reads useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense fallback={<Spinner />}>
      <LeavePageContent />
    </Suspense>
  );
}

function LeavePageContent() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useTabParam(TABS, "Apply");

  useEffect(() => {
    apiFetch<{ session: Me }>("/api/me")
      .then((r) => setMe(r.session))
      .catch(() => {});
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
    <span className={cx("flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-muted leading-none ring-1 ring-inset ring-border", className)}>
      <span className="text-[10px] font-semibold text-accent-foreground">{d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}</span>
      <span className="mt-0.5 text-lg font-semibold text-foreground">{d.getUTCDate()}</span>
    </span>
  );
}

function dateRange(r: LeaveRequest) {
  const range = r.fromDate === r.toDate ? formatDate(r.fromDate) : `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}`;
  const part = r.dayPart === "FIRST_HALF" ? ", first half" : r.dayPart === "SECOND_HALF" ? ", second half" : "";
  return `${range}${part} · ${r.days} ${r.days === 1 ? "day" : "days"}`;
}

type Preview = {
  days: number;
  available: number | null;
  covered: boolean;
  suggestion: {
    parts: { leaveTypeId: string; days: number }[];
    shortfall: number;
  } | null;
  balances: {
    leaveTypeId: string;
    name: string;
    paid: boolean;
    available: number | null;
  }[];
};
type PartDraft = { leaveTypeId: string; days: string };

function ApplyTab() {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [form, setForm] = useState({
    leaveTypeId: "",
    fromDate: todayIso(),
    toDate: todayIso(),
    dayPart: "FULL",
    reason: "",
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  // Combined leave breakdown; null = a single-type request.
  const [parts, setParts] = useState<PartDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ items: LeaveType[] }>("/api/leave/types").then((r) => {
      setTypes(r.items);
      if (r.items[0]) setForm((f) => ({ ...f, leaveTypeId: r.items[0].id }));
    });
  }, []);

  // Working days and balance for the current selection; when the chosen type doesn't cover
  // it, the server suggests a combined split, which prefills the breakdown.
  useEffect(() => {
    const { leaveTypeId, fromDate, toDate, dayPart } = form;
    if (!leaveTypeId || !fromDate || !toDate || toDate < fromDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({
        leaveTypeId,
        fromDate,
        toDate,
        dayPart,
      });
      apiFetch<Preview>(`/api/leave/requests/preview?${qs}`)
        .then((p) => {
          if (!live) return;
          setPreview(p);
          // Dates or type changed: the old breakdown no longer fits.
          setParts(null);
        })
        .catch(() => live && setPreview(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [form.leaveTypeId, form.fromDate, form.toDate, form.dayPart]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedType = types.find((t) => t.id === form.leaveTypeId);
  const nameOf = (id: string) => preview?.balances.find((b) => b.leaveTypeId === id)?.name ?? types.find((t) => t.id === id)?.name ?? "";
  const partsTotal = parts?.reduce((n, x) => n + (Number(x.days) || 0), 0) ?? 0;
  const partsMismatch = !!parts && !!preview && partsTotal !== preview.days;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const { leaveTypeId, dayPart, ...range } = form;
      const body = parts
        ? {
            ...range,
            parts: parts.map((x) => ({
              leaveTypeId: x.leaveTypeId,
              days: Number(x.days),
            })),
          }
        : { ...range, leaveTypeId, dayPart };
      await apiFetch("/api/leave/requests", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSuccess(parts ? "Combined request sent. Your manager approves it as one request." : "Request sent. You'll see it under My requests.");
      setForm((f) => ({ ...f, reason: "" }));
      setParts(null);
      setPreview(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const setPart = (i: number, patch: Partial<PartDraft>) => setParts((ps) => ps && ps.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const unusedTypes = preview?.balances.filter((b) => !parts?.some((x) => x.leaveTypeId === b.leaveTypeId)) ?? [];

  return (
    <Card className="max-w-xl">
      <CardTitle>New leave request</CardTitle>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-[13px] font-medium text-foreground/80">Leave type</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Leave type">
            {types.map((t) => {
              const active = form.leaveTypeId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      leaveTypeId: t.id,
                      dayPart: t.allowHalfDay ? f.dayPart : "FULL",
                    }))
                  }
                  className={cx(
                    "rounded-xl px-3.5 py-2 text-sm font-semibold ring-1 ring-inset transition-colors",
                    active ? "bg-accent text-accent-foreground ring-primary/40" : "bg-card text-foreground/80 ring-border hover:bg-muted",
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

        {preview && (
          <p className="-mt-2 text-[13px] text-muted-foreground">
            {dayCount(preview.days)} of leave
            {preview.available !== null && (
              <>
                {" "}
                · {preview.available} {nameOf(form.leaveTypeId)} available
              </>
            )}
          </p>
        )}

        {preview && !preview.covered && form.dayPart === "FULL" && (
          <div className="rounded-xl border border-amber-600/20 bg-amber-50 p-4 text-sm dark:border-amber-400/25 dark:bg-amber-400/10">
            {!parts ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-amber-800 dark:text-amber-200">
                  Not enough {nameOf(form.leaveTypeId)} for {dayCount(preview.days)}. Cover the rest with another leave type.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (preview.suggestion && preview.suggestion.parts.length > 1) {
                      return setParts(preview.suggestion.parts.map((x) => ({ leaveTypeId: x.leaveTypeId, days: String(x.days) })));
                    }
                    // No suggestion (e.g. no other balance left): start from the chosen type and one more.
                    const own = Math.max(0, Math.floor(preview.available ?? 0));
                    const other = preview.balances.find((b) => b.leaveTypeId !== form.leaveTypeId);
                    setParts([{ leaveTypeId: form.leaveTypeId, days: String(own) }, ...(other ? [{ leaveTypeId: other.leaveTypeId, days: String(preview.days - own) }] : [])]);
                  }}
                >
                  Combine leave types
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-amber-900 dark:text-amber-100">Combined leave</p>
                  <button type="button" className="text-[13px] text-amber-800 underline-offset-2 hover:underline dark:text-amber-200" onClick={() => setParts(null)}>
                    Use one type
                  </button>
                </div>
                <p className="-mt-2 text-[13px] text-amber-800 dark:text-amber-200">Days are taken in this order from the start date. Your manager approves it as one request.</p>
                {parts.map((x, i) => {
                  const bal = preview.balances.find((b) => b.leaveTypeId === x.leaveTypeId);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <Select aria-label={`Leave type ${i + 1}`} value={x.leaveTypeId} onChange={(e) => setPart(i, { leaveTypeId: e.target.value })} className="flex-1 bg-card">
                        {preview.balances
                          .filter((b) => b.leaveTypeId === x.leaveTypeId || !parts.some((y) => y.leaveTypeId === b.leaveTypeId))
                          .map((b) => (
                            <option key={b.leaveTypeId} value={b.leaveTypeId}>
                              {b.name} {b.available === null ? "(unpaid)" : `(${b.available} left)`}
                            </option>
                          ))}
                      </Select>
                      <Input
                        type="number"
                        aria-label={`Days of ${bal?.name ?? "leave"}`}
                        min={1}
                        step={1}
                        max={bal?.available ?? undefined}
                        required
                        value={x.days}
                        onChange={(e) => setPart(i, { days: e.target.value })}
                        className="w-20 bg-card"
                      />
                      <span className="text-[13px] text-amber-800 dark:text-amber-200">days</span>
                      {parts.length > 2 && (
                        <Button type="button" size="sm" variant="ghost" aria-label="Remove" onClick={() => setParts((ps) => ps && ps.filter((_, k) => k !== i))}>
                          <XIcon size={14} />
                        </Button>
                      )}
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {unusedTypes.length > 0 && parts.length < 5 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setParts(
                          (ps) =>
                            ps && [
                              ...ps,
                              {
                                leaveTypeId: unusedTypes[0].leaveTypeId,
                                days: "",
                              },
                            ],
                        )
                      }
                    >
                      <PlusIcon size={14} />
                      Add type
                    </Button>
                  ) : (
                    <span />
                  )}
                  <span className={cx("text-[13px] font-medium tabular-nums", partsMismatch ? "text-rose-700 dark:text-rose-300" : "text-amber-900 dark:text-amber-100")}>
                    {partsTotal} of {dayCount(preview.days)}
                  </span>
                </div>
                {preview.suggestion && preview.suggestion.shortfall > 0 && (
                  <p className="text-[13px] text-rose-700 dark:text-rose-300">
                    Your balances cover {preview.days - preview.suggestion.shortfall} of {dayCount(preview.days)}. Shorten the dates or ask HR about unpaid leave.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <Field label="Reason">
          <Textarea
            required
            minLength={3}
            rows={3}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            placeholder="A short note for your manager"
          />
        </Field>
        {error && <Alert>{error}</Alert>}
        {success && <Alert kind="success">{success}</Alert>}
        <Button type="submit" disabled={saving || !form.leaveTypeId || partsMismatch} className="self-start">
          {saving ? "Sending…" : parts ? "Send combined request" : "Send request"}
        </Button>
      </form>
    </Card>
  );
}

const addIsoDays = (iso: string, n: number) => {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Ends approved leave early (T18): everything from the chosen first day back is released and
 * the balance restored. `revoke` = a manager/HR doing it to someone else's leave (with a note).
 */
function ShortenAction({ app, revoke, onDone, onError }: { app: Application; revoke: boolean; onDone: () => void; onError: (m: string) => void }) {
  const today = todayIso();
  const earliest = app.fromDate > today ? app.fromDate : today;
  const [open, setOpen] = useState(false);
  const [returnOn, setReturnOn] = useState(revoke || earliest >= app.toDate ? earliest : addIsoDays(earliest, 1));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const wholeLeave = returnOn <= app.fromDate;

  async function submit() {
    setBusy(true);
    try {
      await apiFetch(`/api/leave/requests/${app.lead.id}/shorten`, { method: "POST", body: JSON.stringify({ returnOn, note: note.trim() || undefined }) });
      setOpen(false);
      onDone();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {revoke ? "Revoke" : "Return early"}
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-end gap-3 border-t border-border pt-3">
      <Field label={revoke ? "Release leave from" : "First day back at work"}>
        <Input type="date" min={earliest} max={app.toDate} value={returnOn} onChange={(e) => setReturnOn(e.target.value)} className="w-44" />
      </Field>
      {revoke && (
        <div className="min-w-48 flex-1">
          <Field label="Note to the employee (optional)">
            <Input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      )}
      <p className="basis-full text-[13px] text-muted-foreground">
        {wholeLeave ? "This cancels the whole leave." : `Leave ends on the working day before ${formatDate(returnOn)}; the days after are given back.`}
      </p>
      <Button size="sm" disabled={busy || !returnOn} onClick={submit}>
        {busy ? "Saving…" : revoke ? "Confirm revoke" : "Confirm"}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
        Back
      </Button>
    </div>
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
      {groupRequests(items).map(({ key, lead: r, ...a }) => (
        <Card key={key} className="flex flex-wrap items-center gap-4 p-4 sm:p-4">
          <DateTile iso={a.fromDate} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{typeLabel({ key, lead: r, ...a })}</p>
            <p className="text-[13px] text-foreground/80">{applicationRange({ key, lead: r, ...a })}</p>
            <p className="truncate text-[13px] text-muted-foreground">{r.reason}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge status={r.status} />
            {(r.status === "PENDING" || (r.status === "APPROVED" && a.fromDate > todayIso())) && (
              <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => cancel(r.id)}>
                Cancel request
              </Button>
            )}
            {r.status === "APPROVED" && a.fromDate <= todayIso() && a.toDate >= todayIso() && (
              <ShortenAction app={{ key, lead: r, ...a }} revoke={false} onDone={load} onError={setError} />
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
  // "APPROVED" lists ongoing and upcoming approved leave so it can be revoked (T18).
  const [status, setStatus] = useState<"PENDING" | "APPROVED">("PENDING");
  const [items, setItems] = useState<LeaveRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const r = await apiFetch<{ items: LeaveRequest[] }>(`/api/leave/requests?scope=${scope}&status=${status}`);
      setItems(status === "APPROVED" ? r.items.filter((x) => x.toDate >= todayIso()) : r.items);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, status]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id);
    try {
      await apiFetch(`/api/leave/requests/${id}/${decision}`, {
        method: "POST",
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-3">
        {canApproveAll && (
          <Segmented
            options={[
              { value: "team", label: "My team" },
              { value: "all", label: "Everyone" },
            ]}
            value={scope}
            onChange={setScope}
          />
        )}
        <Segmented
          options={[
            { value: "PENDING", label: "Pending" },
            { value: "APPROVED", label: "Approved (revoke)" },
          ]}
          value={status}
          onChange={(s) => {
            setItems(null);
            setStatus(s);
          }}
        />
      </div>
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState hint={status === "PENDING" ? "New requests from your team will appear here." : "Approved leave that is ongoing or still to come shows here."}>
          {status === "PENDING" ? "You\u2019re all caught up" : "No ongoing or upcoming approved leave"}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {groupRequests(items).map((a) => {
            const r = a.lead;
            return (
              <Card key={a.key} className="flex flex-wrap items-center gap-4 p-4 sm:p-4">
                <Avatar name={r.employee.name} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">
                    <span className="font-semibold">{r.employee.name}</span> <span className="font-mono text-xs text-muted-foreground">{r.employee.empCode}</span>
                  </p>
                  <p className="text-[13px] text-foreground/80">
                    {typeLabel(a)}, {applicationRange(a)}
                  </p>
                  <p className="truncate text-[13px] text-muted-foreground">“{r.reason}”</p>
                </div>
                {status === "APPROVED" ? (
                  <ShortenAction app={a} revoke onDone={load} onError={setError} />
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decide(r.id, "reject")}>
                      <XIcon size={14} />
                      Reject
                    </Button>
                    <Button size="sm" disabled={busy === r.id} onClick={() => decide(r.id, "approve")}>
                      <CheckIcon size={14} />
                      {a.parts.length > 1 ? "Approve all" : "Approve"}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
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

const EMPTY_TYPE: TypeDraft = {
  name: "",
  code: "",
  annualQuota: 12,
  paid: true,
  carryForward: false,
  maxCarryForward: "",
  allowHalfDay: true,
};

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
    <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/80">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
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
          <Input type="number" min={0} step={0.5} placeholder="No limit" value={draft.maxCarryForward} onChange={(e) => onChange({ maxCarryForward: e.target.value })} />
        </Field>
      )}
    </>
  );
}

function AdminTab({ canTypes, canHolidays }: { canTypes: boolean; canHolidays: boolean }) {
  const [types, setTypes] = useState<AdminLeaveType[]>([]);
  const [holidays, setHolidays] = useState<{ id: string; date: string; name: string }[]>([]);
  const [typeForm, setTypeForm] = useState<TypeDraft>(EMPTY_TYPE);
  const [editing, setEditing] = useState<{
    id: string;
    draft: TypeDraft;
  } | null>(null);
  const [holidayForm, setHolidayForm] = useState({
    date: todayIso(),
    name: "",
  });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [t, h] = await Promise.all([
        apiFetch<{ items: AdminLeaveType[] }>("/api/leave/types", {
          cache: "no-store",
        }),
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
      await apiFetch("/api/leave/types", {
        method: "POST",
        body: JSON.stringify(toPayload(typeForm)),
      });
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
      await apiFetch(`/api/leave/types/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify(toPayload(editing.draft)),
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function addHoliday(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/api/holidays", {
        method: "POST",
        body: JSON.stringify(holidayForm),
      });
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
      {error && (
        <div className="lg:col-span-2">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        <CardTitle>Leave types</CardTitle>
        <ul className="divide-y divide-border">
          {types.map((t) =>
            editing?.id === t.id ? (
              <li key={t.id} className="py-3">
                <form onSubmit={saveType} className="flex flex-col gap-3 rounded-xl bg-muted p-4 ring-1 ring-inset ring-border">
                  <LeaveTypeFields draft={editing.draft} onChange={(patch) => setEditing((ed) => (ed ? { ...ed, draft: { ...ed.draft, ...patch } } : ed))} />
                  <p className="text-xs text-muted-foreground">
                    A new days-per-year value also updates this year&apos;s and next year&apos;s existing balances by the difference (logged in each employee&apos;s adjustment
                    history).
                  </p>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">{typeSummary(t)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground/80 ring-1 ring-inset ring-border">{t.code}</span>
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
        {canTypes && (
          <form onSubmit={addType} className="mt-5 flex flex-col gap-3 rounded-xl bg-muted p-4 ring-1 ring-inset ring-border">
            <p className="text-[13px] font-semibold text-foreground/80">Add a leave type</p>
            <LeaveTypeFields draft={typeForm} onChange={(patch) => setTypeForm((f) => ({ ...f, ...patch }))} />
            <Button type="submit" size="sm" className="self-start">
              <PlusIcon size={14} />
              Add leave type
            </Button>
          </form>
        )}
      </Card>

      <Card>
        <CardTitle>Holidays in {todayIso().slice(0, 4)}</CardTitle>
        {holidays.length === 0 ? (
          <p className="text-sm text-muted-foreground">No holidays added for this year.</p>
        ) : (
          <ul className="space-y-2">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center gap-3">
                <DateTile iso={h.date} className="size-11" />
                <span className="flex-1 text-sm font-medium text-foreground">{h.name}</span>
                {canHolidays && (
                  <Button size="sm" variant="ghost" onClick={() => removeHoliday(h.id)} className="text-rose-600 dark:text-rose-400" aria-label={`Remove ${h.name}`}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canHolidays && (
          <form onSubmit={addHoliday} className="mt-5 flex flex-col gap-3 rounded-xl bg-muted p-4 ring-1 ring-inset ring-border">
            <p className="text-[13px] font-semibold text-foreground/80">Add a holiday</p>
            <div className="grid grid-cols-[auto_1fr] gap-3">
              <Input type="date" required value={holidayForm.date} onChange={(e) => setHolidayForm((f) => ({ ...f, date: e.target.value }))} aria-label="Holiday date" />
              <Input
                placeholder="Name, e.g. Diwali"
                required
                value={holidayForm.name}
                onChange={(e) => setHolidayForm((f) => ({ ...f, name: e.target.value }))}
                aria-label="Holiday name"
              />
            </div>
            <Button type="submit" size="sm" className="self-start">
              <PlusIcon size={14} />
              Add holiday
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
