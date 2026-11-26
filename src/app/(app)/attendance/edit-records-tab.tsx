"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Badge, Button, Card, CardTitle, EmptyState, Field, Input, Select, Spinner, Table } from "@/components/ui";
import { formatDate, formatMinutes, formatTime, todayIso } from "@/lib/dates";

type Snapshot = { checkIn: string | null; checkOut: string | null; workedMinutes: number } | null;
type Edit = {
  id: string;
  date: string;
  before: Snapshot;
  after: Snapshot;
  reason: string;
  source: "MANUAL" | "IMPORT";
  createdBy: { id: string; name: string } | null;
  createdAt: string;
};
type Person = { id: string; name: string; empCode: string };
type ImportRow = {
  line: number;
  employee: Person | null;
  date: string;
  checkIn: string;
  checkOut: string;
  action: "create" | "update" | "unchanged" | "error";
  error?: string;
};
type ImportResult = { rows: ImportRow[]; summary: { total: number; create: number; update: number; unchanged: number; errors: number }; applied: number };

const snap = (s: Snapshot) => (s ? `${formatTime(s.checkIn ? new Date(s.checkIn) : null)} – ${formatTime(s.checkOut ? new Date(s.checkOut) : null)} (${formatMinutes(s.workedMinutes)})` : "Nothing recorded");

const TEMPLATE = "employee,date,checkIn,checkOut,reason\nEMP001,2026-11-02,09:00,18:00,Biometric export\n";

/** Admin: set or clear a day of anyone's attendance, import from CSV, and see the audit trail (T17). */
export function EditRecordsTab() {
  return (
    <div className="space-y-6">
      <EditDay />
      <ImportCsv />
    </div>
  );
}

function EditDay() {
  const [people, setPeople] = useState<Person[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [checkIn, setCheckIn] = useState("09:00");
  const [checkOut, setCheckOut] = useState("18:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [trail, setTrail] = useState<Edit[] | null>(null);

  useEffect(() => {
    apiFetch<{ managers: Person[] }>("/api/lookups")
      .then((r) => setPeople(r.managers))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function loadTrail(id: string) {
    setTrail(null);
    try {
      setTrail((await apiFetch<{ items: Edit[] }>(`/api/attendance/edits?employeeId=${id}`)).items);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function submit(clear: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/api/attendance/edits", {
        method: "POST",
        body: JSON.stringify({ employeeId, date, checkIn: clear ? null : checkIn, checkOut: clear ? null : checkOut, reason }),
      });
      setMessage(clear ? `Cleared ${formatDate(date)}.` : `Saved ${formatDate(date)}. The employee has been notified.`);
      setReason("");
      await loadTrail(employeeId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = employeeId && date && reason.trim().length >= 3;

  return (
    <Card>
      <CardTitle>Edit a day</CardTitle>
      <p className="-mt-2 mb-4 max-w-2xl text-sm text-muted-foreground">
        Replaces that day&apos;s check-ins with one entry (times in the employee&apos;s time zone), or clears it. Every change is recorded with your reason and the employee is notified.
        For your own attendance, request a regularization instead.
      </p>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (ready) submit(false);
        }}
        className="grid max-w-3xl gap-4 sm:grid-cols-2"
      >
        <Field label="Employee">
          <Select
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setMessage(null);
              if (e.target.value) loadTrail(e.target.value);
              else setTrail(null);
            }}
          >
            <option value="">Select…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.empCode})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" required max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Check-in">
          <Input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </Field>
        <Field label="Check-out">
          <Input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Reason (kept in the audit trail)">
            <Input required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Biometric device was down" />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy || !ready || !checkIn || !checkOut}>
            {busy ? "Saving…" : "Save times"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy || !ready} onClick={() => submit(true)}>
            Clear the day
          </Button>
        </div>
      </form>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      {message && <div className="mt-4"><Alert kind="success">{message}</Alert></div>}

      {employeeId && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Recent changes for this employee</h3>
          {!trail ? (
            <Spinner />
          ) : trail.length === 0 ? (
            <EmptyState>No edits yet</EmptyState>
          ) : (
            <Table head={["Date", "Before", "After", "Reason", "By"]} minWidth={760}>
              {trail.map((t) => (
                <tr key={t.id} className="hover:bg-muted">
                  <td className="px-5 py-3 tabular-nums">{formatDate(t.date)}</td>
                  <td className="px-5 py-3 text-foreground/80">{snap(t.before)}</td>
                  <td className="px-5 py-3 text-foreground/80">{snap(t.after)}</td>
                  <td className="px-5 py-3 text-foreground/80">
                    {t.reason} {t.source === "IMPORT" && <Badge status="PENDING">CSV</Badge>}
                  </td>
                  <td className="px-5 py-3 text-foreground/80">
                    {t.createdBy?.name ?? "—"}
                    <span className="block text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString("en-GB")}</span>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}
    </Card>
  );
}

function ImportCsv() {
  const [csv, setCsv] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await apiFetch<ImportResult>("/api/attendance/import", { method: "POST", body: JSON.stringify({ csv, dryRun, reason: reason.trim() || undefined }) });
      setResult(dryRun ? r : null);
      if (!dryRun) {
        setMessage(`Imported ${r.applied} day${r.applied === 1 ? "" : "s"}${r.summary.unchanged ? ` (${r.summary.unchanged} already matched)` : ""}.`);
        setCsv("");
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch (e) {
      setError(errorMessage(e));
      if (!dryRun) setResult(null);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    setResult(null);
    setMessage(null);
    if (file) setCsv(await file.text());
  }

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;

  return (
    <Card>
      <CardTitle>Import from CSV</CardTitle>
      <p className="-mt-2 mb-4 max-w-2xl text-sm text-muted-foreground">
        Columns: <code>employee</code> (code or email), <code>date</code> (YYYY-MM-DD), <code>checkIn</code>, <code>checkOut</code> (HH:mm, employee&apos;s time zone), optional{" "}
        <code>reason</code>. Up to 500 rows; days already recorded are replaced. Preview first: if any row has an error, nothing is imported.{" "}
        <a href={template} download="attendance-import-template.csv" className="font-medium text-foreground underline">
          Download a template
        </a>
      </p>
      <div className="grid max-w-3xl gap-4">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm file:font-semibold"
        />
        <Field label="Or paste CSV">
          <textarea
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setResult(null);
            }}
            rows={5}
            spellCheck={false}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 font-mono text-xs"
          />
        </Field>
        <Field label="Default reason (for rows without one)">
          <Input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="CSV import" />
        </Field>
        <div className="flex gap-2">
          <Button disabled={busy || !csv.trim()} onClick={() => run(true)} variant="secondary">
            {busy && !result ? "Checking…" : "Preview"}
          </Button>
          <Button disabled={busy || !result || result.summary.errors > 0 || result.summary.create + result.summary.update === 0} onClick={() => run(false)}>
            Import {result ? result.summary.create + result.summary.update : ""} day(s)
          </Button>
        </div>
      </div>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      {message && <div className="mt-4"><Alert kind="success">{message}</Alert></div>}

      {result && (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-foreground/80">
            {result.summary.total} rows: <strong>{result.summary.create}</strong> new, <strong>{result.summary.update}</strong> replacing, {result.summary.unchanged} unchanged,{" "}
            <strong className={result.summary.errors ? "text-destructive" : ""}>{result.summary.errors}</strong> with errors.
          </p>
          <Table head={["Line", "Employee", "Date", "In", "Out", "Result"]} minWidth={720}>
            {result.rows.map((r) => (
              <tr key={r.line} className="hover:bg-muted">
                <td className="px-5 py-3 tabular-nums text-muted-foreground">{r.line}</td>
                <td className="px-5 py-3">{r.employee ? `${r.employee.name} (${r.employee.empCode})` : "—"}</td>
                <td className="px-5 py-3 tabular-nums">{r.date}</td>
                <td className="px-5 py-3 tabular-nums">{r.checkIn}</td>
                <td className="px-5 py-3 tabular-nums">{r.checkOut}</td>
                <td className="px-5 py-3">
                  {r.action === "error" ? (
                    <span className="text-destructive">{r.error}</span>
                  ) : (
                    <Badge status={r.action === "unchanged" ? "CANCELLED" : "APPROVED"}>{r.action === "create" ? "New" : r.action === "update" ? "Replaces" : "Unchanged"}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}
