"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { apiFetch, errorMessage, invalidateApiCache } from "@/lib/api-client";
import { Alert, Avatar, Badge, Button, Card, CardTitle, Field, Select, Spinner } from "@/components/ui";
import { BriefcaseIcon, CalendarIcon, ClockIcon, ChevronLeftIcon, MailIcon, PhoneIcon, PinIcon, UsersIcon } from "@/components/icons";
import { formatDate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { PhoneInput } from "@/components/phone-input";
import { LeaveBalancesCard } from "./leave-balances";
import { ProfileSections } from "./profile-sections";
import { useConfirm } from "@/components/confirm-dialog";

type Lookup = { id: string; name: string };
type Employee = {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  photoUrl: string | null;
  joinDate: string;
  status: "ACTIVE" | "INACTIVE";
  department: Lookup | null;
  designation: Lookup | null;
  location: Lookup | null;
  shift: { id: string; name: string; startTime: string; endTime: string } | null;
  reportingManager: { id: string; firstName: string; lastName: string } | null;
  hasLogin: boolean;
};


export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [me, setMe] = useState<{ employeeId: string; permissions: string[] } | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [emp, meRes] = await Promise.all([
        apiFetch<Employee>(`/api/employees/${id}`),
        apiFetch<{ session: { employeeId: string; permissions: string[] }; organization: { bannerUrl: string | null } }>("/api/me"),
      ]);
      setEmployee(emp);
      setPhone(emp.phone ?? "");
      setMe(meRes.session);
      setBannerUrl(meRes.organization.bannerUrl);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canEdit = me?.permissions.includes("employees.edit") ?? false;
  const canDeactivate = me?.permissions.includes("employees.deactivate") ?? false;
  const isSelf = me?.employeeId === id;
  const perms = me?.permissions ?? [];
  const canAdjustLeave = perms.includes("leave.adjust_balances");
  // Mirrors the API's rule (src/app/api/leave/balances/route.ts): self, org-wide leave rights, or the direct manager.
  const canViewLeave =
    isSelf ||
    canAdjustLeave ||
    perms.includes("leave.approve_all") ||
    (perms.includes("leave.approve_team") && employee?.reportingManager?.id === me?.employeeId);

  const fileRef = useRef<HTMLInputElement>(null);
  const [confirm, confirmDialog] = useConfirm();

  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const body = new FormData();
      body.append("file", file);
      // Plain fetch: apiFetch forces a JSON Content-Type, which breaks the multipart boundary.
      const res = await fetch(`/api/employees/${id}/photo`, { method: "PUT", body });
      invalidateApiCache(); // bypasses apiFetch, so drop the GET cache by hand
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? `Upload failed (${res.status})`);
      setEmployee((e) => (e ? { ...e, photoUrl: json.photoUrl } : e));
      setSuccess("Photo updated.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/employees/${id}/photo`, { method: "DELETE" });
      setEmployee((e) => (e ? { ...e, photoUrl: null } : e));
      setSuccess("Photo removed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const [shifts, setShifts] = useState<{ id: string; name: string; startTime: string; endTime: string; isDefault: boolean }[] | null>(null);
  useEffect(() => {
    if (!canEdit) return;
    apiFetch<{ shifts: NonNullable<typeof shifts> }>("/api/lookups").then((r) => setShifts(r.shifts)).catch(() => {});
  }, [canEdit]);
  const defaultShift = shifts?.find((s) => s.isDefault);

  async function saveShift(shiftId: string) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await apiFetch<Employee>(`/api/employees/${id}`, { method: "PATCH", body: JSON.stringify({ shiftId: shiftId || null }) });
      setEmployee((e) => (e ? { ...e, shift: updated.shift } : e));
      setSuccess("Shift updated. It applies from the next check-in.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function savePhone() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/employees/${id}`, { method: "PATCH", body: JSON.stringify({ phone: phone || null }) });
      setSuccess("Phone number saved.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!(await confirm({ title: `Deactivate ${employee?.firstName ?? "this employee"}?`, description: "They will no longer be able to sign in. Their records are kept.", confirmLabel: "Deactivate", destructive: true }))) return;
    setSaving(true);
    try {
      await apiFetch(`/api/employees/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  if (!employee) return <Alert>{error ?? "This employee could not be found."}</Alert>;

  const fullName = `${employee.firstName} ${employee.lastName}`;

  return (
    <div>
      {confirmDialog}
      <Link href="/employees" className="mb-5 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon size={16} />
        All employees
      </Link>

      {/* Profile header */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
        <div className="relative h-28 overflow-hidden bg-night sm:h-36">
          {bannerUrl ? (
            // Served by our auth-checked API route (private bucket), so next/image's optimizer can't fetch it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bannerUrl} alt="" className="size-full object-cover" />
          ) : (
            <>
              <div aria-hidden className="absolute -right-10 -top-16 size-56 rounded-full bg-primary/45 blur-3xl" />
              <div aria-hidden className="absolute left-1/3 top-6 size-24 rounded-full bg-marigold/25 blur-2xl" />
            </>
          )}
        </div>
        {/* relative: paints above the positioned banner; only the avatar overlaps it, the text stays below on bg-card */}
        <div className="relative flex flex-wrap items-end justify-between gap-4 px-6 pb-6">
          <div className="flex items-start gap-4">
            <Avatar name={fullName} size="xl" className="-mt-10 ring-4 ring-card" photoUrl={employee.photoUrl} />
            <div className="pt-3">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{fullName}</h1>
              <p className="text-foreground/80">
                {employee.designation?.name ?? "No designation"}
                {employee.department && <span className="text-muted-foreground"> in {employee.department.name}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {(canEdit || isSelf) && (
              <>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => uploadPhoto(e.target.files?.[0])} />
                <Button variant="secondary" size="sm" disabled={saving} onClick={() => fileRef.current?.click()}>
                  {employee.photoUrl ? "Change photo" : "Add photo"}
                </Button>
                {employee.photoUrl && (
                  <Button variant="secondary" size="sm" disabled={saving} onClick={removePhoto}>
                    Remove
                  </Button>
                )}
              </>
            )}
            <Badge status={employee.status} />
            {canDeactivate && employee.status === "ACTIVE" && (
              <Button variant="secondary" size="sm" disabled={saving} onClick={deactivate} className="text-rose-600 dark:text-rose-400">
                Deactivate
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {success && <div className="mb-4"><Alert kind="success">{success}</Alert></div>}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Details</CardTitle>
          <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <Detail icon={<BriefcaseIcon size={17} />} label="Employee code" value={<span className="font-mono">{employee.empCode}</span>} />
            <Detail icon={<MailIcon size={17} />} label="Email" value={<a href={`mailto:${employee.email}`} className="hover:text-accent-foreground">{employee.email}</a>} />
            <Detail icon={<PhoneIcon size={17} />} label="Phone" value={employee.phone ? <a href={`tel:${employee.phone}`} className="hover:text-accent-foreground">{formatPhone(employee.phone)}</a> : "Not added"} />
            <Detail icon={<PinIcon size={17} />} label="Location" value={employee.location?.name ?? "—"} />
            <Detail
              icon={<ClockIcon size={17} />}
              label="Shift"
              value={
                canEdit && shifts?.length ? (
                  <Select
                    aria-label="Shift"
                    disabled={saving}
                    value={employee.shift?.id ?? ""}
                    onChange={(e) => saveShift(e.target.value)}
                    className="mt-1 h-9 max-w-64"
                  >
                    <option value="">{defaultShift ? `Default (${defaultShift.name})` : "No shift"}</option>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.startTime}–{s.endTime}
                      </option>
                    ))}
                  </Select>
                ) : employee.shift ? (
                  `${employee.shift.name} · ${employee.shift.startTime}–${employee.shift.endTime}`
                ) : (
                  "Default"
                )
              }
            />
            <Detail
              icon={<UsersIcon size={17} />}
              label="Reports to"
              value={
                employee.reportingManager ? (
                  <Link href={`/employees/${employee.reportingManager.id}`} className="hover:text-accent-foreground">
                    {employee.reportingManager.firstName} {employee.reportingManager.lastName}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <Detail icon={<CalendarIcon size={17} />} label="Joined" value={formatDate(employee.joinDate)} />
            <Detail icon={<BriefcaseIcon size={17} />} label="Account" value={employee.hasLogin ? "Joined" : "Not joined yet"} />
          </dl>
        </Card>

        {(canEdit || isSelf) && (
          <Card className="self-start">
            <CardTitle>Contact</CardTitle>
            <Field label="Phone">
              <PhoneInput key={employee.phone ?? ""} value={phone} onChange={setPhone} />
            </Field>
            <Button className="mt-4 w-full" disabled={saving} onClick={savePhone}>
              {saving ? "Saving…" : "Save phone"}
            </Button>
          </Card>
        )}

        <ProfileSections employeeId={employee.id} />

        {canViewLeave && <LeaveBalancesCard employeeId={employee.id} canAdjust={canAdjustLeave && !isSelf} />}
      </div>
    </div>
  );
}

function Detail({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-inset ring-border">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[13px] text-muted-foreground">{label}</dt>
        <dd className="truncate font-medium text-foreground">{value}</dd>
      </div>
    </div>
  );
}
