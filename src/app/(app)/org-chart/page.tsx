"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import Link from "next/link";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Avatar, Button, PageHeader, Spinner, cx } from "@/components/ui";
import { ChevronLeftIcon, FocusIcon, MinusIcon, PlusIcon } from "@/components/icons";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";

type Node = { id: string; name: string; title: string | null; photoUrl: string | null; managerId: string | null };
type Tree = Node & { children: Tree[]; size: number };

/** Links people to their managers. Anyone whose manager isn't in the list (or who has none) becomes a root. */
function buildTree(nodes: Node[]): Tree[] {
  const byId = new Map<string, Tree>(nodes.map((n) => [n.id, { ...n, children: [], size: 0 }]));
  const roots: Tree[] = [];
  for (const node of byId.values()) {
    const manager = node.managerId ? byId.get(node.managerId) : undefined;
    if (manager) manager.children.push(node);
    else roots.push(node);
  }
  const measure = (t: Tree): number => (t.size = t.children.reduce((n, c) => n + 1 + measure(c), 0));
  roots.forEach(measure);
  return roots;
}

/** Ids of every node that has reports, plus the chain of managers above `targetId`. */
function walk(roots: Tree[], targetId: string | undefined) {
  const parents: string[] = [];
  const managersAbove: string[] = [];
  const depthOf = new Map<string, number>();
  const visit = (t: Tree, depth: number, trail: string[]) => {
    depthOf.set(t.id, depth);
    if (t.children.length) parents.push(t.id);
    if (t.id === targetId) managersAbove.push(...trail);
    t.children.forEach((c) => visit(c, depth + 1, [...trail, t.id]));
  };
  roots.forEach((r) => visit(r, 0, []));
  return { parents, managersAbove, depthOf };
}

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.15];

export default function OrgChartPage() {
  const [tree, setTree] = useState<Tree[] | null>(null);
  const [total, setTotal] = useState(0);
  const [meId, setMeId] = useState<string | undefined>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(3); // index into ZOOM_STEPS (100%)
  const [error, setError] = useState<string | null>(null);

  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  useEffect(() => {
    Promise.all([apiFetch<{ nodes: Node[] }>("/api/org-chart"), apiFetch<{ session: { employeeId: string } }>("/api/me")])
      .then(([chart, me]) => {
        const roots = buildTree(chart.nodes);
        const { parents, managersAbove, depthOf } = walk(roots, me.session.employeeId);
        // Open the top two levels and the path down to the viewer; fold the rest so wide orgs stay readable.
        const keepOpen = new Set(managersAbove);
        setCollapsed(new Set(parents.filter((id) => (depthOf.get(id) ?? 0) >= 2 && !keepOpen.has(id))));
        setMeId(me.session.employeeId);
        setTree(roots);
        setTotal(chart.nodes.length);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const allParents = useMemo(() => (tree ? walk(tree, undefined).parents : []), [tree]);

  const toggle = useCallback(
    (id: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  /** Scrolls the viewport (not the page) so the viewer's card is centred. */
  const focusMe = useCallback((smooth = true) => {
    const el = viewport.current;
    const card = el?.querySelector<HTMLElement>("[data-me]");
    if (!el || !card) return;
    const v = el.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    el.scrollTo({
      left: el.scrollLeft + c.left - v.left - (v.width - c.width) / 2,
      top: el.scrollTop + c.top - v.top - (v.height - c.height) / 2,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  // First paint: centre on the viewer (or on the top of the chart if they're not in it).
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!tree || !el) return;
    if (el.querySelector("[data-me]")) focusMe(false);
    else el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [tree, focusMe]);

  // Drag empty space to pan; clicks on cards, links and buttons behave normally.
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const el = viewport.current;
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest("a, button")) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const el = viewport.current;
    if (!el || !drag.current) return;
    el.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  }
  const endDrag = () => (drag.current = null);

  return (
    <div>
      <PageHeader title="Org chart" description={tree ? `Who reports to whom, across ${total} people` : undefined} />
      {error && <Alert>{error}</Alert>}
      {!tree ? (
        !error && <Spinner />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-muted/40 shadow-xs">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2.5">
            <ButtonGroup aria-label="Zoom">
              <Button variant="secondary" size="icon-sm" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} aria-label="Zoom out">
                <MinusIcon />
              </Button>
              <ButtonGroupText className="w-14 justify-center text-xs tabular-nums">{Math.round(ZOOM_STEPS[zoom] * 100)}%</ButtonGroupText>
              <Button variant="secondary" size="icon-sm" onClick={() => setZoom((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))} disabled={zoom === ZOOM_STEPS.length - 1} aria-label="Zoom in">
                <PlusIcon />
              </Button>
            </ButtonGroup>
            <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set())}>
              Expand all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set(allParents))}>
              Collapse all
            </Button>
            {meId && (
              <Button variant="ghost" size="sm" onClick={() => focusMe()} className="ml-auto">
                <FocusIcon size={15} />
                Find me
              </Button>
            )}
          </div>

          <div
            ref={viewport}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="h-[calc(100vh-17rem)] min-h-[26rem] cursor-grab overflow-auto select-none active:cursor-grabbing"
            style={{
              backgroundImage: "radial-gradient(color-mix(in srgb, var(--muted-foreground) 22%, transparent) 1px, transparent 1px)",
              backgroundSize: "18px 18px",
            }}
          >
            {/* `zoom` (unlike transform: scale) also shrinks the scrollable area, so panning stays accurate. */}
            <div className="org-tree mx-auto w-max p-10" style={{ zoom: ZOOM_STEPS[zoom] }}>
              <ul>
                {tree.map((n) => (
                  <Branch key={n.id} node={n} collapsed={collapsed} onToggle={toggle} meId={meId} root />
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Branch({
  node,
  collapsed,
  onToggle,
  meId,
  root = false,
}: {
  node: Tree;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  meId?: string;
  root?: boolean;
}) {
  const open = node.children.length > 0 && !collapsed.has(node.id);
  return (
    <li>
      <NodeCard node={node} open={open} onToggle={onToggle} isMe={node.id === meId} root={root} />
      {open && (
        <ul>
          {node.children.map((c) => (
            <Branch key={c.id} node={c} collapsed={collapsed} onToggle={onToggle} meId={meId} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NodeCard({ node, open, onToggle, isMe, root }: { node: Tree; open: boolean; onToggle: (id: string) => void; isMe: boolean; root: boolean }) {
  const reports = node.children.length;
  return (
    <div className="relative flex flex-col items-center">
      <div
        data-me={isMe || undefined}
        className={cx(
          "relative w-52 overflow-hidden rounded-2xl border bg-card px-4 pb-4 pt-5 text-center shadow-xs transition-shadow hover:shadow-md",
          isMe ? "border-primary ring-4 ring-primary/15" : root ? "border-primary/30" : "border-border",
        )}
      >
        <span aria-hidden className={cx("absolute inset-x-0 top-0 h-1", isMe || root ? "bg-primary" : "bg-border")} />
        <Avatar name={node.name} size={root ? "lg" : "md"} photoUrl={node.photoUrl} className="mx-auto" />
        <Link href={`/employees/${node.id}`} className="mt-2.5 block truncate font-semibold text-foreground hover:text-accent-foreground">
          {node.name}
        </Link>
        <p className="truncate text-[13px] text-muted-foreground">{node.title ?? "No designation"}</p>
        {isMe && <span className="mt-2 inline-block rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">You</span>}
      </div>
      {reports > 0 && (
        <button
          onClick={() => onToggle(node.id)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${node.name}'s team` : `Expand ${node.name}'s team (${node.size} people)`}
          title={`${reports} direct ${reports === 1 ? "report" : "reports"}, ${node.size} in total`}
          className={cx(
            "relative z-10 -mt-3 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold shadow-sm transition-colors",
            open ? "border-border bg-card text-foreground/80 hover:text-foreground" : "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {open ? reports : node.size}
          <ChevronLeftIcon size={13} className={cx("transition-transform", open ? "rotate-90" : "-rotate-90")} />
        </button>
      )}
    </div>
  );
}
