"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Button, Card, CardTitle, Field, Input, PageHeader, Select } from "@/components/ui";
import { PhoneInput } from "@/components/phone-input";

type Lookups = {
  departments: { id: string; name: string }[];
  designations: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  shifts: { id: string; name: string; startTime: string; endTime: string; isDefault: boolean }[];
  managers: { id: string; name: string; empCode: string }[];
};

export default function NewEmployeePage() {
  const router = useRouter();
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    joinDate: new Date().toISOString().slice(0, 10),
    departmentId: "",
    designationId: "",
    locationId: "",
    shiftId: "",
    reportingManagerId: "",
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
          shiftId: form.shiftId || null,
          reportingManagerId: form.reportingManagerId || null,
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
      <PageHeader title="Add employee" description="Create a directory profile. When they join your organization with this email, they are linked to it automatically." />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <form onSubmit={onSubmit} className="max-w-3xl space-y-5">
        <Card>
        <CardTitle>Personal details</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
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
          <PhoneInput value={form.phone} onChange={(v) => set("phone", v)} />
        </Field>
        <Field label="Join date">
          <Input type="date" required value={form.joinDate} onChange={(e) => set("joinDate", e.target.value)} />
        </Field>
        </div>
        </Card>
        <Card>
        <CardTitle>Role and access</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
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
        {!!lookups?.shifts.length && (
          <Field label="Shift">
            <Select value={form.shiftId} onChange={(e) => set("shiftId", e.target.value)}>
              <option value="">Default ({lookups.shifts.find((s) => s.isDefault)?.name ?? "none"})</option>
              {lookups.shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.startTime}–{s.endTime}
                </option>
              ))}
            </Select>
          </Field>
        )}
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

        </div>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? "Creating…" : "Create employee"}
          </Button>
        </div>
      </form>
    </div>
  );
}
