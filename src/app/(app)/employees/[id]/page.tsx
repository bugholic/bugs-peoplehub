"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Spinner } from "@/components/ui";
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
      setSuccess("Saved.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!confirm("Deactivate this employee?")) return;
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
  if (!employee) return <Alert>{error ?? "Not found"}</Alert>;

  return (
    <div>
      <PageHeader
        title={`${employee.firstName} ${employee.lastName}`}
        description={`${employee.designation?.name ?? "—"} · ${employee.department?.name ?? "—"}`}
        actions={
          isAdmin && (
            <Button variant="danger" disabled={saving || employee.status === "INACTIVE"} onClick={deactivate}>
              {employee.status === "INACTIVE" ? "Inactive" : "Deactivate"}
            </Button>
          )
        }
      />

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {success && <div className="mb-4"><Alert kind="success">{success}</Alert></div>}

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Profile</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Employee code" value={employee.empCode} />
            <Row label="Email" value={employee.email} />
            <Row label="Location" value={employee.location?.name ?? "—"} />
            <Row label="Reporting manager" value={employee.reportingManager ? `${employee.reportingManager.firstName} ${employee.reportingManager.lastName}` : "—"} />
            <Row label="Joined" value={formatDate(employee.joinDate)} />
            <Row label="Role" value={employee.user?.role ?? "No login"} />
            <div className="flex justify-between">
              <dt className="text-zinc-500 dark:text-zinc-400">Status</dt>
              <dd>
                <Badge status={employee.status} />
              </dd>
            </div>
          </dl>
        </Card>

        {(isAdmin || isSelf) && (
          <Card>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Contact</h2>
            <div className="mt-3">
              <Field label="Phone">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 ..." />
              </Field>
              <Button className="mt-3" disabled={saving} onClick={savePhone}>
                Save
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-right font-medium text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}
