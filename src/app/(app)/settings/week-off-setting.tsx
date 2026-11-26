"use client";

import { useEffect, useState } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Button, Card, CardTitle, Spinner } from "@/components/ui";
import { WeekOffEditor } from "@/components/week-off-editor";
import { isValidWeekOff } from "@/lib/week-off";

/** Organization week-off pattern (T14): which days are weekly offs for attendance, leave counts and shifts. */
export function WeekOffSetting() {
  const [saved, setSaved] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ weekOff: string }>("/api/organization")
      .then((r) => {
        setSaved(r.weekOff);
        setValue(r.weekOff);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await apiFetch<{ weekOff: string }>("/api/organization", { method: "PATCH", body: JSON.stringify({ weekOff: value }) });
      setSaved(r.weekOff);
      setValue(r.weekOff);
      setMessage("Weekly off saved. It applies to new leave requests and attendance from now on; existing leave requests keep their day counts.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardTitle>Weekly off</CardTitle>
      <p className="-mt-2 mb-4 text-sm text-muted-foreground">
        Days nobody is expected to work: they aren&apos;t counted as leave, aren&apos;t marked absent, and any time worked counts as overtime. Locations with a different
        pattern can override it under Attendance → Office locations.
      </p>
      {saved === null ? (
        error ? null : <Spinner />
      ) : (
        <>
          <WeekOffEditor value={value} onChange={setValue} disabled={busy} />
          <div className="mt-4 flex gap-2">
            <Button onClick={save} disabled={busy || value === saved || !isValidWeekOff(value)}>
              {busy ? "Saving…" : "Save"}
            </Button>
            {value !== saved && (
              <Button variant="ghost" onClick={() => setValue(saved)} disabled={busy}>
                Reset
              </Button>
            )}
          </div>
        </>
      )}
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      {message && <div className="mt-4"><Alert kind="success">{message}</Alert></div>}
    </Card>
  );
}
