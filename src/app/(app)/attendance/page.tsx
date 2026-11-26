"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { useTabParam } from "@/hooks/use-tab-param";
import { Alert, Avatar, Badge, Button, Card, CardTitle, EmptyState, Field, Input, PageHeader, Segmented, Select, Spinner, Table, Tabs, Textarea } from "@/components/ui";
import { CheckIcon, DownloadIcon, LogInIcon, LogOutIcon, PinIcon, XIcon } from "@/components/icons";
import { formatDate, formatMinutes, formatTime, parseIsoDate, timeZoneOptions, todayIso } from "@/lib/dates";
import { DEFAULT_WEEK_OFF, describeWeekOff, isValidWeekOff } from "@/lib/week-off";
import { WeekOffEditor } from "@/components/week-off-editor";
import { ShiftsTab } from "./shifts-tab";
import { EditRecordsTab } from "./edit-records-tab";
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
type OfficeLocation = { id: string; name: string; latitude: number | null; longitude: number | null; radiusMeters: number; isOffice: boolean; timeZone: string | null; weekOff: string | null };
type Summary = {
  present: number;
  absent: number;
  leave: number;
  holidays: number;
  workedMinutes: number;
  lateDays: number;
  earlyExitDays: number;
  overtimeMinutes: number;
};
type ReportRow = Summary & { empCode: string; name: string };
type Regularization = {
  id: string;
  employee: { name: string; empCode: string };
  date: string;
  checkIn: string;
  checkOut: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
};
type Me = { employeeId: string; permissions: string[] };

const TABS = ["My attendance", "Regularizations", "Remote work", "Team report", "Office locations", "Shifts", "Edit records"] as const;

export default function AttendancePage() {
  // useTabParam reads useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense fallback={<Spinner />}>
      <AttendancePageContent />
    </Suspense>
  );
}

function AttendancePageContent() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useTabParam(TABS, "My attendance");

  useEffect(() => {
    apiFetch<{ session: Me }>("/api/me").then((r) => setMe(r.session)).catch(() => {});
  }, []);

  const can = (p: string) => me?.permissions.includes(p) ?? false;
  const isApprover = can("attendance.approve_team") || can("attendance.approve_all");
  const isHr = can("attendance.remote_approve");
  const canReport = can("attendance.report_team") || can("attendance.report_all");
  const canLocations = can("attendance.manage_locations");
  const canShifts = can("attendance.manage_shifts");
  const canEdit = can("attendance.edit");
  const visibleTabs = TABS.filter((t) =>
    t === "Team report" ? canReport : t === "Office locations" ? canLocations : t === "Shifts" ? canShifts : t === "Edit records" ? canEdit : true,
  );

  return (
    <div>
      <PageHeader title="Attendance" description="Your check-ins, corrections and team reports" />
      <Tabs tabs={visibleTabs} value={tab} onChange={setTab} />

      {tab === "My attendance" && <MyAttendanceTab />}
      {tab === "Regularizations" && <RegularizationsTab isApprover={isApprover} />}
      {tab === "Remote work" && <RemoteWorkTab isHr={isHr} myId={me?.employeeId} />}
      {tab === "Team report" && canReport && <TeamReportTab />}
      {tab === "Office locations" && canLocations && <OfficeLocationsTab />}
      {tab === "Shifts" && canShifts && <ShiftsTab />}
      {tab === "Edit records" && canEdit && <EditRecordsTab />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className={`size-2 rounded-full ${tone}`} />
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
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

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-night p-5 text-white shadow-xs ring-1 ring-inset ring-white/5">
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div>
            <p className="text-white/50">First in</p>
            <p className="text-xl font-semibold tabular-nums">{formatTime(today?.checkIn ? new Date(today.checkIn) : null)}</p>
          </div>
          <div>
            <p className="text-white/50">{onTheClock ? "In since" : "Last out"}</p>
            <p className="text-xl font-semibold tabular-nums">
              {formatTime(onTheClock ? new Date(today!.openSince!) : today?.checkOut ? new Date(today.checkOut) : null)}
            </p>
          </div>
          {today?.workMode && (
            <div>
              <p className="text-white/50">Working from</p>
              <p className="flex items-center gap-1.5 text-xl font-semibold">
                <PinIcon size={16} className="text-marigold" />
                {WORK_MODE_LABEL[today.workMode]}
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="lg"
            disabled={busy || onTheClock}
            onClick={() => punch("check-in")}
            className="bg-marigold text-night hover:bg-marigold/90"
          >
            <LogInIcon size={16} />
            {busy && !onTheClock ? "Locating…" : today?.sessions.length ? "Check in again" : "Check in"}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            disabled={busy || !onTheClock}
            onClick={() => punch("check-out")}
            className="border-white/15 bg-white/10 text-white hover:bg-white/15 dark:bg-white/10 dark:hover:bg-white/15"
          >
            <LogOutIcon size={16} />
            {busy && onTheClock ? "Locating…" : "Check out"}
          </Button>
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
        <h2 className="text-lg font-semibold text-foreground">Monthly log</h2>
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
      {summary && (summary.lateDays > 0 || summary.earlyExitDays > 0 || summary.overtimeMinutes > 0) && (
        <p className="text-sm text-muted-foreground">
          {[
            summary.lateDays && `${summary.lateDays} late ${summary.lateDays === 1 ? "arrival" : "arrivals"}`,
            summary.earlyExitDays && `${summary.earlyExitDays} early ${summary.earlyExitDays === 1 ? "exit" : "exits"}`,
            summary.overtimeMinutes && `${formatMinutes(summary.overtimeMinutes)} overtime`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {!days ? (
        <Spinner />
      ) : (
        <Table head={["Date", "Status", "Mode", "First in", "Last out", "Worked"]} minWidth={720}>
          {days.map((d) => {
            const isToday = d.date === todayIso();
            return (
              <tr key={d.date} className={isToday ? "bg-accent/60" : "hover:bg-muted"}>
                <td className="px-5 py-3">
                  <span className="font-medium text-foreground">{formatDate(d.date)}</span>
                  <span className="ml-2 text-[13px] text-muted-foreground">{parseIsoDate(d.date).toLocaleString("en-GB", { weekday: "short", timeZone: "UTC" })}</span>
                </td>
                <td className="px-5 py-3">
                  <Badge status={d.status} />
                </td>
                <td className="px-5 py-3">
                  {d.workMode ? (
                    <span className="flex items-center gap-2">
                      <Badge status={d.workMode}>{WORK_MODE_LABEL[d.workMode]}</Badge>
                      {d.remoteStatus && <span className="text-[13px] text-muted-foreground">HR {d.remoteStatus.toLowerCase()}</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-5 py-3 tabular-nums text-foreground/80">{formatTime(d.checkIn ? new Date(d.checkIn) : null)}</td>
                <td className="px-5 py-3 tabular-nums text-foreground/80">
                  {d.openSince ? "On the clock" : formatTime(d.checkOut ? new Date(d.checkOut) : null)}
                  {d.edited && (
                    <span className="mt-0.5 block text-[12px] font-medium text-sky-700 dark:text-sky-300" title="Set by an administrator; the reason is in the audit trail.">
                      Edited by admin
                    </span>
                  )}
                  {d.autoClosed && (
                    <span className="mt-0.5 block text-[12px] font-medium text-amber-700 dark:text-amber-300" title="You didn't check out; closed by the system. Request a correction if the time is wrong.">
                      Auto-closed
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 tabular-nums text-foreground/80">
                  {d.workedMinutes ? formatMinutes(d.workedMinutes) : "—"}
                  {d.sessions.length > 1 && <span className="ml-1.5 text-[13px] text-muted-foreground">({d.sessions.length} sessions)</span>}
                  <ShiftFlags day={d} />
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      <Card className="max-w-xl">
        <CardTitle>Fix a missed check-in</CardTitle>
        <p className="-mt-2 mb-4 text-sm text-muted-foreground">Forgot to punch? Send the correct times to your manager for approval.</p>
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

/** Late-in / early-out / overtime markers for one day (shift rules, T13). */
function ShiftFlags({ day }: { day: Pick<Day, "lateMinutes" | "earlyExitMinutes" | "overtimeMinutes"> }) {
  const flags = [
    day.lateMinutes > 0 && { label: `Late ${formatMinutes(day.lateMinutes)}`, tone: "text-amber-700 dark:text-amber-300" },
    day.earlyExitMinutes > 0 && { label: `Left ${formatMinutes(day.earlyExitMinutes)} early`, tone: "text-amber-700 dark:text-amber-300" },
    day.overtimeMinutes > 0 && { label: `OT ${formatMinutes(day.overtimeMinutes)}`, tone: "text-emerald-700 dark:text-emerald-300" },
  ].filter((f): f is { label: string; tone: string } => !!f);
  if (!flags.length) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] font-medium">
      {flags.map((f) => (
        <span key={f.label} className={f.tone}>
          {f.label}
        </span>
      ))}
    </span>
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
                <p className="text-sm font-semibold text-foreground">
                  {scope === "team" ? r.employee.name : formatDate(r.date)}
                  {scope === "team" && <span className="font-normal text-muted-foreground"> for {formatDate(r.date)}</span>}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  <span className="tabular-nums text-foreground/80">
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
  const [rows, setRows] = useState<ReportRow[] | null>(null);
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
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted"
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
        <Table head={["Employee", "Present", "Absent", "Leave", "Late", "Worked", "Overtime"]} minWidth={760}>
          {rows.map((r) => (
            <tr key={r.empCode} className="hover:bg-muted">
              <td className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={r.name} size="sm" />
                  <span>
                    <span className="block font-semibold text-foreground">{r.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{r.empCode}</span>
                  </span>
                </div>
              </td>
              <td className="px-5 py-3 tabular-nums text-emerald-700 dark:text-emerald-300">{r.present}</td>
              <td className="px-5 py-3 tabular-nums text-foreground/80">{r.absent}</td>
              <td className="px-5 py-3 tabular-nums text-foreground/80">{r.leave}</td>
              <td className="px-5 py-3 tabular-nums text-foreground/80">{r.lateDays || "—"}</td>
              <td className="px-5 py-3 tabular-nums font-medium text-foreground">{formatMinutes(r.workedMinutes)}</td>
              <td className="px-5 py-3 tabular-nums text-foreground/80">{r.overtimeMinutes ? formatMinutes(r.overtimeMinutes) : "—"}</td>
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
                <p className="text-sm font-semibold text-foreground">
                  {scope === "all" ? r.employee.name : formatDate(r.date)}
                  {scope === "all" && <span className="font-normal text-muted-foreground"> for {formatDate(r.date)}</span>}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  <span className="tabular-nums text-foreground/80">
                    {formatTime(new Date(r.checkIn))}–{formatTime(new Date(r.checkOut))}
                  </span>{" "}
                  · {formatMinutes(r.workedMinutes)} worked
                  {r.latitude !== null && r.longitude !== null && (
                    <>
                      {" · "}
                      <a href={mapLink(r.latitude, r.longitude)} target="_blank" rel="noreferrer" className="font-medium text-accent-foreground hover:underline">
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

// weekOff null = the organization's pattern
type LocationForm = { id: string | null; name: string; latitude: string; longitude: string; radiusMeters: string; timeZone: string; weekOff: string | null };
const EMPTY_FORM: LocationForm = { id: null, name: "", latitude: "", longitude: "", radiusMeters: "200", timeZone: "", weekOff: null };

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
    setForm({ id: l.id, name: l.name, latitude: l.latitude?.toString() ?? "", longitude: l.longitude?.toString() ?? "", radiusMeters: String(l.radiusMeters), timeZone: l.timeZone ?? "", weekOff: l.weekOff });
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
    const body = JSON.stringify({ name: form.name, radiusMeters: Number(form.radiusMeters), timeZone: form.timeZone || null, weekOff: form.weekOff, ...geofence });
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
        <p className="max-w-xl text-sm text-muted-foreground">
          Check-ins within an office&apos;s radius are logged as <strong className="text-foreground/80">office</strong>. Anywhere else counts as{" "}
          <strong className="text-foreground/80">remote</strong>, and checking out sends HR a remote work request.
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
            <Field label="Time zone">
              <Select value={form.timeZone} onChange={(e) => setForm({ ...form, timeZone: e.target.value })}>
                <option value="">Organization default</option>
                {timeZoneOptions().map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Weekly off">
              <Select value={form.weekOff === null ? "" : "custom"} onChange={(e) => setForm({ ...form, weekOff: e.target.value ? (form.weekOff ?? DEFAULT_WEEK_OFF) : null })}>
                <option value="">Organization default</option>
                <option value="custom">Different for this location</option>
              </Select>
            </Field>
            {form.weekOff !== null && <WeekOffEditor value={form.weekOff} onChange={(weekOff) => setForm({ ...form, weekOff })} />}
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
              <Button type="submit" disabled={saving || (form.weekOff !== null && !isValidWeekOff(form.weekOff))}>
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
        <Table head={["Location", "Type", "Centre", "Radius", "Weekly off", ""]} minWidth={760}>
          {items.map((l) => (
            <tr key={l.id} className="hover:bg-muted">
              <td className="px-5 py-3 font-semibold text-foreground">{l.name}</td>
              <td className="px-5 py-3">
                <Badge status={l.isOffice ? "OFFICE" : "REMOTE"}>{l.isOffice ? "Office" : "Not an office"}</Badge>
              </td>
              <td className="px-5 py-3 font-mono text-xs text-foreground/80">
                {l.isOffice ? (
                  <a href={mapLink(l.latitude!, l.longitude!, 17)} target="_blank" rel="noreferrer" className="hover:underline">
                    {l.latitude!.toFixed(5)}, {l.longitude!.toFixed(5)}
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-5 py-3 tabular-nums text-foreground/80">{l.isOffice ? `${l.radiusMeters} m` : "—"}</td>
              <td className="px-5 py-3 text-foreground/80">{l.weekOff === null ? <span className="text-muted-foreground">Organization default</span> : describeWeekOff(l.weekOff)}</td>
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
