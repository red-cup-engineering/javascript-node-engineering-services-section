/**
 * type-flow — the workspace's type *category*, read across packages.
 *
 * javascript-computer workspaceTypeIndex gives the objects (types) and morphisms (functions, each with
 * its domain and codomain type names) as two flat lists. symbol-graph.mts wires
 * them into objects-and-morphisms — but only *within one package*, because it
 * resolves a type reference by intersecting against that package's own type
 * names. The composition that makes a category a category — `f: A → B` followed
 * by `g: B → C`, matched by codomain-meets-domain *across* packages — is left
 * implicit in every surface.
 *
 * This computes it. A **composition edge** `A --[f]--> B` exists when some
 * function `f` carries type `A` in its domain and produces type `B` as its
 * codomain. The edges are exactly the valid one-step compositions: composition
 * type-checks precisely when a codomain meets a domain
 * (identity-mismatch-is-the-type-error), so this graph is the workspace's
 * type-flow category, and reachability in it answers "how do I turn an A into a
 * C" with a concrete function pipeline.
 *
 * **Addressable-only.** Type names are *not* globally unique — `Options`,
 * `Context`, `Result`, `JsonValue` are each declared in several packages. Bare
 * name-matching across packages would fuse distinct types into one node and draw
 * compositions that do not type-check — a false legibility. So edges are drawn
 * only between *addressable* type names (declared in exactly one package); names
 * declared in more than one package are carried as `ambiguousNames` and left out
 * of the confident graph, the same confident/candidate split the workspace uses
 * for internal citations. Foreign/primitive types (`string`, `Promise`, `void`)
 * are never declared in the index, so they are naturally excluded — they would
 * otherwise be hubs through which everything trivially reaches everything.
 *
 * Pure over a `WorkspaceTypeIndex`: no filesystem, no rendering.
 */
import type { WorkspaceTypeIndex } from "@red-cup-engineering/javascript-computer";

/** A type that participates in the flow: an addressable carrier with the count
 *  of functions that produce it (it is their codomain) and consume it (it is in
 *  their domain) — the size of the two halves of its hom-functor. */
export interface TypeFlowNode {
  readonly name: string;
  /** The single package that declares this type (addressable ⇒ exactly one). */
  readonly pkg: string;
  readonly kind: string;
  /** Functions whose codomain is this type — the arrows *into* it (Yoneda h_A). */
  readonly producers: number;
  /** Functions taking this type in their domain — the arrows *out of* it. */
  readonly consumers: number;
}

/** A composition edge: function `fn` (in `pkg`) takes `from` and produces `to`. */
export interface TypeFlowEdge {
  readonly from: string;
  readonly to: string;
  readonly fn: string;
  readonly pkg: string;
}

/** A function named as a producer or consumer of a type, with a human signature. */
export interface TypeFlowFunctionRef {
  readonly pkg: string;
  readonly name: string;
  readonly signature: string;
}

/** A reference to an addressable type by its name and its single declaring
 *  package — enough to mint its package-scoped RDF term and link its page. */
export interface TypeRef {
  readonly name: string;
  readonly pkg: string;
}

export interface WorkspaceTypeFlow {
  readonly kind: "jsnode.type-flow";
  /** Addressable types that appear in at least one function signature. */
  readonly order: number;
  /** Composition edges between addressable types (deduped by from|to|fn|pkg). */
  readonly size: number;
  /** Distinct packages contributing an observed declaration surface. */
  readonly packages: number;
  /** Addressable type names total (declared in exactly one package). */
  readonly addressable: number;
  /** Type names declared in more than one package — left out of the graph. */
  readonly ambiguous: number;
  /** Edges whose source and target types live in different packages — the
   *  workspace's transformation seams, where a carrier crosses a package
   *  boundary through a function. */
  readonly crossPackageEdges: number;
  /** Addressable in-flow types no function produces — pure inputs / raw
   *  materials (their hom-functor's arrows-in half is empty). */
  readonly sources: readonly string[];
  /** Addressable in-flow types no function consumes — terminal outputs. */
  readonly sinks: readonly string[];
  /** The most-connected carriers, by producers + consumers. */
  readonly hubs: readonly TypeFlowNode[];
  readonly nodes: readonly TypeFlowNode[];
  readonly edges: readonly TypeFlowEdge[];
  /** Type names declared in more than one package, sorted — the candidate set a
   *  per-type lookup disambiguates against. */
  readonly ambiguousNames: readonly string[];
}

/** One type's hom-functor presentation: the functions that produce and consume
 *  it (arrows in / out), the addressable types one composition step away, and
 *  the types reachable forward / backward through composition. The Yoneda
 *  reading — an object is what flows into and out of it. */
export interface TypeFlowNeighbourhood {
  readonly kind: "jsnode.type-flow-neighbourhood";
  readonly name: string;
  readonly pkg: string;
  readonly typeKind: string;
  readonly producedBy: readonly TypeFlowFunctionRef[];
  readonly consumedBy: readonly TypeFlowFunctionRef[];
  /** Addressable types one step upstream: `X transforms-to name`. */
  readonly upstream: readonly TypeRef[];
  /** Addressable types one step downstream: `name transforms-to Y`. */
  readonly downstream: readonly TypeRef[];
  /** All addressable types reachable forward by composition (BFS, each once). */
  readonly reaches: readonly TypeRef[];
  /** All addressable types from which this one is reachable (backward BFS). */
  readonly reachableFrom: readonly TypeRef[];
}

// Identifier tokens of a type expression, the same crude resolver symbol-graph
// uses: `Map<string, Bar>` → ["Map","string","Bar"]. Intersected with the
// addressable type set, this resolves a structured reference to its carriers
// without a full type parser.
const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const identsOf = (typeExpr: string): readonly string[] => typeExpr.match(IDENT) ?? [];

const tidy = (s: string): string => s.replace(/\s+/g, " ").trim();

const signatureOf = (name: string, domain: readonly string[], codomain?: string): string =>
  `${name}(${domain.map(tidy).join(", ")})${codomain ? ` → ${tidy(codomain)}` : ""}`;

/** Build the type-flow category from the workspace type index. */
export function workspaceTypeFlow(index: WorkspaceTypeIndex): WorkspaceTypeFlow {
  // Addressability: a name is addressable iff exactly one package declares it.
  const declarers = new Map<string, Set<string>>();
  const kindOf = new Map<string, string>();
  for (const t of index.types) {
    let set = declarers.get(t.name);
    if (set === undefined) { set = new Set(); declarers.set(t.name, set); }
    set.add(t.pkg);
    if (!kindOf.has(t.name)) kindOf.set(t.name, t.kind);
  }
  const pkgOf = new Map<string, string>();
  const ambiguousNames: string[] = [];
  for (const [name, set] of declarers) {
    if (set.size === 1) pkgOf.set(name, [...set][0]!);
    else ambiguousNames.push(name);
  }
  ambiguousNames.sort();
  const addressable = (n: string): boolean => pkgOf.has(n);

  // Edges + per-type producer/consumer counts, over every function. A function
  // contributes one edge per (addressable domain type × addressable codomain
  // type); a multi-argument function honestly yields several. Self-edges drop.
  const edges: TypeFlowEdge[] = [];
  const edgeSeen = new Set<string>();
  const producers = new Map<string, number>();
  const consumers = new Map<string, number>();
  const inFlow = new Set<string>();
  const packages = new Set<string>();

  // Deduplicate functions by (pkg, name), the same convention symbol-graph uses:
  // a package may declare or re-export `f` from several modules, but it is one
  // morphism. Counting it once keeps the hub magnitudes here consistent with the
  // deduplicated producedBy/consumedBy lists on the per-type pages.
  const fnSeen = new Set<string>();
  for (const f of index.functions) {
    packages.add(f.pkg);
    const fnKey = `${f.pkg}|${f.name}`;
    if (fnSeen.has(fnKey)) continue;
    fnSeen.add(fnKey);
    const domTypes = new Set<string>();
    for (const d of f.domain) for (const id of identsOf(d)) if (addressable(id)) domTypes.add(id);
    const codTypes = new Set<string>();
    if (f.codomain !== undefined) for (const id of identsOf(f.codomain)) if (addressable(id)) codTypes.add(id);

    for (const a of domTypes) {
      consumers.set(a, (consumers.get(a) ?? 0) + 1);
      inFlow.add(a);
    }
    for (const b of codTypes) {
      producers.set(b, (producers.get(b) ?? 0) + 1);
      inFlow.add(b);
    }
    for (const a of domTypes) {
      for (const b of codTypes) {
        if (a === b) continue;
        const key = `${a}|${b}|${f.pkg}|${f.name}`;
        if (edgeSeen.has(key)) continue;
        edgeSeen.add(key);
        edges.push({ from: a, to: b, fn: f.name, pkg: f.pkg });
      }
    }
  }

  const nodes: TypeFlowNode[] = [];
  for (const name of inFlow) {
    nodes.push({
      name,
      pkg: pkgOf.get(name)!,
      kind: kindOf.get(name) ?? "type",
      producers: producers.get(name) ?? 0,
      consumers: consumers.get(name) ?? 0,
    });
  }
  nodes.sort((a, b) => a.name.localeCompare(b.name));

  const crossPackageEdges = edges.reduce(
    (acc, e) => acc + (pkgOf.get(e.from) !== pkgOf.get(e.to) ? 1 : 0),
    0,
  );
  const sources = nodes.filter((n) => n.producers === 0).map((n) => n.name);
  const sinks = nodes.filter((n) => n.consumers === 0).map((n) => n.name);
  const hubs = [...nodes]
    .sort((a, b) => b.producers + b.consumers - (a.producers + a.consumers))
    .slice(0, 20);

  return {
    kind: "jsnode.type-flow",
    order: nodes.length,
    size: edges.length,
    packages: packages.size,
    addressable: pkgOf.size,
    ambiguous: ambiguousNames.length,
    crossPackageEdges,
    sources,
    sinks,
    hubs,
    nodes,
    edges,
    ambiguousNames,
  };
}

// Forward / backward adjacency over composition edges, computed on demand for a
// neighbourhood read (cheap relative to the edge build).
function adjacency(edges: readonly TypeFlowEdge[]): {
  out: Map<string, Set<string>>;
  in: Map<string, Set<string>>;
} {
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  const push = (m: Map<string, Set<string>>, k: string, v: string): void => {
    let s = m.get(k);
    if (s === undefined) { s = new Set(); m.set(k, s); }
    s.add(v);
  };
  for (const e of edges) { push(out, e.from, e.to); push(inn, e.to, e.from); }
  return { out, in: inn };
}

// BFS the reachable set from a seed over an adjacency map (each node once).
function reachable(adj: Map<string, Set<string>>, seed: string): string[] {
  const seen = new Set<string>();
  const queue = [seed];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nxt of adj.get(cur) ?? []) {
      if (nxt === seed || seen.has(nxt)) continue;
      seen.add(nxt);
      queue.push(nxt);
    }
  }
  return [...seen].sort();
}

/** The hom-functor presentation of one addressable type. Returns `undefined`
 *  when the name is not an addressable in-flow type (unknown, foreign, or
 *  ambiguous — the caller distinguishes ambiguous via `flow.ambiguousNames`). */
export function typeFlowNeighbourhood(
  index: WorkspaceTypeIndex,
  flow: WorkspaceTypeFlow,
  name: string,
): TypeFlowNeighbourhood | undefined {
  const node = flow.nodes.find((n) => n.name === name);
  if (node === undefined) return undefined;

  const seenP = new Set<string>();
  const seenC = new Set<string>();
  const producedBy: TypeFlowFunctionRef[] = [];
  const consumedBy: TypeFlowFunctionRef[] = [];
  for (const f of index.functions) {
    const cod = f.codomain !== undefined ? new Set(identsOf(f.codomain)) : new Set<string>();
    const dom = new Set<string>();
    for (const d of f.domain) for (const id of identsOf(d)) dom.add(id);
    if (cod.has(name)) {
      const key = `${f.pkg}|${f.name}`;
      if (!seenP.has(key)) {
        seenP.add(key);
        producedBy.push({ pkg: f.pkg, name: f.name, signature: signatureOf(f.name, f.domain, f.codomain) });
      }
    }
    if (dom.has(name)) {
      const key = `${f.pkg}|${f.name}`;
      if (!seenC.has(key)) {
        seenC.add(key);
        consumedBy.push({ pkg: f.pkg, name: f.name, signature: signatureOf(f.name, f.domain, f.codomain) });
      }
    }
  }
  const bySig = (a: TypeFlowFunctionRef, b: TypeFlowFunctionRef): number =>
    a.pkg.localeCompare(b.pkg) || a.name.localeCompare(b.name);
  producedBy.sort(bySig);
  consumedBy.sort(bySig);

  const pkgOf = new Map(flow.nodes.map((n) => [n.name, n.pkg]));
  const ref = (n: string): TypeRef => ({ name: n, pkg: pkgOf.get(n) ?? "?" });
  const refs = (names: readonly string[]): TypeRef[] => names.map(ref);

  const adj = adjacency(flow.edges);
  const upstream = refs([...(adj.in.get(name) ?? [])].sort());
  const downstream = refs([...(adj.out.get(name) ?? [])].sort());

  return {
    kind: "jsnode.type-flow-neighbourhood",
    name,
    pkg: node.pkg,
    typeKind: node.kind,
    producedBy,
    consumedBy,
    upstream,
    downstream,
    reaches: refs(reachable(adj.out, name)),
    reachableFrom: refs(reachable(adj.in, name)),
  };
}

/** One shortest composition pipeline from `from` to `to`, as the edge sequence
 *  realizing it, or `null` when `to` is unreachable from `from`. Each edge
 *  carries the function (and its package) that performs that step. BFS over the
 *  type graph — shortest by number of steps, each type visited once. */
export function shortestPipeline(
  flow: WorkspaceTypeFlow,
  from: string,
  to: string,
): readonly TypeFlowEdge[] | null {
  if (from === to) return [];
  // First edge out of each type, by target — enough to reconstruct one path.
  const byFrom = new Map<string, TypeFlowEdge[]>();
  for (const e of flow.edges) {
    let list = byFrom.get(e.from);
    if (list === undefined) { list = []; byFrom.set(e.from, list); }
    list.push(e);
  }
  const prev = new Map<string, TypeFlowEdge>();
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of byFrom.get(cur) ?? []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      prev.set(e.to, e);
      if (e.to === to) {
        const path: TypeFlowEdge[] = [];
        let step: string = to;
        while (step !== from) {
          const incoming: TypeFlowEdge | undefined = prev.get(step);
          if (incoming === undefined) break;
          path.unshift(incoming);
          step = incoming.from;
        }
        return path;
      }
      queue.push(e.to);
    }
  }
  return null;
}
