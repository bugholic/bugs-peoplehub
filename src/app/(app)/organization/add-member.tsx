"use client";

import { useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Button, Card, CardTitle, Field, Input, Select } from "@/components/ui";

/** Add someone who already has an account to this organization, without an email invitation. */
export function AddMember({ canAddAdmin }: { canAddAdmin: boolean }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EMPLOYEE");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await apiFetch("/api/organization/members", { method: "POST", body: JSON.stringify({ email, role }) });
      setMsg({ kind: "success", text: `${email} was added. They'll appear in Members below.` });
      setEmail("");
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 max-w-3xl">
      <CardTitle>Add an existing user</CardTitle>
      <p className="mb-4 text-sm text-ink-2">
        For people who have already signed up. No email is sent; they can open the app right away.
      </p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
        <Field label="Email">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@company.com" />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="EMPLOYEE">Employee</option>
            <option value="MANAGER">Manager</option>
            {canAddAdmin && <option value="ADMIN">Admin</option>}
          </Select>
        </Field>
        <Button type="submit" disabled={busy} className="h-11">
          {busy ? "Adding…" : "Add"}
        </Button>
      </form>
      {msg && (
        <div className="mt-4">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}
    </Card>
  );
}
