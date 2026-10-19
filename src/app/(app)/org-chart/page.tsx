"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Avatar, Card, PageHeader, Spinner, cx } from "@/components/ui";
import { ChevronLeftIcon } from "@/components/icons";

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

function countDescendants(node: Tree): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

function Branch({ node, depth }: { node: Tree; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <li className="relative">
      {depth > 0 && <span aria-hidden className="absolute -left-6 top-7 h-px w-6 bg-line" />}
      <div
        className={cx(
          "flex items-center gap-3 rounded-2xl border bg-surface p-3 pr-4 shadow-card transition-colors",
          depth === 0 ? "border-brand/30" : "border-line",
        )}
      >
        <Avatar name={node.name} size={depth === 0 ? "lg" : "md"} />
        <Link href={`/employees/${node.id}`} className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink hover:text-brand-ink">{node.name}</span>
          <span className="block truncate text-[13px] text-ink-3">{node.title ?? "No designation"}</span>
        </Link>
        {hasChildren && (
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? `Collapse ${node.name}'s team` : `Expand ${node.name}'s team`}
            className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2 ring-1 ring-inset ring-line hover:text-ink"
          >
            {countDescendants(node)}
            <ChevronLeftIcon size={14} className={cx("transition-transform", open ? "rotate-90" : "-rotate-90")} />
          </button>
        )}
      </div>
      {hasChildren && open && (
        <ul className="relative ml-8 mt-3 space-y-3 border-l border-line pl-6">
          {node.children.map((c) => (
            <Branch key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChartPage() {
  const [tree, setTree] = useState<Tree[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ nodes: Node[] }>("/api/org-chart")
      .then((res) => {
        setTree(buildTree(res.nodes));
        setTotal(res.nodes.length);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <div>
      <PageHeader title="Org chart" description={tree ? `Who reports to whom, across ${total} people` : undefined} />
      {error && <Alert>{error}</Alert>}
      {!tree ? (
        !error && <Spinner />
      ) : (
        <Card className="bg-surface-2">
          <ul className="max-w-3xl space-y-3">
            {tree.map((n) => (
              <Branch key={n.id} node={n} depth={0} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
