"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Button, Card, CardTitle, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { PhoneInput } from "@/components/phone-input";
import { formatDate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { maskTail, PROFILE_FIELDS, PROFILE_SECTIONS, SECTION_LABELS, type ProfileField, type ProfileSection, type SectionAccess } from "@/lib/profile-fields";

type Values = Record<string, string | number | null>;
type Profile = { access: SectionAccess; data: Partial<Record<ProfileSection, Values>> };

const humanize = (v: string) => (v === v.toUpperCase() && v.length > 3 ? v.charAt(0) + v.slice(1).toLowerCase().replaceAll("_", " ") : v);

function display(field: ProfileField, value: string | number | null, reveal: boolean) {
  if (value === null || value === "") return <span className="text-muted-foreground">Not added</span>;
  const s = String(value);
  if (field.masked && !reveal) return <span className="font-mono">{maskTail(s)}</span>;
  if (field.kind === "date") return formatDate(s);
  if (field.kind === "phone") return formatPhone(s);
  if (field.kind === "select") return humanize(s);
  if (field.kind === "textarea") return <span className="whitespace-pre-line">{s}</span>;
  if (field.masked || field.key === "bankIfsc") return <span className="font-mono">{s}</span>;
  return s;
}

/**
 * Extended profile (T20/T21): one card per section the API says the viewer can see; an Edit
 * form where it says they can change it. The server enforces both (see
 * src/lib/profile-fields.ts#sectionAccess), this only renders accordingly.
 */
export function ProfileSections({ employeeId }: { employeeId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Profile>(`/api/employees/${employeeId}/profile`)
      .then(setProfile)
      .catch((e) => setError(errorMessage(e)));
  }, [employeeId]);

  if (error) return <div className="lg:col-span-3"><Alert>{error}</Alert></div>;
  if (!profile) return <div className="lg:col-span-3"><Spinner /></div>;

  return (
    <>
      {PROFILE_SECTIONS.filter((s) => profile.data[s]).map((s) => (
        <SectionCard
          key={s}
          employeeId={employeeId}
          section={s}
          values={profile.data[s]!}
          canEdit={profile.access.edit[s]}
          onSaved={(data) => setProfile((p) => (p ? { ...p, data: { ...p.data, ...data } } : p))}
        />
      ))}
    </>
  );
}

function SectionCard({
  employeeId,
  section,
  values,
  canEdit,
  onSaved,
}: {
  employeeId: string;
  section: ProfileSection;
  values: Values;
  canEdit: boolean;
  onSaved: (data: Profile["data"]) => void;
}) {
  const fields = PROFILE_FIELDS.filter((f) => f.section === section);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasMasked = fields.some((f) => f.masked);

  const start = () => {
    setDraft(Object.fromEntries(fields.map((f) => [f.key, values[f.key] === null ? "" : String(values[f.key])])));
    setError(null);
    setEditing(true);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    // Send only what changed; blanks clear the field.
    const patch: Record<string, string | number | null> = {};
    for (const f of fields) {
      const before = values[f.key] === null ? "" : String(values[f.key]);
      const now = draft[f.key] ?? "";
      if (now === before) continue;
      patch[f.key] = now === "" ? null : f.kind === "number" ? Number(now) : now;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      setSaving(false);
      return;
    }
    try {
      const r = await apiFetch<Profile>(`/api/employees/${employeeId}/profile`, { method: "PATCH", body: JSON.stringify(patch) });
      onSaved(r.data);
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const { title, description } = SECTION_LABELS[section];
  return (
    <Card className={section === "personal" || section === "sensitive" ? "lg:col-span-2" : "self-start"}>
      <CardTitle
        action={
          !editing && (
            <div className="flex gap-2">
              {hasMasked && (
                <Button size="sm" variant="ghost" onClick={() => setReveal((r) => !r)}>
                  {reveal ? "Hide numbers" : "Show numbers"}
                </Button>
              )}
              {canEdit && (
                <Button size="sm" variant="secondary" onClick={start}>
                  Edit
                </Button>
              )}
            </div>
          )
        }
      >
        {title}
      </CardTitle>
      <p className="-mt-2 mb-4 text-[13px] text-muted-foreground">{description}</p>

      {editing ? (
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className={f.kind === "textarea" ? "sm:col-span-2" : undefined}>
              <Field label={f.label}>
                {f.kind === "select" ? (
                  <Select value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                    <option value="">Not set</option>
                    {f.options!.map((o) => (
                      <option key={o} value={o}>
                        {humanize(o)}
                      </option>
                    ))}
                  </Select>
                ) : f.kind === "textarea" ? (
                  <Textarea rows={2} maxLength={300} value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
                ) : f.kind === "phone" ? (
                  <PhoneInput value={draft[f.key] ?? ""} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />
                ) : (
                  <Input
                    type={f.kind === "email" ? "email" : f.kind === "date" ? "date" : f.kind === "number" ? "number" : "text"}
                    min={f.kind === "number" ? 0 : undefined}
                    max={f.kind === "number" ? 365 : undefined}
                    autoComplete="off"
                    placeholder={f.placeholder}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  />
                )}
              </Field>
            </div>
          ))}
          {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className={f.kind === "textarea" ? "sm:col-span-2" : undefined}>
              <dt className="text-[13px] text-muted-foreground">{f.label}</dt>
              <dd className="font-medium text-foreground">{display(f, values[f.key], reveal)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
