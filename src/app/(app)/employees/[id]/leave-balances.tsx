"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Button, Card, CardTitle, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { PlusIcon } from "@/components/icons";
import { formatDate, todayIso } from "@/lib/dates";

type Balance = {
  leaveTypeId: string;
  code: string;
  name: string;
  unlimited: boolean;
  annualGrant: number;
  carriedForward: number;
  granted: number;
  used: number;
  pending: number;
  available: number;
};

type Adjustment = {
  id: string;
  leaveType: { id: string; name: string; code: string };
  year: number;
  days: number;
  kind: "MANUAL" | "QUOTA_CHANGE";
  reason: string;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
};

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Leave balances for one employee and year, the adjustment history, and (for holders of
 * leave.adjust_balances viewing someone else) a credit/debit form.
 */
export function LeaveBalancesCard({ employeeId, canAdjust }: { employeeId: string; canAdjust: boolean }) {
  const thisYear = Number(todayIso().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [history, setHistory] = useState<Adjustment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ leaveTypeId: "", direction: "credit" as "credit" | "debit", days: "1", reason: "" });
  const [saving, setSaving] = useState(false);

  async function load(y = year) {
    try {
      const qs = `employeeId=${encodeURIComponent(employeeId)}&year=${y}`;
      const [b, h] = await Promise.all([
        apiFetch<{ balances: Balance[] }>(`/api/leave/balances?${qs}`, { cache: "no-store" }),
        apiFetch<{ items: Adjustment[] }>(`/api/leave/adjustments?${qs}`, { cache: "no-store" }),
      ]);
      setBalances(b.balances);
      setHistory(h.items);
      setForm((f) => (f.leaveTypeId ? f : { ...f, leaveTypeId: b.balances[0]?.leaveTypeId ?? "" }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, year]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const days = Number(form.days) * (form.direction === "debit" ? -1 : 1);
      await apiFetch("/api/leave/adjustments", {
        method: "POST",
        body: JSON.stringify({ employeeId, leaveTypeId: form.leaveTypeId, year, days, reason: form.reason }),
      });
      setSuccess(`Balance ${form.direction === "credit" ? "credited" : "debited"} by ${Math.abs(days)} day(s).`);
      setForm((f) => ({ ...f, days: "1", reason: "" }));
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="lg:col-span-3">
      <CardTitle
        action={
          <div className="flex items-center gap-2">
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" className="h-8 w-auto text-[13px]">
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
            {canAdjust && !formOpen && (
              <Button size="sm" variant="secondary" onClick={() => setFormOpen(true)}>
                <PlusIcon size={14} />
                Adjust
              </Button>
            )}
          </div>
        }
      >
        Leave balances
      </CardTitle>

      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {success && <div className="mb-3"><Alert kind="success">{success}</Alert></div>}

      {canAdjust && formOpen && balances && (
        <form onSubmit={submit} className="mb-5 grid gap-3 rounded-xl bg-muted p-4 ring-1 ring-inset ring-border sm:grid-cols-[1fr_auto_7rem]">
          <Field label="Leave type">
            <Select required value={form.leaveTypeId} onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))}>
              {balances.map((b) => (
                <option key={b.leaveTypeId} value={b.leaveTypeId}>{b.name} ({b.code})</option>
              ))}
            </Select>
          </Field>
          <Field label="Change">
            <Select value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as "credit" | "debit" }))}>
              <option value="credit">Credit (+)</option>
              <option value="debit">Debit (−)</option>
            </Select>
          </Field>
          <Field label="Days">
            <Input type="number" min={0.5} max={365} step={0.5} required value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} />
          </Field>
          <div className="sm:col-span-3">
            <Field label={`Reason (kept in the history for ${year})`}>
              <Textarea
                required
                minLength={3}
                maxLength={500}
                rows={2}
                placeholder="e.g. Comp-off for weekend release, 22 Nov"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </Field>
          </div>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : "Save adjustment"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {!balances ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : balances.length === 0 ? (
        <p className="text-sm text-muted-foreground">No leave types are set up yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[13px] text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 text-right font-medium">Granted</th>
                <th className="py-2 pr-4 text-right font-medium">Used</th>
                <th className="py-2 pr-4 text-right font-medium">Pending</th>
                <th className="py-2 text-right font-medium">Available</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {balances.map((b) => (
                <tr key={b.leaveTypeId}>
                  <td className="py-2.5 pr-4">
                    <span className="font-medium text-foreground">{b.name}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{b.code}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-foreground/80">
                    {b.unlimited ? "—" : b.granted}
                    {b.carriedForward > 0 && (
                      <span className="block text-xs text-muted-foreground">{b.annualGrant} + {b.carriedForward} carried</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-foreground/80">{b.used}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-foreground/80">{b.pending}</td>
                  <td className="py-2.5 text-right font-semibold tabular-nums text-foreground">{b.unlimited ? "Unlimited" : b.available}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6">
        <p className="mb-2 text-[13px] font-semibold text-foreground/80">Adjustment history · {year}</p>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No adjustments this year.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="text-foreground">
                    <span className="font-medium">{a.leaveType.name}</span>
                    {a.kind === "QUOTA_CHANGE" && (
                      <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border">Quota change</span>
                    )}
                  </p>
                  <p className="text-foreground/80">{a.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(a.createdAt.slice(0, 10))}
                    {a.createdBy && ` · by ${a.createdBy.name}`}
                  </p>
                </div>
                <span
                  className={cx(
                    "shrink-0 font-semibold tabular-nums",
                    a.days > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300",
                  )}
                >
                  {signed(a.days)} d
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
