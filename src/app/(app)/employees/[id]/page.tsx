"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Avatar, Badge, Button, Card, CardTitle, Field, Input, Spinner } from "@/components/ui";
import { BriefcaseIcon, CalendarIcon, ChevronLeftIcon, MailIcon, PhoneIcon, PinIcon, UsersIcon } from "@/components/icons";
import { formatDate } from "@/lib/dates";

type Lookup = { id: string; name: string };
type Employee = {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  joinDate: string;
  status: "ACTIVE" | "INACTIVE";
  department: Lookup | null;
  designation: Lookup | null;
  location: Lookup | null;
  reportingManager: { id: string; firstName: string; lastName: string } | null;
  user: { role: string } | null;
};

const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", MANAGER: "Manager", EMPLOYEE: "Employee" };

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [me, setMe] = useState<{ employeeId: string; role: string } | null>(null);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [emp, meRes] = await Promise.all([
        apiFetch<Employee>(`/api/employees/${id}`),
        apiFetch<{ session: { employeeId: string; role: string } }>("/api/me"),
      ]);
      setEmployee(emp);
      setPhone(emp.phone ?? "");
      setMe(meRes.session);
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

  const isAdmin = me?.role === "ADMIN";
  const isSelf = me?.employeeId === id;

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
    if (!confirm("Deactivate this employee? They will no longer be able to sign in.")) return;
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
      <Link href="/employees" className="mb-5 inline-flex items-center gap-1 text-sm font-medium text-ink-3 hover:text-ink">
        <ChevronLeftIcon size={16} />
        All employees
      </Link>

      {/* Profile header */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <div className="relative h-28 bg-night">
          <div aria-hidden className="absolute -right-10 -top-16 size-56 rounded-full bg-brand/45 blur-3xl" />
          <div aria-hidden className="absolute left-1/3 top-6 size-24 rounded-full bg-marigold/25 blur-2xl" />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4 px-6 pb-6">
          <div className="-mt-10 flex items-end gap-4">
            <Avatar name={fullName} size="xl" className="ring-4 ring-surface" />
            <div className="pb-1">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{fullName}</h1>
              <p className="text-ink-2">
                {employee.designation?.name ?? "No designation"}
                {employee.department && <span className="text-ink-3"> in {employee.department.name}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge status={employee.status} />
            {isAdmin && employee.status === "ACTIVE" && (
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
            <Detail icon={<MailIcon size={17} />} label="Email" value={<a href={`mailto:${employee.email}`} className="hover:text-brand-ink">{employee.email}</a>} />
            <Detail icon={<PhoneIcon size={17} />} label="Phone" value={employee.phone ?? "Not added"} />
            <Detail icon={<PinIcon size={17} />} label="Location" value={employee.location?.name ?? "—"} />
            <Detail
              icon={<UsersIcon size={17} />}
              label="Reports to"
              value={
                employee.reportingManager ? (
                  <Link href={`/employees/${employee.reportingManager.id}`} className="hover:text-brand-ink">
                    {employee.reportingManager.firstName} {employee.reportingManager.lastName}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <Detail icon={<CalendarIcon size={17} />} label="Joined" value={formatDate(employee.joinDate)} />
            <Detail icon={<BriefcaseIcon size={17} />} label="System role" value={employee.user ? ROLE_LABEL[employee.user.role] ?? employee.user.role : "No login"} />
          </dl>
        </Card>

        {(isAdmin || isSelf) && (
          <Card className="self-start">
            <CardTitle>Contact</CardTitle>
            <Field label="Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
            </Field>
            <Button className="mt-4 w-full" disabled={saving} onClick={savePhone}>
              {saving ? "Saving…" : "Save phone"}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}

function Detail({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-3 ring-1 ring-inset ring-line">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[13px] text-ink-3">{label}</dt>
        <dd className="truncate font-medium text-ink">{value}</dd>
      </div>
    </div>
  );
}
