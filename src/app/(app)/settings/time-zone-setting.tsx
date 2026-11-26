"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Button, Card, CardTitle, Field, Select } from "@/components/ui";
import { timeZoneOptions } from "@/lib/dates";

/** Organization time zone (T15): drives "today", punches, shifts and the times everyone sees. */
export function TimeZoneSetting() {
  const [saved, setSaved] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => timeZoneOptions(), []);

  useEffect(() => {
    apiFetch<{ timeZone: string }>("/api/organization")
      .then((r) => {
        setSaved(r.timeZone);
        setValue(r.timeZone);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await apiFetch<{ timeZone: string }>("/api/organization", { method: "PATCH", body: JSON.stringify({ timeZone: value }) });
      setSaved(r.timeZone);
      setMessage("Time zone saved. Reload to see times in the new zone.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardTitle>Time zone</CardTitle>
      <p className="-mt-2 mb-4 text-sm text-muted-foreground">
        Decides when a day starts for check-ins, shifts and leave, and the zone times are shown in. Offices in another zone can override it under Attendance → Office locations.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 sm:max-w-sm">
          <Field label="Organization time zone">
            <Select value={value} disabled={!saved} onChange={(e) => setValue(e.target.value)}>
              {!saved && <option value="">Loading…</option>}
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button onClick={save} disabled={busy || !saved || value === saved}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      {message && <div className="mt-4"><Alert kind="success">{message}</Alert></div>}
    </Card>
  );
}
