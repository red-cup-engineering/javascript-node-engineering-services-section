/**
 * analysis — geometric and analytical invariants of the workspace dependency
 * graph, computed directly over {@link WorkspaceDependencyGraph}.
 *
 * The graph already determines a great deal that nothing reads off it: how many
 * disconnected islands the workspace is in, whether the dependency relation is
 * acyclic, how far apart two packages are, which package the most flow passes
 * through, and how deep below the surface a package sits. These are the
 * *geometric* (distance, centre, diameter) and *analytical* (components,
 * cycles, strata, centrality) facts about the package graph.
 *
 * `@emsenn/meme-analysis` defines the spectral versions of several of these
 * (component count, Laplacian characteristic polynomial, spanning-tree count)
 * exactly, over the meme-topology carrier `jsnode-topology` emits — but its
 * hereditarily-finite-set arithmetic, where an integer V costs O(V), does not
 * fit at workspace scale (the whole-workspace carrier OOMs a Laplacian
 * determinant). So this module computes the *combinatorial* invariants —
 * components, cycles, distance, centrality, strata — with ordinary numeric graph
 * algorithms over the package dependency graph. The *spectral* invariants are
 * computed in {@link ./spectrum.mjs} by the move that header's earlier draft
 * proposed: slice the graph to a single package's neighbourhood (where the
 * invariants are small and legible) and carry the exact integers as native
 * `bigint` (where they cost no more than their digits) — so the exact spectrum
 * runs at workspace scale after all, one bounded slice per package.
 *
 * Pure functions of the graph; no I/O.
 */
import { packageCoordinate, JSNODE_ROLES } from "@red-cup-engineering/jsnode-topology";
import type { JSNodeRole } from "@red-cup-engineering/jsnode-topology";
import type { WorkspaceDependencyGraph } from "./graph.mjs";

/** A weakly-connected island of packages. */
export interface GraphComponent {
  readonly size: number;
  readonly members: readonly string[];
}

/** Per-package position in the graph: how depended-upon, how dependent, how
 *  much dependency flow runs through it, and how deep it sits. */
export interface PackageCentrality {
  readonly name: string;
  /** Packages that depend on this one (reverse degree) — "how kernel am I". */
  readonly dependents: number;
  /** Workspace packages this one depends on (forward degree). */
  readonly dependencies: number;
  /** Brandes betweenness over the directed dependency graph: the share of
   *  shortest dependency paths that pass through this package. */
  readonly betweenness: number;
  /** Longest dependency chain below this package (0 = depends on nothing
   *  internal). The induced layering, which may disagree with the declared
   *  lib/apps/services layer — and that disagreement is information. */
  readonly stratum: number;
}

/** The geometry and analysis of the whole dependency graph. */
export interface WorkspaceAnalysis {
  readonly order: number;
  readonly size: number;
  /** Weakly-connected components, largest first. */
  readonly components: readonly GraphComponent[];
  readonly componentCount: number;
  /** True when the dependency relation has no cycles. */
  readonly acyclic: boolean;
  /** Strongly-connected components of size > 1 — i.e. dependency cycles. */
  readonly cycles: readonly (readonly string[])[];
  /** Geometry of the largest component (undirected distance): the longest
   *  shortest path (diameter), the smallest eccentricity (radius), and the
   *  central packages achieving it. Distances ignore edge direction. */
  readonly diameter: number;
  readonly radius: number;
  readonly center: readonly string[];
  /** The deepest dependency chain in the workspace. */
  readonly height: number;
  /** Per-package centrality, most-depended-upon first. */
  readonly centrality: readonly PackageCentrality[];
}

function adjacency(graph: WorkspaceDependencyGraph): {
  index: Map<string, number>;
  names: string[];
  out: number[][];
  inn: number[][];
} {
  const names = graph.nodes.map((n) => n.name);
  const index = new Map(names.map((n, i) => [n, i] as const));
  const out: number[][] = names.map(() => []);
  const inn: number[][] = names.map(() => []);
  for (const e of graph.edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined) {
      out[a]!.push(b);
      inn[b]!.push(a);
    }
  }
  return { index, names, out, inn };
}

/** Weakly-connected components (direction ignored), largest first. */
function components(names: string[], out: number[][], inn: number[][]): GraphComponent[] {
  const comp = new Array<number>(names.length).fill(-1);
  let k = 0;
  for (let s = 0; s < names.length; s++) {
    if (comp[s] !== -1) continue;
    const stack = [s];
    comp[s] = k;
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of [...out[u]!, ...inn[u]!]) {
        if (comp[v] === -1) {
          comp[v] = k;
          stack.push(v);
        }
      }
    }
    k++;
  }
  const buckets: string[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < names.length; i++) buckets[comp[i]!]!.push(names[i]!);
  return buckets
    .map((members) => ({ size: members.length, members: Object.freeze(members) }))
    .sort((a, b) => b.size - a.size);
}

/** Tarjan strongly-connected components; cycles are the SCCs of size > 1. */
function stronglyConnected(names: string[], out: number[][]): string[][] {
  const N = names.length;
  const num = new Array<number>(N).fill(-1);
  const low = new Array<number>(N).fill(0);
  const onStack = new Array<boolean>(N).fill(false);
  const stack: number[] = [];
  const sccs: number[][] = [];
  let idx = 0;
  // Iterative Tarjan to avoid blowing the call stack on deep graphs.
  for (let root = 0; root < N; root++) {
    if (num[root] !== -1) continue;
    const work: Array<{ v: number; i: number }> = [{ v: root, i: 0 }];
    while (work.length) {
      const frame = work[work.length - 1]!;
      const v = frame.v;
      if (frame.i === 0) {
        num[v] = low[v] = idx++;
        stack.push(v);
        onStack[v] = true;
      }
      if (frame.i < out[v]!.length) {
        const w = out[v]![frame.i]!;
        frame.i++;
        if (num[w] === -1) {
          work.push({ v: w, i: 0 });
        } else if (onStack[w]) {
          low[v] = Math.min(low[v]!, num[w]!);
        }
      } else {
        if (low[v] === num[v]) {
          const scc: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = false;
            scc.push(w);
          } while (w !== v);
          sccs.push(scc);
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1]!.v;
          low[parent] = Math.min(low[parent]!, low[v]!);
        }
      }
    }
  }
  return sccs.filter((c) => c.length > 1).map((c) => c.map((i) => names[i]!));
}

/** BFS eccentricity over the undirected graph, restricted to one component. */
function eccentricities(
  members: string[],
  index: Map<string, number>,
  out: number[][],
  inn: number[][],
): { ecc: Map<string, number>; diameter: number } {
  const local = new Set(members.map((m) => index.get(m)!));
  const ecc = new Map<string, number>();
  let diameter = 0;
  for (const m of members) {
    const src = index.get(m)!;
    const dist = new Map<number, number>([[src, 0]]);
    const queue = [src];
    let far = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi]!;
      const d = dist.get(u)!;
      for (const v of [...out[u]!, ...inn[u]!]) {
        if (!local.has(v) || dist.has(v)) continue;
        dist.set(v, d + 1);
        far = Math.max(far, d + 1);
        queue.push(v);
      }
    }
    ecc.set(m, far);
    diameter = Math.max(diameter, far);
  }
  return { ecc, diameter };
}

/** Brandes betweenness centrality on the directed unweighted graph. */
function betweenness(names: string[], out: number[][]): number[] {
  const N = names.length;
  const cb = new Array<number>(N).fill(0);
  for (let s = 0; s < N; s++) {
    const stack: number[] = [];
    const pred: number[][] = names.map(() => []);
    const sigma = new Array<number>(N).fill(0);
    const dist = new Array<number>(N).fill(-1);
    sigma[s] = 1;
    dist[s] = 0;
    const queue = [s];
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi]!;
      stack.push(v);
      for (const w of out[v]!) {
        if (dist[w] === -1) {
          dist[w] = dist[v]! + 1;
          queue.push(w);
        }
        if (dist[w] === dist[v]! + 1) {
          sigma[w]! += sigma[v]!;
          pred[w]!.push(v);
        }
      }
    }
    const delta = new Array<number>(N).fill(0);
    for (let i = stack.length - 1; i >= 0; i--) {
      const w = stack[i]!;
      for (const v of pred[w]!) {
        delta[v]! += (sigma[v]! / sigma[w]!) * (1 + delta[w]!);
      }
      if (w !== s) cb[w]! += delta[w]!;
    }
  }
  return cb;
}

/** Longest dependency chain below each node (memoised over a DAG). For a
 *  graph with cycles the cyclic nodes settle to a finite bound rather than
 *  recursing forever. */
function strata(names: string[], out: number[][]): number[] {
  const depth = new Array<number>(names.length).fill(-1);
  const visiting = new Array<boolean>(names.length).fill(false);
  const compute = (v: number): number => {
    if (depth[v] !== -1) return depth[v]!;
    if (visiting[v]) return 0; // break cycles defensively
    visiting[v] = true;
    let best = 0;
    for (const w of out[v]!) best = Math.max(best, 1 + compute(w));
    visiting[v] = false;
    depth[v] = best;
    return best;
  };
  for (let i = 0; i < names.length; i++) compute(i);
  return depth;
}

/** Compute the geometry and analysis of a workspace dependency graph. */
export function workspaceAnalysis(graph: WorkspaceDependencyGraph): WorkspaceAnalysis {
  const { index, names, out, inn } = adjacency(graph);
  const comps = components(names, out, inn);
  const cycles = stronglyConnected(names, out);
  const largest = comps[0]?.members ?? [];
  const { ecc, diameter } = eccentricities([...largest], index, out, inn);
  let radius = Infinity;
  for (const e of ecc.values()) radius = Math.min(radius, e);
  if (!Number.isFinite(radius)) radius = 0;
  const center = [...ecc.entries()].filter(([, e]) => e === radius).map(([n]) => n);
  const cb = betweenness(names, out);
  const depth = strata(names, out);

  const centrality: PackageCentrality[] = names
    .map((name, i) => ({
      name,
      dependents: inn[i]!.length,
      dependencies: out[i]!.length,
      betweenness: cb[i]!,
      stratum: depth[i]!,
    }))
    .sort((a, b) => b.dependents - a.dependents || b.betweenness - a.betweenness);

  return {
    order: names.length,
    size: graph.edges.length,
    components: comps,
    componentCount: comps.length,
    acyclic: cycles.length === 0,
    cycles: Object.freeze(cycles.map((c) => Object.freeze(c))),
    diameter,
    radius,
    center: Object.freeze(center),
    height: depth.length ? Math.max(0, ...depth) : 0,
    centrality: Object.freeze(centrality),
  };
}

// ---------- the fibration grid ----------

/** One cell of the role × domain grid: the packages sharing a (domain, role). */
export interface GridCell {
  readonly domain: string;
  readonly role: JSNodeRole | "—";
  readonly packages: readonly string[];
}

/** The flat layout made legible as the 2-D grid its names encode: which roles
 *  exist, which domains exist, and which packages sit at each (domain, role).
 *  An empty cell is a fact — a role a domain never reaches. */
export interface RoleDomainGrid {
  readonly roles: readonly (JSNodeRole | "—")[];
  readonly domains: readonly string[];
  readonly cells: readonly GridCell[];
  readonly byRole: readonly { readonly role: JSNodeRole | "—"; readonly count: number }[];
  readonly byDomain: readonly { readonly domain: string; readonly count: number }[];
}

/** Project a set of package names onto the (domain, role) fibration grid. */
export function roleDomainGrid(packageNames: readonly string[]): RoleDomainGrid {
  const byCell = new Map<string, string[]>();
  const roleCount = new Map<JSNodeRole | "—", number>();
  const domainCount = new Map<string, number>();
  const roles = new Set<JSNodeRole | "—">();
  const domains = new Set<string>();
  for (const name of packageNames) {
    const c = packageCoordinate(name);
    const role: JSNodeRole | "—" = c.role ?? "—";
    roles.add(role);
    domains.add(c.domain);
    const key = `${c.domain} ${role}`;
    (byCell.get(key) ?? byCell.set(key, []).get(key)!).push(name);
    roleCount.set(role, (roleCount.get(role) ?? 0) + 1);
    domainCount.set(c.domain, (domainCount.get(c.domain) ?? 0) + 1);
  }
  const cells: GridCell[] = [...byCell.entries()].map(([key, packages]) => {
    const [domain, role] = key.split(" ") as [string, JSNodeRole | "—"];
    return { domain, role, packages: Object.freeze([...packages].sort()) };
  });
  const roleOrder = (r: JSNodeRole | "—"): number => (r === "—" ? 99 : 0);
  return {
    roles: Object.freeze([...roles].sort((a, b) => roleOrder(a) - roleOrder(b) || a.localeCompare(b))),
    domains: Object.freeze([...domains].sort()),
    cells: Object.freeze(cells.sort((a, b) => a.domain.localeCompare(b.domain) || String(a.role).localeCompare(String(b.role)))),
    byRole: Object.freeze(
      [...roleCount.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count),
    ),
    byDomain: Object.freeze(
      [...domainCount.entries()].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count),
    ),
  };
}

// ---------- the role quotient (base of the fibration) ----------

/** A non-role role label: the role-less bucket of atoms and applications. */
const NO_ROLE = "—" as const;

/** Whether a dependency edge, projected to roles, runs *with* the declared
 *  {@link JSNODE_ROLES} order, *against* it, sits within one role, or is
 *  unranked.
 *
 *  Direction is read off the dependency edge `from` → `to` (`from` depends on
 *  `to`). The declared order treats `algebra` as the base (stratum 0) and reads
 *  later roles as built atop earlier ones, so a healthy ("with") edge is a
 *  higher-stratum role depending *down* on a lower one. An "against" edge is a
 *  back-edge: a lower-stratum role depending *up* on a higher one — information
 *  about where the naming convention and the real dependency flow disagree, not
 *  a defect. Either endpoint being role-less makes the comparison `unranked`. */
export type DeclaredOrderRelation = "with" | "against" | "lateral" | "unranked";

/** One role of the quotient: how many packages carry it, its declared stratum
 *  (index in {@link JSNODE_ROLES}; null for the role-less bucket), and the
 *  multiplicity of its within-role self-loop. */
export interface RoleQuotientNode {
  readonly role: JSNodeRole | typeof NO_ROLE;
  /** Index in the declared role order; null for the role-less "—" bucket. */
  readonly stratum: number | null;
  /** Packages carrying this role. */
  readonly packages: number;
  /** Within-role dependency edges (the self-loop multiplicity). */
  readonly selfLoop: number;
}

/** One edge of the role quotient: every package dependency edge whose endpoints
 *  carry these two roles, counted with multiplicity (the multigraph convention),
 *  split into the dependencies that stay within a domain (the *vertical* /
 *  fibre-internal mass) and those that cross domains (the *horizontal* / base
 *  mass), and classified against the declared role order. */
export interface RoleQuotientEdge {
  /** The depending role. */
  readonly from: JSNodeRole | typeof NO_ROLE;
  /** The depended-on role. */
  readonly to: JSNodeRole | typeof NO_ROLE;
  /** Package edges mapping to this role pair (multigraph multiplicity). */
  readonly weight: number;
  /** Of those, edges whose endpoints share a domain (vertical / in-fibre). */
  readonly withinDomain: number;
  /** Of those, edges whose endpoints cross domains (horizontal / base). */
  readonly crossDomain: number;
  readonly declaredOrder: DeclaredOrderRelation;
}

/** The role projection of the dependency graph: every package contracted to
 *  its role. Where {@link roleDomainGrid} lays out each package by its full
 *  (domain, role) coordinate, this collapses the role axis to a single role→role
 *  multigraph — ~8 nodes for the whole workspace — that answers questions the
 *  package graph only implies: whether the role suffix names a real grading of
 *  dependency (is the ranked-role quotient acyclic?), how much dependency stays
 *  inside a domain versus crossing between domains, and which role pairs run
 *  against the order the names declare. Note a quotient can be cyclic even when
 *  the package graph is acyclic — contracting distinct packages to one role
 *  identifies edges that had no cycle between them. */
export interface RoleQuotientGraph {
  readonly kind: "jsnode.role-quotient";
  /** Roles present, declared-order first, the role-less bucket last. */
  readonly roles: readonly (JSNodeRole | typeof NO_ROLE)[];
  readonly nodes: readonly RoleQuotientNode[];
  readonly edges: readonly RoleQuotientEdge[];
  readonly order: number;
  readonly size: number;
  /** Dependency edges whose endpoints share a domain (vertical / in-fibre). */
  readonly withinDomainEdges: number;
  /** Dependency edges whose endpoints cross domains (horizontal / base). */
  readonly crossDomainEdges: number;
  /** True when the *ranked* roles (the role-less "—" bucket excluded) form an
   *  acyclic quotient once within-role self-loops are ignored — i.e. *some*
   *  layering of the role functors is consistent with dependency, whether or not
   *  it is the declared one. The "—" bucket is held out of this test on purpose:
   *  it is not a role but the absence of one, and it conflates leaf applications
   *  (which consume every role) with foundational atoms (which every role
   *  consumes), so routing the test through it would manufacture a cycle. False
   *  here is a real fact about the role functors: some of them mutually depend,
   *  so no role grading can be a total order. */
  readonly acyclic: boolean;
  /** Strongly-connected role classes of size > 1 among the *ranked* roles — the
   *  role functors that mutually depend, the exact obstruction to any grading.
   *  Empty iff `acyclic`. */
  readonly entangled: readonly (readonly (JSNodeRole | typeof NO_ROLE)[])[];
  /** Quotient edges running against the declared {@link JSNODE_ROLES} order
   *  (a lower-stratum role depending on a higher one). The naming convention and
   *  the real dependency flow disagree exactly here. */
  readonly againstDeclared: readonly RoleQuotientEdge[];
}

const roleStratum = (role: JSNodeRole | typeof NO_ROLE): number | null => {
  if (role === NO_ROLE) return null;
  const i = JSNODE_ROLES.indexOf(role);
  return i === -1 ? null : i;
};

const declaredOrderOf = (from: JSNodeRole | typeof NO_ROLE, to: JSNodeRole | typeof NO_ROLE): DeclaredOrderRelation => {
  if (from === to) return "lateral";
  const sf = roleStratum(from);
  const st = roleStratum(to);
  if (sf === null || st === null) return "unranked";
  // `from` depends on `to`; declared order builds higher strata atop lower, so
  // depending downward (sf > st) runs *with* the order, upward runs against it.
  return sf > st ? "with" : "against";
};

/** Tarjan SCCs over a role adjacency map (self-loops already excluded). Returns
 *  only the classes of size > 1 — the mutually-dependent role groups. */
function entangledRoleClasses(
  roles: readonly (JSNodeRole | typeof NO_ROLE)[],
  adj: Map<string, Set<string>>,
): (JSNodeRole | typeof NO_ROLE)[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let idx = 0;
  const strongConnect = (v: string): void => {
    index.set(v, idx);
    low.set(v, idx);
    idx++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      out.push(scc);
    }
  };
  for (const r of roles) if (!index.has(r)) strongConnect(r);
  return out.filter((c) => c.length > 1).map((c) => c as (JSNodeRole | typeof NO_ROLE)[]);
}

/** Quotient a workspace dependency graph by the role projection: contract every
 *  package to its role, keep parallel edges and self-loops (the multigraph
 *  convention the corpus quotient-graph note declares), and read off the
 *  fibration's base structure. Pure over the graph; no I/O. */
export function roleQuotientGraph(graph: WorkspaceDependencyGraph): RoleQuotientGraph {
  const coordOf = new Map<string, { domain: string; role: JSNodeRole | typeof NO_ROLE }>();
  const pkgCount = new Map<JSNodeRole | typeof NO_ROLE, number>();
  const present = new Set<JSNodeRole | typeof NO_ROLE>();
  for (const n of graph.nodes) {
    const c = packageCoordinate(n.name);
    const role: JSNodeRole | typeof NO_ROLE = c.role ?? NO_ROLE;
    coordOf.set(n.name, { domain: c.domain, role });
    pkgCount.set(role, (pkgCount.get(role) ?? 0) + 1);
    present.add(role);
  }

  interface Acc { weight: number; withinDomain: number; crossDomain: number }
  const cells = new Map<string, Acc>();
  let withinDomainEdges = 0;
  let crossDomainEdges = 0;
  for (const e of graph.edges) {
    const cf = coordOf.get(e.from);
    const ct = coordOf.get(e.to);
    if (cf === undefined || ct === undefined) continue;
    present.add(cf.role);
    present.add(ct.role);
    const key = `${cf.role} ${ct.role}`;
    const acc = cells.get(key) ?? { weight: 0, withinDomain: 0, crossDomain: 0 };
    acc.weight++;
    const within = cf.domain === ct.domain;
    if (within) {
      acc.withinDomain++;
      withinDomainEdges++;
    } else {
      acc.crossDomain++;
      crossDomainEdges++;
    }
    cells.set(key, acc);
  }

  // Roles in declared order, the role-less bucket last; only those present.
  const rolesOrdered: (JSNodeRole | typeof NO_ROLE)[] = [
    ...JSNODE_ROLES.filter((r) => present.has(r)),
    ...(present.has(NO_ROLE) ? [NO_ROLE] : []),
  ];

  const selfLoop = new Map<JSNodeRole | typeof NO_ROLE, number>();
  const edges: RoleQuotientEdge[] = [];
  const adj = new Map<string, Set<string>>();
  for (const [key, acc] of cells) {
    const [from, to] = key.split(" ") as [JSNodeRole | typeof NO_ROLE, JSNodeRole | typeof NO_ROLE];
    if (from === to) {
      selfLoop.set(from, acc.weight);
    } else if (from !== NO_ROLE && to !== NO_ROLE) {
      // Only ranked role pairs feed the grading test; the "—" bucket is held out
      // (see `acyclic`), so edges touching it never enter the SCC adjacency.
      (adj.get(from) ?? adj.set(from, new Set()).get(from)!).add(to);
    }
    edges.push({
      from,
      to,
      weight: acc.weight,
      withinDomain: acc.withinDomain,
      crossDomain: acc.crossDomain,
      declaredOrder: declaredOrderOf(from, to),
    });
  }
  edges.sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const nodes: RoleQuotientNode[] = rolesOrdered.map((role) => ({
    role,
    stratum: roleStratum(role),
    packages: pkgCount.get(role) ?? 0,
    selfLoop: selfLoop.get(role) ?? 0,
  }));

  const rankedRoles = rolesOrdered.filter((r) => r !== NO_ROLE);
  const entangled = entangledRoleClasses(rankedRoles, adj)
    // Present each class in declared order for a stable reading.
    .map((c) => [...c].sort((a, b) => rolesOrdered.indexOf(a) - rolesOrdered.indexOf(b)));
  const againstDeclared = edges.filter((e) => e.declaredOrder === "against");

  return {
    kind: "jsnode.role-quotient",
    roles: Object.freeze(rolesOrdered),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    order: rolesOrdered.length,
    size: edges.length,
    withinDomainEdges,
    crossDomainEdges,
    acyclic: entangled.length === 0,
    entangled: Object.freeze(entangled.map((c) => Object.freeze(c))),
    againstDeclared: Object.freeze(againstDeclared),
  };
}
