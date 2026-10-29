/**
 * role-catalog — the workspace read along its *role* facet, as a defined
 * vocabulary.
 *
 * {@link ./domain.mjs} reads the workspace along the Personality facet (the
 * subject prefix: meme, agent, web…). This is the dual catalog on the Energy
 * facet — the role suffix (algebra, topology, codecs…) — but with the piece the
 * domain side has no equivalent of: every role is a *defined concept*. The
 * meaning of each role has lived only in prose (the layer semantics authored in
 * `LANGUAGE-MIGRATION.md`, freed into `ROLE_LEXICON` by jsnode-topology); this
 * joins that lexicon to the live workspace, so each role carries both its
 * authored definition and the packages that actually instantiate it, across
 * which domains, with which cross-role dependency.
 *
 * Like the domain atlas, descriptions are taken verbatim from the packages
 * themselves and role glosses verbatim from `ROLE_LEXICON`; nothing here is
 * synthesised. Pure over the dependency graph; no I/O.
 */
import { packageCoordinate, JSNODE_ROLES, ROLE_LEXICON, roleConcept, roleTerm } from "@red-cup-engineering/jsnode-topology";
import type { JSNodeRole, JSNodeRoleClass, JSNodeLayer } from "@red-cup-engineering/jsnode-topology";
import type { WorkspaceDependencyGraph } from "./graph.mjs";

/** One package as a member of its role: enough to render a catalog row, with the
 *  domain it sits in (the other facet) carried alongside. */
export interface RoleMember {
  readonly name: string;
  /** The domain (Personality facet) this member sits in. */
  readonly domain: string;
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

/** One role as a catalog entry: its defined concept (from `ROLE_LEXICON`) joined
 *  to the packages that instantiate it and their cross-role dependency. */
export interface RoleCatalogEntry {
  readonly role: JSNodeRole;
  /** The meme-floor / RDF term for this role (`jsnode.role.<role>`). */
  readonly term: string;
  /** Declared stratum position (0 = algebra, the base). */
  readonly stratum: number;
  readonly classification: JSNodeRoleClass;
  /** The authored one-line definition, verbatim from `ROLE_LEXICON`. */
  readonly gloss: string;
  /** Where the gloss is lifted from (provenance). */
  readonly source: string;
  /** Members, sorted by domain then name. */
  readonly members: readonly RoleMember[];
  readonly size: number;
  /** Domains that instantiate this role, sorted — the role's subject coverage. */
  readonly domains: readonly string[];
  readonly domainCount: number;
  /** Layers (lib/apps/services/sites/ops) this role spans, declared order. */
  readonly layers: readonly JSNodeLayer[];
  /** Other roles this role's packages depend on (cross-role imports), in stratum order. */
  readonly dependsOn: readonly JSNodeRole[];
  /** Other roles whose packages depend on this role, in stratum order. */
  readonly dependedOnBy: readonly JSNodeRole[];
  /** Dependency edges with *both* endpoints in this role — its within-role cohesion. */
  readonly internalEdges: number;
}

/** The role catalog: the workspace as the defined vocabulary of its roles. */
export interface RoleCatalog {
  readonly kind: "jsnode.role-catalog";
  /** Roles, in stratum order (the order of `JSNODE_ROLES`). */
  readonly roles: readonly RoleCatalogEntry[];
  readonly roleCount: number;
  /** Packages carrying a known role (the catalog's domain of definition). */
  readonly packageCount: number;
  /** Packages whose names carry no known role — atoms and applications. */
  readonly rolelessCount: number;
}

const LAYER_ORDER: readonly JSNodeLayer[] = ["lib", "apps", "services", "sites", "ops"];
const layerRank = (l: JSNodeLayer): number => {
  const i = LAYER_ORDER.indexOf(l);
  return i === -1 ? 99 : i;
};
const stratumOrder = (a: JSNodeRole, b: JSNodeRole): number =>
  JSNODE_ROLES.indexOf(a) - JSNODE_ROLES.indexOf(b);

/** Join `ROLE_LEXICON` to the live workspace: group packages by role, gather
 *  each role's members, subject coverage, layer span, and cross-role dependency.
 *  Pure over the dependency graph. Only packages whose names carry a known role
 *  enter a role entry; role-less packages are counted but not catalogued (they
 *  instantiate no role functor). */
export function roleCatalog(graph: WorkspaceDependencyGraph): RoleCatalog {
  const roleOf = new Map<string, JSNodeRole | null>();
  const domainByName = new Map<string, string>();
  const dependentsOf = new Map<string, number>();
  for (const n of graph.nodes) {
    const c = packageCoordinate(n.name);
    roleOf.set(n.name, c.role);
    domainByName.set(n.name, c.domain);
    dependentsOf.set(n.name, 0);
  }
  for (const e of graph.edges) {
    if (dependentsOf.has(e.to)) dependentsOf.set(e.to, (dependentsOf.get(e.to) ?? 0) + 1);
  }

  // Cross-role import/importer sets and within-role edge counts.
  const imports = new Map<JSNodeRole, Set<JSNodeRole>>();
  const importers = new Map<JSNodeRole, Set<JSNodeRole>>();
  const internal = new Map<JSNodeRole, number>();
  for (const role of JSNODE_ROLES) {
    imports.set(role, new Set());
    importers.set(role, new Set());
    internal.set(role, 0);
  }
  for (const e of graph.edges) {
    const a = roleOf.get(e.from) ?? null;
    const b = roleOf.get(e.to) ?? null;
    if (a === null || b === null) continue; // role-less endpoint: not attributable to a role
    if (a === b) {
      internal.set(a, (internal.get(a) ?? 0) + 1);
    } else {
      imports.get(a)!.add(b);
      importers.get(b)!.add(a);
    }
  }

  // Members per role.
  const membersOf = new Map<JSNodeRole, RoleMember[]>();
  for (const role of JSNODE_ROLES) membersOf.set(role, []);
  let rolelessCount = 0;
  for (const n of graph.nodes) {
    const c = packageCoordinate(n.name);
    if (c.role === null) {
      rolelessCount++;
      continue;
    }
    membersOf.get(c.role)!.push({
      name: n.name,
      domain: c.domain,
      qualifier: c.qualifier,
      layer: n.layer,
      version: n.version,
      description: n.description,
      dependencies: n.dependencies.length,
      dependents: dependentsOf.get(n.name) ?? 0,
    });
  }

  const roles: RoleCatalogEntry[] = ROLE_LEXICON.map((concept) => {
    const members = membersOf.get(concept.role)!;
    members.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));
    const domains = [...new Set(members.map((m) => m.domain))].sort();
    const layers = [...new Set(members.map((m) => m.layer))].sort((a, b) => layerRank(a) - layerRank(b));
    const dependsOn = [...(imports.get(concept.role) ?? [])].sort(stratumOrder);
    const dependedOnBy = [...(importers.get(concept.role) ?? [])].sort(stratumOrder);
    return {
      role: concept.role,
      term: roleTerm(concept.role),
      stratum: concept.stratum,
      classification: concept.classification,
      gloss: concept.gloss,
      source: concept.source,
      members: Object.freeze(members),
      size: members.length,
      domains: Object.freeze(domains),
      domainCount: domains.length,
      layers: Object.freeze(layers),
      dependsOn: Object.freeze(dependsOn),
      dependedOnBy: Object.freeze(dependedOnBy),
      internalEdges: internal.get(concept.role) ?? 0,
    };
  });

  return {
    kind: "jsnode.role-catalog",
    roles: Object.freeze(roles),
    roleCount: roles.length,
    packageCount: roles.reduce((a, r) => a + r.size, 0),
    rolelessCount,
  };
}

/** One role's catalog entry (or undefined if the role string is unknown).
 *  Convenience for the per-role surface. */
export function roleCatalogEntry(graph: WorkspaceDependencyGraph, role: string): RoleCatalogEntry | undefined {
  if (!(JSNODE_ROLES as readonly string[]).includes(role)) return undefined;
  return roleCatalog(graph).roles.find((r) => r.role === role);
}

// Keep roleConcept reachable to consumers reading a single concept without a graph.
export { roleConcept };
