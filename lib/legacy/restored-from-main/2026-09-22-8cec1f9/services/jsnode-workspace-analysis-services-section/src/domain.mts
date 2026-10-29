/**
 * domain — the workspace read along its *other* facet.
 *
 * Every package is named `<domain>-<role>`: `meme-topology`, `agent-algebra`,
 * `web-codecs-http`. That is a two-facet classification in the sense of
 * Ranganathan's Colon Classification — the role suffix is the *Energy* facet
 * (the operation: algebra, topology, codecs…), the domain prefix is the
 * *Personality* facet (the focal subject: meme, agent, web…). The hyphen is the
 * colon. {@link ./analysis.mjs} already quotients the dependency graph onto the
 * role facet (`roleQuotientGraph`) and lays the full grid out
 * (`roleDomainGrid`). This module supplies the missing dual: the projection onto
 * the *domain* facet.
 *
 * Two readings, mirroring the role side:
 *   - {@link domainAtlas}: the catalog. Each domain is a union of the packages
 *     sharing its prefix — a namespace — gathered with their descriptions,
 *     roles, layers, and the domains it imports / is imported by. This is the
 *     semantic surface: what each subject *is*, not just who depends on whom.
 *   - {@link domainQuotientGraph}: the analytic dual of `roleQuotientGraph`.
 *     Contract every package to its domain and keep the domain→domain
 *     dependency multigraph: which subjects depend on which, whether the subject
 *     graph is acyclic, which subjects mutually entangle.
 *
 * The two quotients partition the *same* edge set: an edge is either
 * within-domain (a self-loop of the domain quotient; a cross-role edge of the
 * role quotient) or cross-domain. So `domainQuotient.crossDomainTotal` equals
 * `roleQuotient.crossDomainEdges` and `domainQuotient.withinDomainTotal` equals
 * `roleQuotient.withinDomainEdges` — a free cross-check that the dual is exact.
 *
 * Pure functions of the dependency graph; no I/O.
 */
import { packageCoordinate, JSNODE_ROLES, domainTerm } from "@red-cup-engineering/jsnode-topology";
import type { JSNodeRole, JSNodeLayer } from "@red-cup-engineering/jsnode-topology";
import { createGraph, cycles as graphCycles } from "@red-cup-engineering/graph-data-service";
import type { WorkspaceDependencyGraph } from "./graph.mjs";

// ---------- the domain atlas (the Personality-facet catalog) ----------

/** One package as a member of its domain: enough to render a catalog row
 *  without re-reading the workspace. */
export interface DomainMember {
  readonly name: string;
  /** The role functor this package instantiates, or null when role-less. */
  readonly role: JSNodeRole | null;
  /** Any segment trailing the role (e.g. "http" in web-codecs-http). */
  readonly qualifier: string | null;
  readonly layer: JSNodeLayer;
  readonly version: string;
  readonly description: string;
  /** Workspace packages this member depends on (forward degree). */
  readonly dependencies: number;
  /** Workspace packages that depend on this member (reverse degree). */
  readonly dependents: number;
}

/** One domain — the union of packages sharing a `<domain>-` prefix, the
 *  Personality facet of the (domain, role) classification: a namespace. */
export interface DomainEntry {
  readonly domain: string;
  /** The meme-floor / RDF term for this domain (`jsnode.domain.<domain>`). */
  readonly term: string;
  /** Members, sorted by role (declared order, role-less last) then name. */
  readonly members: readonly DomainMember[];
  readonly size: number;
  /** Roles this domain instantiates, in declared order. The missing roles are a
   *  fact — coverage holes in the subject's treatment. */
  readonly roles: readonly JSNodeRole[];
  /** Layers (lib/apps/services/sites/ops) this domain spans, declared order. */
  readonly layers: readonly JSNodeLayer[];
  /** A representative one-line description for the catalog index, taken verbatim
   *  from a member (never synthesised): the package whose local name *is* the
   *  domain if it has a description, else the most-depended-on member that has
   *  one. Empty string when no member carries a description. */
  readonly synopsis: string;
  /** Which member the synopsis was taken from, or null when there is none. */
  readonly synopsisFrom: string | null;
  /** Dependency edges with *both* endpoints in this domain — the domain's
   *  internal cohesion (its quotient self-loop). */
  readonly internalEdges: number;
  /** Other domains this domain depends on (imports), sorted. */
  readonly dependsOn: readonly string[];
  /** Other domains that depend on this domain (importers), sorted. */
  readonly dependedOnBy: readonly string[];
}

/** The domain atlas: the workspace as a browsable catalog of subjects. */
export interface DomainAtlas {
  readonly kind: "jsnode.domain-atlas";
  /** Domains, largest first then alphabetical. */
  readonly domains: readonly DomainEntry[];
  readonly domainCount: number;
  readonly packageCount: number;
}

const roleRank = (r: JSNodeRole | null): number => (r === null ? 99 : JSNODE_ROLES.indexOf(r));
const LAYER_ORDER: readonly JSNodeLayer[] = ["lib", "apps", "services", "sites", "ops"];
const layerRank = (l: JSNodeLayer): number => {
  const i = LAYER_ORDER.indexOf(l);
  return i === -1 ? 99 : i;
};

/** Group the workspace's packages by domain and gather each domain's catalog
 *  entry — members with descriptions, role/layer coverage, and the domains it
 *  imports and is imported by. Pure over the dependency graph. */
export function domainAtlas(graph: WorkspaceDependencyGraph): DomainAtlas {
  // Per-package coordinate and degree, read once off the graph.
  const domainOf = new Map<string, string>();
  const dependentsOf = new Map<string, number>();
  for (const n of graph.nodes) {
    domainOf.set(n.name, packageCoordinate(n.name).domain);
    dependentsOf.set(n.name, 0);
  }
  for (const e of graph.edges) {
    if (dependentsOf.has(e.to)) dependentsOf.set(e.to, (dependentsOf.get(e.to) ?? 0) + 1);
  }

  // Cross-domain import/importer sets and internal-edge counts.
  const imports = new Map<string, Set<string>>(); // domain -> domains it depends on
  const importers = new Map<string, Set<string>>(); // domain -> domains that depend on it
  const internal = new Map<string, number>();
  for (const n of graph.nodes) {
    const d = domainOf.get(n.name)!;
    if (!imports.has(d)) imports.set(d, new Set());
    if (!importers.has(d)) importers.set(d, new Set());
    if (!internal.has(d)) internal.set(d, 0);
  }
  for (const e of graph.edges) {
    const a = domainOf.get(e.from);
    const b = domainOf.get(e.to);
    if (a === undefined || b === undefined) continue;
    if (a === b) {
      internal.set(a, (internal.get(a) ?? 0) + 1);
    } else {
      imports.get(a)!.add(b);
      importers.get(b)!.add(a);
    }
  }

  // Members per domain.
  const membersOf = new Map<string, DomainMember[]>();
  for (const n of graph.nodes) {
    const c = packageCoordinate(n.name);
    const member: DomainMember = {
      name: n.name,
      role: c.role,
      qualifier: c.qualifier,
      layer: n.layer,
      version: n.version,
      description: n.description,
      dependencies: n.dependencies.length,
      dependents: dependentsOf.get(n.name) ?? 0,
    };
    (membersOf.get(c.domain) ?? membersOf.set(c.domain, []).get(c.domain)!).push(member);
  }

  const domains: DomainEntry[] = [...membersOf.entries()].map(([domain, members]) => {
    members.sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name));
    const roles = [...new Set(members.map((m) => m.role).filter((r): r is JSNodeRole => r !== null))]
      .sort((a, b) => JSNODE_ROLES.indexOf(a) - JSNODE_ROLES.indexOf(b));
    const layers = [...new Set(members.map((m) => m.layer))].sort((a, b) => layerRank(a) - layerRank(b));

    // Representative synopsis: a member's verbatim description, never fabricated.
    // Prefer the package whose scope-stripped local name *is* the domain; else
    // the most-depended-on member; only ever a member that has a description.
    const withDesc = members.filter((m) => m.description.trim() !== "");
    const eponymous = withDesc.find((m) => packageCoordinate(m.name).local === domain);
    const repr = eponymous
      ?? [...withDesc].sort((a, b) => b.dependents - a.dependents || a.name.localeCompare(b.name))[0];

    const dependsOn = [...(imports.get(domain) ?? [])].sort();
    const dependedOnBy = [...(importers.get(domain) ?? [])].sort();
    return {
      domain,
      term: domainTerm(domain),
      members: Object.freeze(members),
      size: members.length,
      roles: Object.freeze(roles),
      layers: Object.freeze(layers),
      synopsis: repr?.description ?? "",
      synopsisFrom: repr?.name ?? null,
      internalEdges: internal.get(domain) ?? 0,
      dependsOn: Object.freeze(dependsOn),
      dependedOnBy: Object.freeze(dependedOnBy),
    };
  });

  domains.sort((a, b) => b.size - a.size || a.domain.localeCompare(b.domain));

  return {
    kind: "jsnode.domain-atlas",
    domains: Object.freeze(domains),
    domainCount: domains.length,
    packageCount: graph.nodes.length,
  };
}

/** Look one domain up in the atlas (or build a single entry). Convenience for
 *  the per-domain surface; returns undefined when the domain has no packages. */
export function domainEntry(graph: WorkspaceDependencyGraph, domain: string): DomainEntry | undefined {
  return domainAtlas(graph).domains.find((d) => d.domain === domain);
}

// ---------- the domain quotient (dual of the role quotient) ----------

/** One domain of the quotient: how many packages carry it and the multiplicity
 *  of its within-domain self-loop (its internal dependency edges). */
export interface DomainQuotientNode {
  readonly domain: string;
  readonly packages: number;
  readonly selfLoop: number;
}

/** One edge of the domain quotient: every package dependency edge whose
 *  endpoints sit in these two domains, counted with multiplicity. */
export interface DomainQuotientEdge {
  readonly from: string;
  readonly to: string;
  readonly weight: number;
}

/** The domain projection of the dependency graph: every package contracted to
 *  its domain, parallel edges and self-loops kept (the multigraph convention).
 *  The dual of `roleQuotientGraph`: where that collapses the domain axis to read
 *  the role grading, this collapses the role axis to read the subject graph —
 *  which subjects depend on which, whether that subject dependency is acyclic,
 *  and which subjects mutually entangle. */
export interface DomainQuotientGraph {
  readonly kind: "jsnode.domain-quotient";
  /** Domains present, largest (most packages) first then alphabetical. */
  readonly domains: readonly string[];
  readonly nodes: readonly DomainQuotientNode[];
  readonly edges: readonly DomainQuotientEdge[];
  readonly order: number;
  readonly size: number;
  /** Total within-domain dependency edges (sum of self-loops). Equals
   *  `roleQuotientGraph(graph).withinDomainEdges`. */
  readonly withinDomainTotal: number;
  /** Total cross-domain dependency edges (sum of off-diagonal weights). Equals
   *  `roleQuotientGraph(graph).crossDomainEdges`. */
  readonly crossDomainTotal: number;
  /** True when the cross-domain dependency relation has no cycles. */
  readonly acyclic: boolean;
  /** Strongly-connected domain classes of size > 1 — mutually-dependent
   *  subjects, the obstruction to any subject layering. Empty iff `acyclic`. */
  readonly entangled: readonly (readonly string[])[];
  /** Domains by number of distinct other domains depending on them, descending —
   *  the subjects the workspace is most built upon. */
  readonly mostDependedOn: readonly { readonly domain: string; readonly dependents: number }[];
}

/** Mutually-dependent domain classes (size > 1) over a cross-domain adjacency
 *  map that never carries a self-loop (the caller excludes those before
 *  building `adj`). Delegates to @red-cup-engineering/graph-data-service's
 *  shared Tarjan instead of a second, private copy of it. */
function stronglyConnectedDomains(domains: readonly string[], adj: Map<string, Set<string>>): string[][] {
  const graph = createGraph({ nodes: domains.map((id) => ({ id })) });
  for (const [from, targets] of adj) for (const to of targets) graph.addEdge({ from, to });
  return graphCycles(graph);
}

/** Quotient a workspace dependency graph by the domain projection. Pure over the
 *  graph; no I/O. The dual of {@link roleQuotientGraph}. */
export function domainQuotientGraph(graph: WorkspaceDependencyGraph): DomainQuotientGraph {
  const domainOf = new Map<string, string>();
  const pkgCount = new Map<string, number>();
  for (const n of graph.nodes) {
    const d = packageCoordinate(n.name).domain;
    domainOf.set(n.name, d);
    pkgCount.set(d, (pkgCount.get(d) ?? 0) + 1);
  }

  const cells = new Map<string, number>(); // "from\tto" -> weight
  const selfLoop = new Map<string, number>();
  const adj = new Map<string, Set<string>>(); // cross-domain only, for SCCs
  const importerCount = new Map<string, Set<string>>();
  let withinDomainTotal = 0;
  let crossDomainTotal = 0;
  for (const e of graph.edges) {
    const a = domainOf.get(e.from);
    const b = domainOf.get(e.to);
    if (a === undefined || b === undefined) continue;
    if (a === b) {
      selfLoop.set(a, (selfLoop.get(a) ?? 0) + 1);
      withinDomainTotal++;
    } else {
      const key = `${a}\t${b}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
      crossDomainTotal++;
      (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
      (importerCount.get(b) ?? importerCount.set(b, new Set()).get(b)!).add(a);
    }
  }

  const domains = [...pkgCount.keys()].sort(
    (a, b) => (pkgCount.get(b) ?? 0) - (pkgCount.get(a) ?? 0) || a.localeCompare(b),
  );

  const nodes: DomainQuotientNode[] = domains.map((domain) => ({
    domain,
    packages: pkgCount.get(domain) ?? 0,
    selfLoop: selfLoop.get(domain) ?? 0,
  }));

  const edges: DomainQuotientEdge[] = [...cells.entries()]
    .map(([key, weight]) => {
      const [from, to] = key.split("\t") as [string, string];
      return { from, to, weight };
    })
    .sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const entangled = stronglyConnectedDomains(domains, adj)
    .map((c) => Object.freeze([...c].sort()))
    .sort((a, b) => b.length - a.length || (a[0] ?? "").localeCompare(b[0] ?? ""));

  const mostDependedOn = domains
    .map((domain) => ({ domain, dependents: importerCount.get(domain)?.size ?? 0 }))
    .filter((d) => d.dependents > 0)
    .sort((a, b) => b.dependents - a.dependents || a.domain.localeCompare(b.domain));

  return {
    kind: "jsnode.domain-quotient",
    domains: Object.freeze(domains),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    order: domains.length,
    size: edges.length,
    withinDomainTotal,
    crossDomainTotal,
    acyclic: entangled.length === 0,
    entangled: Object.freeze(entangled),
    mostDependedOn: Object.freeze(mostDependedOn),
  };
}
