"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Avatar, Badge, Button, Card, CardTitle, EmptyState, Field, Input, PageHeader, Segmented, Spinner, Table, Tabs, Textarea } from "@/components/ui";
import { CheckIcon, DownloadIcon, LogInIcon, LogOutIcon, PinIcon, XIcon } from "@/components/icons";
import { formatDate, formatMinutes, formatTime, parseIsoDate, todayIso } from "@/lib/dates";
import { currentPosition, punch as punchWithLocation, punchMessage, WORK_MODE_LABEL, type PunchAction, type PunchLog } from "@/lib/punch";

type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";
type Day = Omit<PunchLog, "remoteRequest"> & {
  status: string;
  leaveType: string | null;
  remoteStatus: RequestStatus | null;
};
type RemoteRequest = {
  id: string;
  employee: { id: string; name: string; empCode: string };
  date: string;
  checkIn: string;
  checkOut: string;
  workedMinutes: number;
  latitude: number | null;
  longitude: number | null;
  status: RequestStatus;
  approver: { name: string } | null;
};
type OfficeLocation = { id: string; name: string; latitude: number | null; longitude: number | null; radiusMeters: number; isOffice: boolean };
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
type Me = { role: "ADMIN" | "MANAGER" | "EMPLOYEE"; employeeId: string };

const TABS = ["My attendance", "Regularizations", "Remote work", "Team report", "Office locations"] as const;

export default function AttendancePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("My attendance");

  useEffect(() => {
    apiFetch<{ session: Me }>("/api/me").then((r) => setMe(r.session)).catch(() => {});
  }, []);

  const isApprover = me?.role === "ADMIN" || me?.role === "MANAGER";
  const isHr = me?.role === "ADMIN";
  const visibleTabs = TABS.filter((t) => (t === "Team report" ? isApprover : t === "Office locations" ? isHr : true));

  return (
    <div>
      <PageHeader title="Attendance" description="Your check-ins, corrections and team reports" />
      <Tabs tabs={visibleTabs} value={tab} onChange={setTab} />

      {tab === "My attendance" && <MyAttendanceTab />}
      {tab === "Regularizations" && <RegularizationsTab isApprover={isApprover} />}
      {tab === "Remote work" && <RemoteWorkTab isHr={isHr} myId={me?.employeeId} />}
      {tab === "Team report" && isApprover && <TeamReportTab />}
      {tab === "Office locations" && isHr && <OfficeLocationsTab />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p className="flex items-center gap-2 text-[13px] text-ink-3">
        <span className={`size-2 rounded-full ${tone}`} />
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function MyAttendanceTab() {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [days, setDays] = useState<Day[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  async function punch(action: PunchAction) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(punchMessage(action, await punchWithLocation(action)));
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
      setRegMessage("Correction requested. Your manager will review it.");
      setRegForm((f) => ({ ...f, reason: "" }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const today = days?.find((d) => d.date === todayIso());
  const onTheClock = !!today?.openSince;

  return (
    <div className="space-y-5">
      {error && <Alert>{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-night p-5 text-white shadow-card ring-1 ring-inset ring-white/5">
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div>
            <p className="text-white/50">First in</p>
            <p className="font-display text-xl font-semibold tabular-nums">{formatTime(today?.checkIn ? new Date(today.checkIn) : null)}</p>
          </div>
          <div>
            <p className="text-white/50">{onTheClock ? "In since" : "Last out"}</p>
            <p className="font-display text-xl font-semibold tabular-nums">
              {formatTime(onTheClock ? new Date(today!.openSince!) : today?.checkOut ? new Date(today.checkOut) : null)}
            </p>
          </div>
          {today?.workMode && (
            <div>
              <p className="text-white/50">Working from</p>
              <p className="flex items-center gap-1.5 font-display text-xl font-semibold">
                <PinIcon size={16} className="text-marigold" />
                {WORK_MODE_LABEL[today.workMode]}
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            disabled={busy || onTheClock}
            onClick={() => punch("check-in")}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-marigold px-4 text-sm font-semibold text-night disabled:opacity-40"
          >
            <LogInIcon size={16} />
            {busy && !onTheClock ? "Locating…" : today?.sessions.length ? "Check in again" : "Check in"}
          </button>
          <button
            disabled={busy || !onTheClock}
            onClick={() => punch("check-out")}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/15 hover:bg-white/15 disabled:opacity-40"
          >
            <LogOutIcon size={16} />
            {busy && onTheClock ? "Locating…" : "Check out"}
          </button>
        </div>
        {today && today.sessions.length > 1 && (
          <ol className="flex basis-full flex-wrap gap-2 text-[13px]" aria-label="Today's sessions">
            {today.sessions.map((s) => (
              <li key={s.id} className="rounded-lg bg-white/10 px-2.5 py-1 tabular-nums text-white/80 ring-1 ring-inset ring-white/10">
                {formatTime(new Date(s.checkIn))}–{s.checkOut ? formatTime(new Date(s.checkOut)) : "now"}
                {s.workMode && <span className="text-white/50"> · {WORK_MODE_LABEL[s.workMode]}</span>}
              </li>
            ))}
          </ol>
        )}
        {notice && <p className="basis-full text-[13px] text-white/60">{notice}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-ink">Monthly log</h2>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="max-w-44" aria-label="Month" />
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Present" value={summary.present} tone="bg-emerald-500" />
          <Stat label="Absent" value={summary.absent} tone="bg-rose-500" />
          <Stat label="On leave" value={summary.leave} tone="bg-sky-500" />
          <Stat label="Hours worked" value={formatMinutes(summary.workedMinutes)} tone="bg-marigold" />
        </div>
      )}

      {!days ? (
        <Spinner />
      ) : (
        <Table head={["Date", "Status", "Mode", "First in", "Last out", "Worked"]} minWidth={720}>
          {days.map((d) => {
            const isToday = d.date === todayIso();
            return (
              <tr key={d.date} className={isToday ? "bg-brand-soft/60" : "hover:bg-surface-2"}>
                <td className="px-5 py-3">
                  <span className="font-medium text-ink">{formatDate(d.date)}</span>
                  <span className="ml-2 text-[13px] text-ink-3">{parseIsoDate(d.date).toLocaleString("en-GB", { weekday: "short", timeZone: "UTC" })}</span>
                </td>
                <td className="px-5 py-3">
                  <Badge status={d.status} />
                </td>
                <td className="px-5 py-3">
                  {d.workMode ? (
                    <span className="flex items-center gap-2">
                      <Badge status={d.workMode}>{WORK_MODE_LABEL[d.workMode]}</Badge>
                      {d.remoteStatus && <span className="text-[13px] text-ink-3">HR {d.remoteStatus.toLowerCase()}</span>}
                    </span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
                <td className="px-5 py-3 tabular-nums text-ink-2">{formatTime(d.checkIn ? new Date(d.checkIn) : null)}</td>
                <td className="px-5 py-3 tabular-nums text-ink-2">{d.openSince ? "On the clock" : formatTime(d.checkOut ? new Date(d.checkOut) : null)}</td>
                <td className="px-5 py-3 tabular-nums text-ink-2">
                  {d.workedMinutes ? formatMinutes(d.workedMinutes) : "—"}
                  {d.sessions.length > 1 && <span className="ml-1.5 text-[13px] text-ink-3">({d.sessions.length} sessions)</span>}
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      <Card className="max-w-xl">
        <CardTitle>Fix a missed check-in</CardTitle>
        <p className="-mt-2 mb-4 text-sm text-ink-3">Forgot to punch? Send the correct times to your manager for approval.</p>
        <form onSubmit={submitReg} className="flex flex-col gap-4">
          <Field label="Date">
            <Input type="date" required max={todayIso()} value={regForm.date} onChange={(e) => setRegForm((f) => ({ ...f, date: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
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
            Request correction
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
        <div className="mb-5">
          <Segmented
            options={[
              { value: "mine", label: "Mine" },
              { value: "team", label: "My team" },
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
        <EmptyState hint={scope === "team" ? "Your team hasn't asked for any corrections." : "Requests you make from My attendance show up here."}>
          No correction requests
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <Card key={r.id} className="flex flex-wrap items-center gap-4 p-4 sm:p-4">
              {scope === "team" && <Avatar name={r.employee.name} />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  {scope === "team" ? r.employee.name : formatDate(r.date)}
                  {scope === "team" && <span className="font-normal text-ink-3"> for {formatDate(r.date)}</span>}
                </p>
                <p className="text-[13px] text-ink-3">
                  <span className="tabular-nums text-ink-2">
                    {formatTime(new Date(r.checkIn))}–{formatTime(new Date(r.checkOut))}
                  </span>{" "}
                  · {r.reason}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge status={r.status} />
                {scope === "team" && r.status === "PENDING" && (
                  <>
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decide(r.id, "reject")}>
                      <XIcon size={14} />
                      Reject
                    </Button>
                    <Button size="sm" disabled={busy === r.id} onClick={() => decide(r.id, "approve")}>
                      <CheckIcon size={14} />
                      Approve
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="max-w-44" aria-label="Month" />
        <a
          href={`/api/attendance/report?month=${month}&format=csv`}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2"
        >
          <DownloadIcon size={16} />
          Download CSV
        </a>
      </div>
      {error && <Alert>{error}</Alert>}
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState>No attendance recorded for this month</EmptyState>
      ) : (
        <Table head={["Employee", "Present", "Absent", "Leave", "Worked"]} minWidth={600}>
          {rows.map((r) => (
            <tr key={r.empCode} className="hover:bg-surface-2">
              <td className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={r.name} size="sm" />
                  <span>
                    <span className="block font-semibold text-ink">{r.name}</span>
                    <span className="block font-mono text-xs text-ink-3">{r.empCode}</span>
                  </span>
                </div>
              </td>
              <td className="px-5 py-3 tabular-nums text-emerald-700 dark:text-emerald-300">{r.present}</td>
              <td className="px-5 py-3 tabular-nums text-ink-2">{r.absent}</td>
              <td className="px-5 py-3 tabular-nums text-ink-2">{r.leave}</td>
              <td className="px-5 py-3 tabular-nums font-medium text-ink">{formatMinutes(r.workedMinutes)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

const mapLink = (lat: number, lon: number, zoom = 16) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;

/** Remote days go to HR: everyone sees their own; HR admins also see and decide everyone's. */
function RemoteWorkTab({ isHr, myId }: { isHr: boolean; myId?: string }) {
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [items, setItems] = useState<RemoteRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const r = await apiFetch<{ items: RemoteRequest[] }>(`/api/attendance/remote-requests?scope=${scope}`);
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
      await apiFetch(`/api/attendance/remote-requests/${id}/${decision}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {isHr && (
        <div className="mb-5">
          <Segmented
            options={[
              { value: "mine", label: "Mine" },
              { value: "all", label: "HR review" },
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
        <EmptyState hint={scope === "all" ? "Remote days show up here when people check out." : "Checking out of a day outside the office sends HR a request automatically."}>
          No remote work requests
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <Card key={r.id} className="flex flex-wrap items-center gap-4 p-4 sm:p-4">
              {scope === "all" && <Avatar name={r.employee.name} />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  {scope === "all" ? r.employee.name : formatDate(r.date)}
                  {scope === "all" && <span className="font-normal text-ink-3"> for {formatDate(r.date)}</span>}
                </p>
                <p className="text-[13px] text-ink-3">
                  <span className="tabular-nums text-ink-2">
                    {formatTime(new Date(r.checkIn))}–{formatTime(new Date(r.checkOut))}
                  </span>{" "}
                  · {formatMinutes(r.workedMinutes)} worked
                  {r.latitude !== null && r.longitude !== null && (
                    <>
                      {" · "}
                      <a href={mapLink(r.latitude, r.longitude)} target="_blank" rel="noreferrer" className="font-medium text-brand-ink hover:underline">
                        Check-in location
                      </a>
                    </>
                  )}
                  {r.approver && ` · ${r.status.toLowerCase()} by ${r.approver.name}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge status={r.status} />
                {scope === "all" && r.status === "PENDING" && r.employee.id !== myId && (
                  <>
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decide(r.id, "reject")}>
                      <XIcon size={14} />
                      Reject
                    </Button>
                    <Button size="sm" disabled={busy === r.id} onClick={() => decide(r.id, "approve")}>
                      <CheckIcon size={14} />
                      Approve
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

type LocationForm = { id: string | null; name: string; latitude: string; longitude: string; radiusMeters: string };
const EMPTY_FORM: LocationForm = { id: null, name: "", latitude: "", longitude: "", radiusMeters: "200" };

/** Admin: mark which locations are offices by giving them a centre point and radius. */
function OfficeLocationsTab() {
  const [items, setItems] = useState<OfficeLocation[] | null>(null);
  const [form, setForm] = useState<LocationForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await apiFetch<{ items: OfficeLocation[] }>("/api/locations");
      setItems(r.items);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  function edit(l: OfficeLocation) {
    setMessage(null);
    setError(null);
    setForm({ id: l.id, name: l.name, latitude: l.latitude?.toString() ?? "", longitude: l.longitude?.toString() ?? "", radiusMeters: String(l.radiusMeters) });
  }

  async function useMyLocation() {
    setLocating(true);
    setError(null);
    const pos = await currentPosition();
    setLocating(false);
    if (!pos) return setError("Couldn't get your location. Allow location access in the browser, or type the coordinates in.");
    setForm((f) => f && { ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) });
  }

  async function save(e: FormEvent | MouseEvent, clearGeofence = false) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const geofence =
      clearGeofence || (!form.latitude.trim() && !form.longitude.trim())
        ? { latitude: null, longitude: null }
        : { latitude: Number(form.latitude), longitude: Number(form.longitude) };
    const body = JSON.stringify({ name: form.name, radiusMeters: Number(form.radiusMeters), ...geofence });
    try {
      if (form.id) await apiFetch(`/api/locations/${form.id}`, { method: "PATCH", body });
      else await apiFetch("/api/locations", { method: "POST", body });
      setMessage(geofence.latitude === null ? `${form.name} saved. It isn't an office, so check-ins there count as remote.` : `${form.name} saved as an office.`);
      setForm(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-ink-3">
          Check-ins within an office&apos;s radius are logged as <strong className="text-ink-2">office</strong>. Anywhere else counts as{" "}
          <strong className="text-ink-2">remote</strong>, and checking out sends HR a remote work request.
        </p>
        <Button onClick={() => setForm({ ...EMPTY_FORM })}>Add location</Button>
      </div>
      {error && <Alert>{error}</Alert>}
      {message && <Alert kind="success">{message}</Alert>}

      {form && (
        <Card className="max-w-xl">
          <CardTitle>{form.id ? `Edit ${form.name}` : "New location"}</CardTitle>
          <form onSubmit={save} className="flex flex-col gap-4">
            <Field label="Name">
              <Input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Latitude">
                <Input type="number" step="any" min={-90} max={90} placeholder="12.971600" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
              </Field>
              <Field label="Longitude">
                <Input type="number" step="any" min={-180} max={180} placeholder="77.594600" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
              </Field>
            </div>
            <Field label="Radius (metres)">
              <Input type="number" required min={20} max={5000} value={form.radiusMeters} onChange={(e) => setForm({ ...form, radiusMeters: e.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={locating} onClick={useMyLocation}>
                <PinIcon size={15} />
                {locating ? "Locating…" : "Use my current location"}
              </Button>
              {form.id && (form.latitude || form.longitude) && (
                <Button type="button" variant="ghost" disabled={saving} onClick={(e) => save(e.nativeEvent, true)}>
                  Not an office
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setForm(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState hint="Add your office so check-ins there count as office days.">No locations yet</EmptyState>
      ) : (
        <Table head={["Location", "Type", "Centre", "Radius", ""]} minWidth={640}>
          {items.map((l) => (
            <tr key={l.id} className="hover:bg-surface-2">
              <td className="px-5 py-3 font-semibold text-ink">{l.name}</td>
              <td className="px-5 py-3">
                <Badge status={l.isOffice ? "OFFICE" : "REMOTE"}>{l.isOffice ? "Office" : "Not an office"}</Badge>
              </td>
              <td className="px-5 py-3 font-mono text-xs text-ink-2">
                {l.isOffice ? (
                  <a href={mapLink(l.latitude!, l.longitude!, 17)} target="_blank" rel="noreferrer" className="hover:underline">
                    {l.latitude!.toFixed(5)}, {l.longitude!.toFixed(5)}
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-5 py-3 tabular-nums text-ink-2">{l.isOffice ? `${l.radiusMeters} m` : "—"}</td>
              <td className="px-5 py-3 text-right">
                <Button size="sm" variant="secondary" onClick={() => edit(l)}>
                  {l.isOffice ? "Edit" : "Set geofence"}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
