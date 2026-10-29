/**
 * svg — the workspace dependency DAG as a self-describing, clickable SVG.
 *
 * This is the "last-stop fallback" graphics path: no WebGL, no canvas, no
 * client runtime — a static vector document that a browser renders, a human
 * clicks, and an LLM reads straight from the markup. The structure is the
 * point: layers are `<g data-depth>`, every node is an `<a href><g
 * data-name data-layer>` carrying a `<title>` of "name — description", every
 * edge is a `<line>` with `data-from`/`data-to`. Open it in a browser to click
 * through; feed it to a model to read the graph as text.
 *
 * Layout is a compact Sugiyama, shaped like an inverted tree: rank each node by
 * the longest path from a *root* — a package nothing else depends on — down to
 * it. Roots (apps, sites, leaf tools with no dependents) get rank 0 and form
 * the canopy at the top; every other node sinks to one row below its
 * deepest-ranked dependent, so a package always sits beneath everything that
 * depends on it. The most-depended-on foundations sink furthest: a
 * zero-dependency hub like meme-algebra lands alone at the very base. (A
 * package with its own dependencies can't reach the absolute base — those deps
 * must sit below it — so the floor is reserved for true leaves of the
 * dependency relation.) Layers are then ordered by barycenter sweeps to thin
 * out edge crossings. Cycles — which a package DAG should not have, but we
 * never assume — are broken by memoized rank with an on-stack guard, so a
 * back-edge simply doesn't deepen its target.
 */
import type {
  DependencyGraphEdge,
  DependencyGraphNode,
  WorkspaceDependencyGraph,
} from "./graph.mjs";
import { layoutGraph, LAYOUT_DEFAULTS, type LayoutGeometry } from "./layout.mjs";
import type { JSNodeLayer } from "@red-cup-engineering/jsnode-topology";

export interface SvgRenderOptions {
  /** Node box width/height in px. */
  readonly nodeWidth?: number;
  readonly nodeHeight?: number;
  /** Horizontal gap between nodes in a layer; vertical gap between layers. */
  readonly hGap?: number;
  readonly vGap?: number;
  /** Document margin in px. */
  readonly margin?: number;
  /** Number of barycenter ordering sweeps. More = fewer crossings, slower. */
  readonly sweeps?: number;
  /** Maps a node to its click target. Returns undefined to leave it unlinked. */
  readonly href?: (node: DependencyGraphNode) => string | undefined;
  /** Document title (the SVG's <title>). */
  readonly title?: string;
  /** Name of a package to render as the focus: a brighter outline marks it, so
   *  an ego/neighbourhood graph shows which node it is centred on. */
  readonly focus?: string;
}

// Resolve render options into a full layout geometry, falling back to defaults.
function geometryFrom(opts: SvgRenderOptions): LayoutGeometry {
  return {
    nodeWidth: opts.nodeWidth ?? LAYOUT_DEFAULTS.nodeWidth,
    nodeHeight: opts.nodeHeight ?? LAYOUT_DEFAULTS.nodeHeight,
    hGap: opts.hGap ?? LAYOUT_DEFAULTS.hGap,
    vGap: opts.vGap ?? LAYOUT_DEFAULTS.vGap,
    margin: opts.margin ?? LAYOUT_DEFAULTS.margin,
    sweeps: opts.sweeps ?? LAYOUT_DEFAULTS.sweeps,
  };
}

/** A node placed in the plane: its source node, layout depth, and box centre. */
export interface PlacedNode {
  readonly node: DependencyGraphNode;
  readonly depth: number;
  readonly cx: number;
  readonly cy: number;
}

export interface GraphLayout {
  readonly nodes: readonly PlacedNode[];
  readonly edges: readonly DependencyGraphEdge[];
  readonly width: number;
  readonly height: number;
  /** Greatest dependency depth in the graph (number of layers minus one). */
  readonly maxDepth: number;
}

/** Lay the dependency graph out in the plane. Pure geometry — no SVG. Rank 0
 *  (the roots nothing depends on) forms the canopy at the top; each node's
 *  `depth` is its row from there, so foundations sink to the base and edges flow
 *  downward from dependent to dependency. Thin wrapper over the shared
 *  `layoutGraph`: the dependency edge (dependent → dependency) becomes a layout
 *  edge, so the dependency receives the incoming edge and ranks below. */
export function layoutDependencyGraph(
  graph: WorkspaceDependencyGraph,
  opts: SvgRenderOptions = {},
): GraphLayout {
  const geom = layoutGraph(
    graph.nodes.map((n) => n.name),
    graph.edges,
    geometryFrom(opts),
  );
  const placed: PlacedNode[] = [];
  for (const node of graph.nodes) {
    const p = geom.points.get(node.name);
    if (p) placed.push({ node, depth: p.rank, cx: p.cx, cy: p.cy });
  }
  return {
    nodes: placed,
    edges: graph.edges,
    width: geom.width,
    height: geom.height,
    maxDepth: geom.maxRank,
  };
}

// Per-stratum fill/stroke. The four repo strata get four hues; an unknown
// layer falls back to the lib palette.
const LAYER_FILL: Record<JSNodeLayer, string> = {
  lib: "#1b3a4b",
  apps: "#4b1b3a",
  services: "#3a4b1b",
  sites: "#4b3a1b",
  ops: "#3a3a3a",
};
const LAYER_STROKE: Record<JSNodeLayer, string> = {
  lib: "#3f7d9c",
  apps: "#9c3f7d",
  services: "#7d9c3f",
  sites: "#9c7d3f",
  ops: "#7d7d7d",
};

const xmlEscape = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Truncate a label to fit the box; the full name lives in the <title>.
const fitLabel = (name: string, nodeWidth: number): string => {
  const max = Math.floor((nodeWidth - 12) / 7); // ~7px per char at 12px mono
  return name.length <= max ? name : name.slice(0, max - 1) + "…";
};

/** Render the dependency graph to a clickable, self-describing SVG string. */
export function dependencyGraphSvg(
  graph: WorkspaceDependencyGraph,
  opts: SvgRenderOptions = {},
): string {
  const nodeWidth = opts.nodeWidth ?? LAYOUT_DEFAULTS.nodeWidth;
  const nodeHeight = opts.nodeHeight ?? LAYOUT_DEFAULTS.nodeHeight;
  const layout = layoutDependencyGraph(graph, opts);
  const pos = new Map(layout.nodes.map((p) => [p.node.name, p]));
  const title = opts.title ?? "workspace dependency DAG";

  const byLayer = layout.nodes.reduce<Record<string, number>>((acc, p) => {
    acc[p.node.layer] = (acc[p.node.layer] ?? 0) + 1;
    return acc;
  }, {});
  const desc =
    `${layout.nodes.length} packages, ${layout.edges.length} internal dependency edges, ` +
    `${layout.maxDepth + 1} layers. By stratum: ` +
    Object.entries(byLayer).map(([l, n]) => `${l} ${n}`).join(", ") + ".";

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" ` +
      `width="${layout.width}" height="${layout.height}" font-family="ui-monospace,Menlo,monospace" role="img">`,
  );
  lines.push(`<title>${xmlEscape(title)}</title>`);
  lines.push(`<desc>${xmlEscape(desc)}</desc>`);
  lines.push(`<rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="#0d1117"/>`);
  lines.push(
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
      `<path d="M0,0 L10,5 L0,10 z" fill="#3a4452"/></marker></defs>`,
  );

  // Edges first, behind the nodes. Dependent (from) → dependency (to), drawn
  // from the bottom of the dependent to the top of the dependency.
  lines.push(`<g stroke="#3a4452" stroke-width="1" fill="none" opacity="0.55">`);
  for (const e of layout.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.cx, y1 = a.cy + nodeHeight / 2;
    const x2 = b.cx, y2 = b.cy - nodeHeight / 2;
    const my = (y1 + y2) / 2;
    lines.push(
      `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${my.toFixed(1)} ` +
        `${x2.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" ` +
        `data-from="${xmlEscape(e.from)}" data-to="${xmlEscape(e.to)}" marker-end="url(#arrow)"/>`,
    );
  }
  lines.push(`</g>`);

  // Nodes, grouped by layer for legibility in the markup.
  for (let d = layout.maxDepth; d >= 0; d--) {
    const inLayer = layout.nodes.filter((p) => p.depth === d);
    if (!inLayer.length) continue;
    lines.push(`<g data-depth="${d}">`);
    for (const p of inLayer) {
      const n = p.node;
      const x = p.cx - nodeWidth / 2;
      const y = p.cy - nodeHeight / 2;
      const fill = LAYER_FILL[n.layer] ?? LAYER_FILL.lib;
      const isFocus = opts.focus !== undefined && n.name === opts.focus;
      // The focus node of an ego graph gets a bright outline so the eye lands on
      // it; data-focus marks it for agents reading the markup.
      const stroke = isFocus ? "#f0f6fc" : (LAYER_STROKE[n.layer] ?? LAYER_STROKE.lib);
      const strokeWidth = isFocus ? 3 : 1.5;
      const titleText = n.description ? `${n.name} — ${n.description}` : n.name;
      const href = opts.href?.(n);
      const open = href ? `<a href="${xmlEscape(href)}" target="_top">` : "";
      const close = href ? `</a>` : "";
      lines.push(
        `${open}<g class="node" data-name="${xmlEscape(n.name)}" data-layer="${n.layer}" data-deps="${n.dependencies.length}"${isFocus ? ` data-focus="true"` : ""}>` +
          `<title>${xmlEscape(titleText)}</title>` +
          `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${nodeWidth}" height="${nodeHeight}" rx="4" ` +
          `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>` +
          `<text x="${p.cx.toFixed(1)}" y="${(p.cy + 4).toFixed(1)}" text-anchor="middle" ` +
          `font-size="12" fill="#e6edf3">${xmlEscape(fitLabel(n.name, nodeWidth))}</text>` +
          `</g>${close}`,
      );
    }
    lines.push(`</g>`);
  }

  lines.push(`</svg>`);
  return lines.join("\n");
}
