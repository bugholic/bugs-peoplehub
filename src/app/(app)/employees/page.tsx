"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Avatar, Badge, Button, EmptyState, Input, PageHeader, Spinner, Table } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/icons";

type Employee = {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
  department: { name: string } | null;
  designation: { name: string } | null;
};

export default function EmployeesPage() {
  const [items, setItems] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ session: { role: string } }>("/api/me")
      .then((me) => setIsAdmin(me.session.role === "ADMIN"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      setLoading(true);
      apiFetch<{ items: Employee[]; total: number }>(`/api/employees?q=${encodeURIComponent(q)}&pageSize=50`)
        .then((res) => {
          setItems(res.items);
          setTotal(res.total);
        })
        .catch((err) => setError(errorMessage(err)))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  return (
    <div>
      <PageHeader
        title="Employees"
        description={`${total} active ${total === 1 ? "person" : "people"} in the directory`}
        actions={
          isAdmin && (
            <Link href="/employees/new">
              <Button>
                <PlusIcon size={16} />
                Add employee
              </Button>
            </Link>
          )
        }
      />

      <div className="relative mb-5 max-w-md">
        <SearchIcon size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <Input placeholder="Search by name, code or email" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-10" aria-label="Search employees" />
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState hint="Try a different name, employee code or email.">No one matches “{q}”</EmptyState>
      ) : (
        <Table head={["Name", "Code", "Department", "Designation", "Status"]} minWidth={720}>
          {items.map((e) => (
            <tr key={e.id} className="group transition-colors hover:bg-surface-2">
              <td className="px-5 py-3.5">
                <Link href={`/employees/${e.id}`} className="flex items-center gap-3">
                  <Avatar name={`${e.firstName} ${e.lastName}`} size="sm" />
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink group-hover:text-brand-ink">
                      {e.firstName} {e.lastName}
                    </span>
                    <span className="block truncate text-[13px] text-ink-3">{e.email}</span>
                  </span>
                </Link>
              </td>
              <td className="px-5 py-3.5 font-mono text-[13px] text-ink-2">{e.empCode}</td>
              <td className="px-5 py-3.5 text-ink-2">{e.department?.name ?? "—"}</td>
              <td className="px-5 py-3.5 text-ink-2">{e.designation?.name ?? "—"}</td>
              <td className="px-5 py-3.5">
                <Badge status={e.status} />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
