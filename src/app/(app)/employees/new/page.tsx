"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, Input, PageHeader, Select } from "@/components/ui";

type Lookups = {
  departments: { id: string; name: string }[];
  designations: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  managers: { id: string; name: string; empCode: string }[];
};

export default function NewEmployeePage() {
  const router = useRouter();
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    empCode: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    joinDate: new Date().toISOString().slice(0, 10),
    departmentId: "",
    designationId: "",
    locationId: "",
    reportingManagerId: "",
    role: "EMPLOYEE" as "ADMIN" | "MANAGER" | "EMPLOYEE",
    password: "",
  });

  useEffect(() => {
    apiFetch<Lookups>("/api/lookups").then(setLookups).catch((err) => setError(errorMessage(err)));
  }, []);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const employee = await apiFetch<{ id: string }>("/api/employees", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          phone: form.phone || null,
          departmentId: form.departmentId || null,
          designationId: form.designationId || null,
          locationId: form.locationId || null,
          reportingManagerId: form.reportingManagerId || null,
          password: form.password || undefined,
        }),
      });
      router.replace(`/employees/${employee.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Add employee" />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <form onSubmit={onSubmit} className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label="Employee code">
          <Input required value={form.empCode} onChange={(e) => set("empCode", e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="First name">
          <Input required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </Field>
        <Field label="Last name">
          <Input required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Join date">
          <Input type="date" required value={form.joinDate} onChange={(e) => set("joinDate", e.target.value)} />
        </Field>
        <Field label="Department">
          <Select value={form.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
            <option value="">—</option>
            {lookups?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Designation">
          <Select value={form.designationId} onChange={(e) => set("designationId", e.target.value)}>
            <option value="">—</option>
            {lookups?.designations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Location">
          <Select value={form.locationId} onChange={(e) => set("locationId", e.target.value)}>
            <option value="">—</option>
            {lookups?.locations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reporting manager">
          <Select value={form.reportingManagerId} onChange={(e) => set("reportingManagerId", e.target.value)}>
            <option value="">—</option>
            {lookups?.managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.empCode})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="System role">
          <Select value={form.role} onChange={(e) => set("role", e.target.value as typeof form.role)}>
            <option value="EMPLOYEE">Employee</option>
            <option value="MANAGER">Manager</option>
            <option value="ADMIN">Admin</option>
          </Select>
        </Field>
        <Field label="Password (optional — creates a login)">
          <Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} minLength={8} />
        </Field>

        <div className="sm:col-span-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Creating…" : "Create employee"}
          </Button>
        </div>
      </form>
    </div>
  );
}
