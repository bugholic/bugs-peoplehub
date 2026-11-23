"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Button, Card, CardTitle, EmptyState, Input } from "@/components/ui";

type Item = { id: string; name: string };

/** Add / remove named records (departments, designations) for the active organization. */
export function NameList({ title, endpoint }: { title: string; endpoint: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => apiFetch<{ items: Item[] }>(endpoint).then((r) => setItems(r.items)).catch((e) => setError(errorMessage(e))),
    [endpoint],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch(endpoint, { method: "POST", body: JSON.stringify({ name }) });
      setName("");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiFetch(`${endpoint}/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <form onSubmit={add} className="mb-4 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`New ${title.toLowerCase().replace(/s$/, "")}`} required maxLength={80} />
        <Button type="submit" disabled={busy}>
          Add
        </Button>
      </form>
      {error && <Alert>{error}</Alert>}
      {items && items.length === 0 && <EmptyState>Nothing here yet.</EmptyState>}
      <ul className="divide-y divide-line">
        {items?.map((i) => (
          <li key={i.id} className="flex items-center justify-between py-2.5 text-sm">
            <span>{i.name}</span>
            <button onClick={() => remove(i.id)} className="text-xs font-medium text-ink-3 hover:text-red-600">
              Remove
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
