"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Card, PageHeader, Spinner } from "@/components/ui";

type Node = { id: string; name: string; title: string | null; managerId: string | null };
type Tree = Node & { children: Tree[] };

function buildTree(nodes: Node[]): Tree[] {
  const byId = new Map<string, Tree>(nodes.map((n) => [n.id, { ...n, children: [] }]));
  const roots: Tree[] = [];
  for (const node of byId.values()) {
    if (node.managerId && byId.has(node.managerId)) {
      byId.get(node.managerId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function Branch({ node }: { node: Tree }) {
  return (
    <li>
      <Link href={`/employees/${node.id}`} className="inline-flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">{node.name}</span>
        {node.title && <span className="text-xs text-zinc-400">· {node.title}</span>}
      </Link>
      {node.children.length > 0 && (
        <ul className="ml-5 mt-1 space-y-1 border-l border-zinc-200 pl-4 dark:border-zinc-800">
          {node.children.map((c) => (
            <Branch key={c.id} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChartPage() {
  const [tree, setTree] = useState<Tree[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ nodes: Node[] }>("/api/org-chart")
      .then((res) => setTree(buildTree(res.nodes)))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <div>
      <PageHeader title="Org chart" />
      {error && <Alert>{error}</Alert>}
      {!tree ? (
        <Spinner />
      ) : (
        <Card>
          <ul className="space-y-1">
            {tree.map((n) => (
              <Branch key={n.id} node={n} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
