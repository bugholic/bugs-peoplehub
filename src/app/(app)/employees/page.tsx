"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Badge, Button, Card, Input, PageHeader, Spinner } from "@/components/ui";

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
        description={`${total} active`}
        actions={
          isAdmin && (
            <Link href="/employees/new">
              <Button>Add employee</Button>
            </Link>
          )
        }
      />

      <Input placeholder="Search by name, code or email…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 max-w-sm" />

      {error && <Alert>{error}</Alert>}
      {loading ? (
        <Spinner />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Designation</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                  <td className="px-4 py-3">
                    <Link href={`/employees/${e.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                      {e.firstName} {e.lastName}
                    </Link>
                    <p className="text-xs text-zinc-400">{e.email}</p>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{e.empCode}</td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{e.department?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{e.designation?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge status={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
