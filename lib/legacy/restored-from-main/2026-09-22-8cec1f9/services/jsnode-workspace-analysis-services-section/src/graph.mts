/**
 * graph — the workspace as a dependency DAG.
 *
 * `discoverWorkspace` reads every package and each one's declared runtime
 * `dependencies` (manifest deps, not dev). Those dependency lists name *all*
 * runtime deps, internal siblings and external npm packages alike. A package
 * DAG wants only the internal edges — an edge to `zod` is not part of our
 * shape and would hang an external leaf off the graph. So this projects the
 * workspace onto its own package-name set: nodes are the discovered packages,
 * edges are the dependency relations whose target is itself a discovered
 * package. Everything else (versions out of scope, npm leaves) is dropped.
 *
 * The result is the plain `{ nodes, edges }` a layout/renderer wants — pure
 * over a `JSNodeWorkspace`, no filesystem, no rendering. Edge direction is
 * dependent → dependency (`from` depends on `to`).
 */
import type { JSNodeLayer, JSNodeWorkspace, PackageLifecycle, PackageMaturity } from "@red-cup-engineering/jsnode-topology";
import { createGraph, neighborhood } from "@red-cup-engineering/graph-data-service";

/** One package as a graph node: its coordinates plus the internal-only subset
 *  of its dependencies (the same edges, denormalized onto the node for callers
 *  that walk node-first). */
export interface DependencyGraphNode {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly layer: JSNodeLayer;
  readonly tags: readonly string[];
  /** The team's lifecycle intent (active/maintenance/deprecated/abandoned). */
  readonly lifecycle: PackageLifecycle;
  /** The release maturity inferred from the version. */
  readonly maturity: PackageMaturity;
  /** Dependencies that are themselves workspace packages — external npm deps
   *  dropped. Same set as the `from === name` edges. */
  readonly dependencies: readonly string[];
}

/** A dependency edge, dependent → dependency: `from` declares `to` in its
 *  runtime `dependencies`, and both are workspace packages. */
export interface DependencyGraphEdge {
  readonly from: string;
  readonly to: string;
}

export interface WorkspaceDependencyGraph {
  /** Discovered packages, in discovery order (lib, apps, services, sites, ops). */
  readonly nodes: readonly DependencyGraphNode[];
  /** Internal-only dependency edges. */
  readonly edges: readonly DependencyGraphEdge[];
}

export interface EgoGraphOptions {
  /** How many dependency hops below the focus to include. Default 1. */
  readonly downDepth?: number;
  /** How many dependent hops above the focus to include. Default 1. */
  readonly upDepth?: number;
}

/** The neighbourhood of one package as its own dependency graph: the focus
 *  package, the packages it depends on (down to `downDepth` hops), and the
 *  packages that depend on it (up to `upDepth` hops). Edges are kept only when
 *  both endpoints are in the neighbourhood, so the subgraph is closed and can be
 *  laid out and rendered by the same machinery as the whole-workspace DAG.
 *
 *  Returns an empty graph if `name` is not a node in `graph`. The focus package
 *  is always included even with both depths 0. */
export function egoGraph(
  graph: WorkspaceDependencyGraph,
  name: string,
  opts: EgoGraphOptions = {},
): WorkspaceDependencyGraph {
  const downDepth = opts.downDepth ?? 1;
  const upDepth = opts.upDepth ?? 1;
  const byName = new Map(graph.nodes.map((n) => [n.name, n]));
  if (!byName.has(name)) return { nodes: [], edges: [] };

  // Down = outgoing (a package -> its dependencies), up = incoming (-> its
  // dependents) — graph-data-service's neighborhood over the same edge
  // convention (from depends on to) instead of a private bounded BFS.
  const dependencyGraph = createGraph({ nodes: graph.nodes.map((n) => ({ id: n.name })) });
  for (const e of graph.edges) dependencyGraph.addEdge({ from: e.from, to: e.to });
  const keep = neighborhood(dependencyGraph, name, { downDepth, upDepth });

  const nodes: DependencyGraphNode[] = [];
  for (const n of graph.nodes) {
    if (!keep.has(n.name)) continue;
    // Restrict each kept node's denormalised dependency list to kept nodes, so
    // it stays consistent with the filtered edge set.
    nodes.push({ ...n, dependencies: n.dependencies.filter((d) => keep.has(d)) });
  }
  const edges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  return { nodes, edges };
}

/** Project a discovered workspace onto its internal package dependency DAG.
 *  Keeps only edges whose target is itself a discovered package, so the graph
 *  is closed over the workspace and carries no external-npm leaves. */
export function workspaceDependencyGraph(workspace: JSNodeWorkspace): WorkspaceDependencyGraph {
  const internal = new Set(workspace.packages.map((p) => p.name));
  const nodes: DependencyGraphNode[] = [];
  const edges: DependencyGraphEdge[] = [];
  for (const pkg of workspace.packages) {
    const deps = pkg.dependencies.filter((d) => internal.has(d) && d !== pkg.name);
    nodes.push({
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      layer: pkg.layer,
      tags: pkg.tags,
      lifecycle: pkg.lifecycle,
      maturity: pkg.maturity,
      dependencies: deps,
    });
    for (const to of deps) edges.push({ from: pkg.name, to });
  }
  return { nodes, edges };
}
