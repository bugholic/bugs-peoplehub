"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Badge, Button, Card, CardTitle, EmptyState, Field, Input, Spinner, Table } from "@/components/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/confirm-dialog";
import { formatMinutes } from "@/lib/dates";

type Shift = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  isDefault: boolean;
  overnight: boolean;
  scheduledMinutes: number;
  employeeCount: number;
};

/** Form state: hour fields are edited as hours ("4.5"), stored as minutes. */
type Draft = { id?: string; name: string; startTime: string; endTime: string; grace: string; halfDayHours: string; fullDayHours: string; isDefault: boolean };

const EMPTY: Draft = { name: "", startTime: "09:00", endTime: "18:00", grace: "15", halfDayHours: "4", fullDayHours: "8", isDefault: false };

const hours = (min: number) => String(Math.round((min / 60) * 100) / 100);

function toDraft(s: Shift): Draft {
  return {
    id: s.id,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    grace: String(s.graceMinutes),
    halfDayHours: hours(s.halfDayMinutes),
    fullDayHours: hours(s.fullDayMinutes),
    isDefault: s.isDefault,
  };
}

function toPayload(d: Draft) {
  return {
    name: d.name.trim(),
    startTime: d.startTime,
    endTime: d.endTime,
    graceMinutes: Number(d.grace),
    halfDayMinutes: Math.round(Number(d.halfDayHours) * 60),
    fullDayMinutes: Math.round(Number(d.fullDayHours) * 60),
    // Unticking the default isn't allowed server-side; only send it when making one the default.
    ...(d.isDefault ? { isDefault: true } : {}),
  };
}

/** Admin tab: define shifts and pick the org default (T13). Employees are assigned on their profile. */
export function ShiftsTab() {
  const [items, setItems] = useState<Shift[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  async function load() {
    try {
      setItems((await apiFetch<{ items: Shift[] }>("/api/shifts")).items);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const body = JSON.stringify(toPayload(draft));
      if (draft.id) await apiFetch(`/api/shifts/${draft.id}`, { method: "PATCH", body });
      else await apiFetch("/api/shifts", { method: "POST", body });
      setMessage(`${draft.name.trim()} saved. Changes apply to attendance from the next punch; past days keep their figures.`);
      setDraft(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(s: Shift) {
    setError(null);
    try {
      await apiFetch(`/api/shifts/${s.id}`, { method: "PATCH", body: JSON.stringify({ isDefault: true }) });
      setMessage(`${s.name} is now the default shift.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(s: Shift) {
    const who = s.employeeCount ? ` ${s.employeeCount} ${s.employeeCount === 1 ? "employee moves" : "employees move"} to the default shift.` : "";
    if (!(await confirm({ title: `Delete ${s.name}?`, description: `This can't be undone.${who}`, confirmLabel: "Delete shift", destructive: true }))) return;
    setError(null);
    try {
      await apiFetch(`/api/shifts/${s.id}`, { method: "DELETE" });
      setMessage(`${s.name} deleted.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => d && { ...d, ...patch });

  return (
    <div className="space-y-5">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          A shift sets when the day starts and ends. Check-ins after the grace period count as <strong className="text-foreground/80">late</strong>, and a
          finished day needs the full-day hours to count as present (half-day hours for a half day). Employees without a shift follow the default.
        </p>
        <Button onClick={() => setDraft({ ...EMPTY, isDefault: items?.length === 0 })}>Add shift</Button>
      </div>
      {error && <Alert>{error}</Alert>}
      {message && <Alert kind="success">{message}</Alert>}

      {draft && (
        <Card className="max-w-xl">
          <CardTitle>{draft.id ? `Edit ${draft.name}` : "New shift"}</CardTitle>
          <form onSubmit={save} className="flex flex-col gap-4">
            <Field label="Name">
              <Input required maxLength={60} placeholder="General, Night…" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Starts">
                <Input type="time" required value={draft.startTime} onChange={(e) => set({ startTime: e.target.value })} />
              </Field>
              <Field label="Ends">
                <Input type="time" required value={draft.endTime} onChange={(e) => set({ endTime: e.target.value })} />
              </Field>
            </div>
            {draft.endTime <= draft.startTime && <p className="-mt-2 text-[13px] text-muted-foreground">Overnight: ends the next day.</p>}
            <div className="grid grid-cols-3 gap-4">
              <Field label="Grace (min)">
                <Input type="number" required min={0} max={240} value={draft.grace} onChange={(e) => set({ grace: e.target.value })} />
              </Field>
              <Field label="Half day (h)">
                <Input type="number" required min={0} max={24} step={0.25} value={draft.halfDayHours} onChange={(e) => set({ halfDayHours: e.target.value })} />
              </Field>
              <Field label="Full day (h)">
                <Input type="number" required min={0.25} max={24} step={0.25} value={draft.fullDayHours} onChange={(e) => set({ fullDayHours: e.target.value })} />
              </Field>
            </div>
            {!items?.find((s) => s.id === draft.id)?.isDefault && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/80">
                <Checkbox checked={draft.isDefault} onCheckedChange={(v) => set({ isDefault: v === true })} />
                Default shift for everyone without one
              </label>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState hint="Without a shift, any check-in counts as a full present day.">No shifts yet</EmptyState>
      ) : (
        <Table head={["Shift", "Timing", "Grace", "Half / full day", "Employees", ""]} minWidth={760}>
          {items.map((s) => (
            <tr key={s.id} className="hover:bg-muted">
              <td className="px-5 py-3">
                <span className="flex items-center gap-2 font-semibold text-foreground">
                  {s.name}
                  {s.isDefault && <Badge status="APPROVED">Default</Badge>}
                </span>
              </td>
              <td className="px-5 py-3 tabular-nums text-foreground/80">
                {s.startTime}–{s.endTime}
                <span className="ml-1.5 text-[13px] text-muted-foreground">
                  ({formatMinutes(s.scheduledMinutes)}
                  {s.overnight ? ", overnight" : ""})
                </span>
              </td>
              <td className="px-5 py-3 tabular-nums text-foreground/80">{s.graceMinutes} min</td>
              <td className="px-5 py-3 tabular-nums text-foreground/80">
                {formatMinutes(s.halfDayMinutes)} / {formatMinutes(s.fullDayMinutes)}
              </td>
              <td className="px-5 py-3 tabular-nums text-foreground/80">{s.isDefault ? `${s.employeeCount} + unassigned` : s.employeeCount}</td>
              <td className="px-5 py-3">
                <div className="flex justify-end gap-2">
                  {!s.isDefault && (
                    <Button size="sm" variant="ghost" onClick={() => makeDefault(s)}>
                      Make default
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => (setMessage(null), setDraft(toDraft(s)))}>
                    Edit
                  </Button>
                  {(!s.isDefault || items.length === 1) && (
                    <Button size="sm" variant="ghost" onClick={() => remove(s)}>
                      Delete
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
