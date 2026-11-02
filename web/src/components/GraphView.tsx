import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph from 'force-graph';
import { api } from '../api';
import type { GraphData } from '../types';
import { FOLDER_PALETTE, colorForFolder } from './folderColors';

const NODE_R = 5;
// Below this zoom level, labels disappear and it's just colored dots — a "galaxy" view of the
// whole vault's shape instead of a wall of overlapping text once you've zoomed out past where
// individual titles would be legible anyway.
const LABEL_ZOOM_THRESHOLD = 1.1;

/**
 * Graph view, now on the real `force-graph` library (canvas, wraps d3-force) instead of a
 * hand-rolled one-shot SVG layout — gets a live, continuously-settling physics simulation that
 * reheats on drag (so a dragged node's connections organically follow, the way Obsidian's graph
 * feels) plus real zoom/pan (wheel, pinch, drag-background) for free, none of which this project
 * had to build or debug itself anymore.
 *
 * Everything the previous version added on top — click-to-focus-neighborhood, folder/tag
 * filters, the folder legend — is layered back on via force-graph's own extension points
 * (`nodeCanvasObject` for custom drawing, `onNodeClick`/`onBackgroundClick`, and re-calling
 * `graphData()` with a filtered subset).
 */
export function GraphView({ onNavigate }: { onNavigate: (relPath: string) => void }) {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);

  // `nodeCanvasObject`/`onNodeClick` etc. are only ever attached once, inside the mount effect
  // below — refs are how they see current React state/props without needing to be torn down and
  // recreated (and the force-graph instance rebuilt) on every change.
  const focusIdRef = useRef<string | null>(null);
  focusIdRef.current = focusId;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    api
      .graph()
      .then(setGraph)
      .catch(() => setError('Could not load the link graph.'));
  }, []);

  const folderOrder = useMemo(() => {
    if (!graph) return [];
    return [...new Set(graph.nodes.map((n) => n.folder.split('/')[0] || '(root)'))].sort();
  }, [graph]);
  const folderOrderRef = useRef<string[]>([]);
  folderOrderRef.current = folderOrder;

  const tagOrder = useMemo(() => {
    if (!graph) return [];
    return [...new Set(graph.nodes.flatMap((n) => n.tags))].sort();
  }, [graph]);

  // Direct-neighbor lookup for focus mode — one hop only, not the full transitive component.
  const neighborsOf = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!graph) return map;
    for (const e of graph.edges) {
      if (!map.has(e.source)) map.set(e.source, new Set());
      if (!map.has(e.target)) map.set(e.target, new Set());
      map.get(e.source)!.add(e.target);
      map.get(e.target)!.add(e.source);
    }
    return map;
  }, [graph]);

  const activeIds = useMemo(() => {
    if (!focusId) return null;
    const ids = new Set<string>([focusId]);
    for (const id of neighborsOf.get(focusId) ?? []) ids.add(id);
    return ids;
  }, [focusId, neighborsOf]);
  const activeIdsRef = useRef<Set<string> | null>(null);
  activeIdsRef.current = activeIds;

  const filteredData = useMemo(() => {
    if (!graph) return null;
    const nodes = graph.nodes.filter((n) => {
      const top = n.folder.split('/')[0] || '(root)';
      if (folderFilter && top !== folderFilter) return false;
      if (tagFilter && !n.tags.includes(tagFilter)) return false;
      return true;
    });
    const ids = new Set(nodes.map((n) => n.id));
    const links = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) };
  }, [graph, folderFilter, tagFilter]);

  // Created once, on mount — not recreated per render/per state change (that would also reset
  // zoom/pan and restart physics from scratch every time a filter or focus changes).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const fg = new ForceGraph(el)
      .nodeId('id')
      .nodeLabel('title')
      .backgroundColor('rgba(0,0,0,0)')
      .linkColor((l: { source: unknown; target: unknown }) => {
        const active = activeIdsRef.current;
        const sourceId = typeof l.source === 'string' ? l.source : (l.source as { id: string })?.id;
        const targetId = typeof l.target === 'string' ? l.target : (l.target as { id: string })?.id;
        const dimmed = active && (!active.has(sourceId) || !active.has(targetId));
        return dimmed ? 'rgba(71,85,105,0.08)' : 'rgba(71,85,105,0.45)';
      })
      .linkWidth(1)
      .nodeCanvasObject((node: { id: string; title: string; folder: string; x: number; y: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const active = activeIdsRef.current;
        const dimmed = active && !active.has(node.id);
        ctx.save();
        ctx.globalAlpha = dimmed ? 0.25 : 1;
        ctx.beginPath();
        ctx.arc(node.x, node.y, NODE_R, 0, 2 * Math.PI);
        ctx.fillStyle = colorForFolder(node.folder, folderOrderRef.current);
        ctx.fill();
        if (focusIdRef.current === node.id) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#e879f9';
          ctx.beginPath();
          ctx.arc(node.x, node.y, NODE_R + 3, 0, 2 * Math.PI);
          ctx.stroke();
        }
        if (globalScale >= LABEL_ZOOM_THRESHOLD) {
          const fontSize = 11 / globalScale;
          ctx.font = `${fontSize}px Inter, sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#cbd5e1';
          const label = node.title.length > 28 ? `${node.title.slice(0, 28)}…` : node.title;
          ctx.fillText(label, node.x + NODE_R + 3, node.y);
        }
        ctx.restore();
      })
      .nodeCanvasObjectMode(() => 'replace')
      .nodePointerAreaPaint((node: { x: number; y: number }, color: string, ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, NODE_R + 3, 0, 2 * Math.PI);
        ctx.fill();
      })
      .onNodeClick((node: { id: string }) => {
        if (focusIdRef.current === node.id) {
          onNavigateRef.current(node.id);
          return;
        }
        setFocusId(node.id);
        fg.d3ReheatSimulation();
      })
      // force-graph's default drag handling pins a node's exact (fx, fy) position once you let
      // go, permanently removing it from the simulation — which is why nothing was ever
      // "re-centering": every dot you'd ever dragged stayed frozen forever, and the rest of the
      // layout kept re-settling around an ever-growing set of fixed anchors instead of the whole
      // thing being free to find a natural equilibrium again. Clearing fx/fy on release hands the
      // node back to the physics.
      .onNodeDragEnd((node: { fx?: number; fy?: number }) => {
        node.fx = undefined;
        node.fy = undefined;
        fg.d3ReheatSimulation();
      })
      .onBackgroundClick(() => {
        setFocusId(null);
        fg.d3ReheatSimulation();
      })
      // Default charge (repulsion) pushes every node away from every other node, so moving one
      // node close to its neighbors visibly reshuffled a big chunk of the graph. Halving the
      // strength and capping how far it reaches tames that to mostly local movement. Faster alpha
      // decay also means a drag's reheated simulation settles back down sooner instead of letting
      // the ripple keep going for a while after you let go.
      .d3AlphaDecay(0.05);

    const charge = fg.d3Force('charge');
    if (charge) {
      charge.strength(-15);
      charge.distanceMax(300);
    }

    fgRef.current = fg;

    const resize = () => {
      fg.width(el.clientWidth).height(el.clientHeight);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    return () => {
      observer.disconnect();
      fg.pauseAnimation();
      fgRef.current = null;
    };
    // Depends on `graph`, not `[]`: before `graph` loads this component renders the "Loading
    // graph…" placeholder instead of the container div, so `containerRef.current` is null and
    // this bails out on that first run. A `[]`-deps effect would never get a second chance once
    // the real container mounts — same class of bug as the wheel-listener one two rounds ago.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    if (fgRef.current && filteredData) fgRef.current.graphData(filteredData);
  }, [filteredData]);

  const zoomBy = (factor: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.zoom(fg.zoom() * factor, 250);
  };
  const resetView = () => fgRef.current?.zoomToFit(400, 40);

  // Scatters every node back into a tight clump near the origin and lets the simulation redo its
  // own spreading from there — also clears any lingering fx/fy pins (belt-and-suspenders against
  // anything fixed before the drag-release fix, or by a future change) rather than just reheating
  // in place, which wouldn't undo an already-settled layout that's grown stale/tangled.
  const resetLayout = () => {
    const fg = fgRef.current;
    if (!fg) return;
    const { nodes } = fg.graphData();
    for (const n of nodes as { x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number }[]) {
      n.fx = undefined;
      n.fy = undefined;
      n.vx = 0;
      n.vy = 0;
      n.x = (Math.random() - 0.5) * 40;
      n.y = (Math.random() - 0.5) * 40;
    }
    fg.d3ReheatSimulation();
    setTimeout(() => fg.zoomToFit(400, 40), 700);
  };

  if (error) return <div className="text-sm text-red-300">{error}</div>;
  if (!graph) return <div className="text-sm text-slate-500">Loading graph…</div>;

  if (graph.nodes.length === 0) {
    return <div className="text-sm text-slate-500">No notes to graph yet.</div>;
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-slate-100">Graph</h1>
      <div className="mb-3 text-sm text-slate-500">
        {graph.nodes.length} notes · {graph.edges.length} links. Drag a node (its connections follow), drag the
        background to pan, scroll/pinch to zoom, click a node to focus its neighbors (click again to open).
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={folderFilter ?? ''}
          onChange={(e) => setFolderFilter(e.target.value || null)}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 focus:border-violet-500 focus:outline-none"
        >
          <option value="">All folders</option>
          {folderOrder.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          value={tagFilter ?? ''}
          onChange={(e) => setTagFilter(e.target.value || null)}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 focus:border-violet-500 focus:outline-none"
        >
          <option value="">All tags</option>
          {tagOrder.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        {(folderFilter || tagFilter) && (
          <button
            onClick={() => {
              setFolderFilter(null);
              setTagFilter(null);
            }}
            className="rounded border border-slate-700 px-2 py-1.5 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
          >
            ✕ Clear filter
          </button>
        )}
        {focusId && (
          <button
            onClick={() => {
              setFocusId(null);
              fgRef.current?.d3ReheatSimulation();
            }}
            className="rounded border border-violet-500/40 bg-violet-500/10 px-2 py-1.5 text-xs text-violet-300 hover:border-violet-500/60"
          >
            ✕ Clear focus
          </button>
        )}
        <button
          onClick={resetLayout}
          title="Scatter and re-settle the whole layout, clearing any pinned nodes"
          className="ml-auto rounded border border-slate-700 px-2 py-1.5 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
        >
          ↺ Reset layout
        </button>
      </div>

      <div className="relative h-[70vh] max-h-[720px] min-h-[360px] rounded-xl border border-slate-800/80 bg-slate-900/40 shadow-sm shadow-black/20">
        <div ref={containerRef} className="h-full w-full" />

        <div className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900/90 p-1 shadow-lg">
          <button
            onClick={() => zoomBy(1.3)}
            title="Zoom in"
            className="flex h-7 w-7 items-center justify-center rounded text-slate-300 hover:bg-slate-800 hover:text-violet-300"
          >
            +
          </button>
          <button
            onClick={() => zoomBy(1 / 1.3)}
            title="Zoom out"
            className="flex h-7 w-7 items-center justify-center rounded text-slate-300 hover:bg-slate-800 hover:text-violet-300"
          >
            −
          </button>
          <button
            onClick={resetView}
            title="Fit to view"
            className="flex h-7 w-7 items-center justify-center rounded text-[10px] text-slate-300 hover:bg-slate-800 hover:text-violet-300"
          >
            ⟲
          </button>
        </div>
      </div>

      {folderOrder.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {folderOrder.map((folder) => (
            <button
              key={folder}
              onClick={() => setFolderFilter((f) => (f === folder ? null : folder))}
              className={`flex items-center gap-1.5 text-xs transition ${
                folderFilter === folder ? 'text-violet-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: FOLDER_PALETTE[folderOrder.indexOf(folder) % FOLDER_PALETTE.length] }} />
              {folder}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
