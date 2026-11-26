"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { PERMISSION_GROUPS, ROLE_PRESETS, SELF_SERVICE, defaultPermissions, type Permission } from "@/lib/permissions";
import { Alert, Avatar, Button, Card, EmptyState, Field, Input, Select, Spinner, Table, Tabs, cx } from "@/components/ui";
import { CheckIcon, PlusIcon, SearchIcon, ShieldIcon } from "@/components/icons";
import { Button as UiButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/confirm-dialog";

type OrgRole = "ADMIN" | "MANAGER" | "EMPLOYEE";
type AccessRole = { id: string; name: string; description: string | null; permissions: Permission[]; memberCount: number };
type Member = {
  id: string;
  empCode: string;
  name: string;
  email: string;
  photoUrl: string | null;
  designation: string | null;
  accessRoleId: string | null;
  hasLogin: boolean;
  orgRole: OrgRole;
};
type Draft = { id: string | null; name: string; description: string; permissions: Set<Permission> };
type Msg = { kind: "error" | "success"; text: string } | null;

const TABS = ["Roles", "Assign roles"] as const;
const ORG_ROLE_LABEL: Record<OrgRole, string> = { ADMIN: "Org admin", MANAGER: "Manager", EMPLOYEE: "Member" };
const TOTAL = PERMISSION_GROUPS.reduce((n, g) => n + g.permissions.length, 0);

const emptyDraft = (): Draft => ({ id: null, name: "", description: "", permissions: new Set() });
const toDraft = (r: AccessRole): Draft => ({ id: r.id, name: r.name, description: r.description ?? "", permissions: new Set(r.permissions) });

export function RolesManager() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Roles");
  const [roles, setRoles] = useState<AccessRole[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ items: AccessRole[]; members: Member[] }>("/api/roles", { cache: "no-store" });
      setRoles(r.items);
      setMembers(r.members);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {!roles ? (
        <Spinner />
      ) : tab === "Roles" ? (
        <RolesTab roles={roles} onChanged={load} />
      ) : (
        <AssignTab roles={roles} members={members} onChanged={load} onCreateRole={() => setTab("Roles")} />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------------- Roles */

function RolesTab({ roles, onChanged }: { roles: AccessRole[]; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(() => (roles[0] ? toDraft(roles[0]) : emptyDraft()));
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const saved = draft.id ? roles.find((r) => r.id === draft.id) : undefined;
  const dirty = useMemo(() => {
    if (!saved) return draft.name.trim() !== "" || draft.permissions.size > 0;
    return (
      saved.name !== draft.name.trim() ||
      (saved.description ?? "") !== draft.description.trim() ||
      saved.permissions.length !== draft.permissions.size ||
      saved.permissions.some((p) => !draft.permissions.has(p))
    );
  }, [saved, draft]);

  async function select(next: Draft) {
    if (dirty && !(await confirm({ title: "Discard unsaved changes?", description: "Your edits to this role haven't been saved.", confirmLabel: "Discard", destructive: true }))) return;
    setMsg(null);
    setDraft(next);
  }

  const toggle = (keys: Permission[], on: boolean) =>
    setDraft((d) => {
      const permissions = new Set(d.permissions);
      for (const k of keys) {
        if (on) permissions.add(k);
        else permissions.delete(k);
      }
      return { ...d, permissions };
    });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const body = JSON.stringify({ name: draft.name.trim(), description: draft.description.trim() || null, permissions: [...draft.permissions] });
    try {
      const role = draft.id
        ? await apiFetch<AccessRole>(`/api/roles/${draft.id}`, { method: "PATCH", body })
        : await apiFetch<AccessRole>("/api/roles", { method: "POST", body });
      await onChanged();
      setDraft(toDraft(role));
      setMsg({
        kind: "success",
        text: draft.id ? "Role saved. Members get the new access on their next page load." : `"${role.name}" created. Assign it from the Assign roles tab.`,
      });
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!saved) return;
    const who = saved.memberCount ? ` ${saved.memberCount} member${saved.memberCount === 1 ? "" : "s"} will fall back to their default access.` : "";
    if (!(await confirm({ title: `Delete "${saved.name}"?`, description: `This can't be undone.${who}`, confirmLabel: "Delete role", destructive: true }))) return;
    setBusy(true);
    try {
      await apiFetch(`/api/roles/${saved.id}`, { method: "DELETE" });
      await onChanged();
      setDraft(emptyDraft());
      setMsg({ kind: "success", text: `"${saved.name}" deleted.` });
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
      {confirmDialog}
      {/* Role list */}
      <div className="flex flex-col gap-2 self-start">
        <Button variant="secondary" onClick={() => select(emptyDraft())} className="justify-start">
          <PlusIcon size={16} />
          New role
        </Button>
        {roles.length === 0 && <p className="px-1 py-3 text-sm text-muted-foreground">No custom roles yet. Name one and start from a preset.</p>}
        <ul className="flex flex-col gap-1">
          {roles.map((r) => {
            const active = r.id === draft.id;
            return (
              <li key={r.id}>
                <button
                  onClick={() => select(toDraft(r))}
                  aria-current={active ? "true" : undefined}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                    active ? "bg-card shadow-xs ring-1 ring-inset ring-border" : "hover:bg-muted",
                  )}
                >
                  <span
                    className={cx(
                      "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
                      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
                    )}
                  >
                    <ShieldIcon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{r.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {r.permissions.length}/{TOTAL} permissions · {r.memberCount} {r.memberCount === 1 ? "member" : "members"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Editor */}
      <form onSubmit={save} className="min-w-0">
        <Card>
          <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
            <Field label="Role name">
              <Input required maxLength={60} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. HR Executive" />
            </Field>
            <Field label="Description (optional)">
              <Input
                maxLength={200}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Who this role is for"
              />
            </Field>
          </div>

          <div className="mt-5">
            <p className="mb-2 text-[13px] font-medium text-foreground/80">Start from a preset</p>
            <div className="flex flex-wrap gap-2">
              {ROLE_PRESETS.map((p) => {
                const matches = p.permissions.length === draft.permissions.size && p.permissions.every((k) => draft.permissions.has(k));
                return (
                  <UiButton
                    key={p.id}
                    type="button"
                    size="sm"
                    variant={matches ? "secondary" : "outline"}
                    title={p.description}
                    aria-pressed={matches}
                    className={cx("rounded-full", matches && "ring-1 ring-primary/30")}
                    onClick={() => setDraft((d) => ({ ...d, permissions: new Set(p.permissions) }))}
                  >
                    {matches && <CheckIcon size={13} />}
                    {p.label}
                  </UiButton>
                );
              })}
            </div>
          </div>
        </Card>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          {PERMISSION_GROUPS.map((g) => {
            const keys: Permission[] = g.permissions.map((p) => p.key);
            const on = keys.filter((k) => draft.permissions.has(k)).length;
            return (
              <Card key={g.id}>
                <label className="mb-3 flex cursor-pointer items-center justify-between gap-3">
                  <span className="text-base font-semibold text-foreground">{g.label}</span>
                  <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    {on}/{keys.length}
                    <Checkbox
                      checked={on === keys.length ? true : on > 0 ? "indeterminate" : false}
                      onCheckedChange={(v) => toggle(keys, v === true)}
                      aria-label={`All ${g.label} permissions`}
                    />
                  </span>
                </label>
                <ul className="divide-y divide-border border-t border-border">
                  {g.permissions.map((p) => (
                    <li key={p.key}>
                      <label className="flex cursor-pointer items-start gap-3 py-3">
                        <Checkbox
                          className="mt-0.5 shrink-0"
                          checked={draft.permissions.has(p.key)}
                          onCheckedChange={(v) => toggle([p.key], v === true)}
                        />
                        <span>
                          <span className="block text-sm font-medium text-foreground">{p.label}</span>
                          <span className="block text-[13px] text-muted-foreground">{p.description}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>

        <div className="mt-5 rounded-xl bg-muted/60 px-5 py-4 text-[13px] text-foreground/80 ring-1 ring-inset ring-border">
          <p className="mb-1.5 font-semibold text-foreground">Always included for every member</p>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {SELF_SERVICE.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <CheckIcon size={13} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-muted-foreground">Creating and assigning roles stays with organization admins.</p>
        </div>

        {msg && (
          <div className="mt-4">
            <Alert kind={msg.kind}>{msg.text}</Alert>
          </div>
        )}

        <div className="sticky bottom-0 mt-5 flex flex-wrap items-center gap-3 border-t border-border bg-background/90 py-4 backdrop-blur">
          <Button type="submit" disabled={busy || !dirty || !draft.name.trim()}>
            {busy ? "Saving…" : draft.id ? "Save changes" : "Create role"}
          </Button>
          {saved && (
            <Button type="button" variant="ghost" disabled={busy} onClick={remove} className="text-rose-600 dark:text-rose-400">
              Delete role
            </Button>
          )}
          <span className="ml-auto text-[13px] text-muted-foreground">
            {draft.permissions.size} of {TOTAL} permissions selected
          </span>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------------------- Assignment */

function AssignTab({
  roles,
  members,
  onChanged,
  onCreateRole,
}: {
  roles: AccessRole[];
  members: Member[];
  onChanged: () => Promise<void>;
  onCreateRole: () => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((m) => [m.name, m.email, m.empCode, m.designation ?? ""].some((v) => v.toLowerCase().includes(needle)));
  }, [members, q]);

  async function assign(m: Member, accessRoleId: string | null) {
    setBusy(m.id);
    setMsg(null);
    try {
      await apiFetch(`/api/employees/${m.id}/access-role`, { method: "PUT", body: JSON.stringify({ accessRoleId }) });
      await onChanged();
      const label = accessRoleId ? `the ${roles.find((r) => r.id === accessRoleId)?.name} role` : "default access";
      setMsg({ kind: "success", text: `${m.name} now has ${label}.` });
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  if (roles.length === 0) {
    return (
      <EmptyState hint="Create a role first, then assign it to people here.">
        <UiButton variant="link" onClick={onCreateRole} className="h-auto p-0 text-base">
          No roles to assign yet
        </UiButton>
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="relative w-full max-w-sm">
          <SearchIcon size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-10" aria-label="Search people" />
        </div>
        <p className="text-[13px] text-muted-foreground">&ldquo;Default&rdquo; follows the person&rsquo;s organization role. Org admins always have full access.</p>
      </div>
      {msg && (
        <div className="mb-4">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}
      <Table head={["Person", "Org role", "Access role", "Permissions"]} minWidth={720}>
        {filtered.map((m) => {
          const role = roles.find((r) => r.id === m.accessRoleId);
          const count = m.orgRole === "ADMIN" ? TOTAL : role ? role.permissions.length : defaultPermissions(m.orgRole).length;
          return (
            <tr key={m.id}>
              <td className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={m.name} photoUrl={m.photoUrl} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{m.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.designation ?? m.email}</p>
                  </div>
                </div>
              </td>
              <td className="px-5 py-3 text-foreground/80">{m.hasLogin ? ORG_ROLE_LABEL[m.orgRole] : <span className="text-muted-foreground">Not joined</span>}</td>
              <td className="px-5 py-3">
                {m.orgRole === "ADMIN" ? (
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-foreground">
                    <ShieldIcon size={14} />
                    Full access
                  </span>
                ) : (
                  <Select
                    aria-label={`Access role for ${m.name}`}
                    value={m.accessRoleId ?? ""}
                    disabled={busy === m.id}
                    onChange={(e) => assign(m, e.target.value || null)}
                    className="h-9 max-w-[15rem]"
                  >
                    <option value="">Default ({ORG_ROLE_LABEL[m.orgRole]})</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                )}
              </td>
              <td className="px-5 py-3 tabular-nums text-muted-foreground">
                {count}/{TOTAL}
              </td>
            </tr>
          );
        })}
      </Table>
      {filtered.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No one matches &ldquo;{q}&rdquo;.</p>}
    </div>
  );
}
