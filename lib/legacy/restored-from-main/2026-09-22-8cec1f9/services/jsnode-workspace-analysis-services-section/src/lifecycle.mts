/**
 * lifecycle — the workspace read by disposition and maturity.
 *
 * Two facts each package carries beyond its coordinates: the team's *intent*
 * (active / maintenance / deprecated / abandoned, from keywords) and its release
 * *maturity* (experimental / alpha / beta / stable, from the version). They get
 * opposite treatment elsewhere — deprecated packages are held out of the default
 * picture, abandoned ones are exempt from consistency pressure — and this module
 * gathers the cohorts plus the one actionable thing the split implies:
 *
 *   - migration debt: an *active* package still depending on a *deprecated* one.
 *     Those edges are the work of actually retiring a package; deprecating a
 *     thing nothing depends on is free, deprecating a hub is not.
 *   - the consumers of abandoned packages: who is relying on the frozen contract,
 *     so a change to it (which should not happen) would have a known blast radius.
 *
 * Pure over the dependency graph; no I/O.
 */
import type { PackageLifecycle, PackageMaturity } from "@red-cup-engineering/jsnode-topology";
import type { WorkspaceDependencyGraph } from "./graph.mjs";

const LIFECYCLES: readonly PackageLifecycle[] = ["active", "maintenance", "deprecated", "abandoned"];
const MATURITIES: readonly PackageMaturity[] = ["experimental", "alpha", "beta", "stable"];

/** One non-active package with the packages that still depend on it. */
export interface LifecycleMember {
  readonly name: string;
  readonly lifecycle: PackageLifecycle;
  readonly maturity: PackageMaturity;
  /** Workspace packages that depend on it. */
  readonly dependents: readonly string[];
  /** Of those, the ones that are themselves `active` — the dependents that
   *  actually matter (a deprecated package depended on only by other deprecated
   *  packages is already isolated). */
  readonly activeDependents: readonly string[];
}

/** A migration-debt edge: an active package depends on a deprecated one. */
export interface MigrationDebtEdge {
  readonly from: string;
  readonly to: string;
}

/** The workspace lifecycle report. */
export interface WorkspaceLifecycle {
  readonly kind: "jsnode.lifecycle";
  readonly packageCount: number;
  /** Package names by lifecycle status, every status present (possibly empty). */
  readonly byLifecycle: Readonly<Record<PackageLifecycle, readonly string[]>>;
  /** Package names by maturity stage, every stage present (possibly empty). */
  readonly byMaturity: Readonly<Record<PackageMaturity, readonly string[]>>;
  /** Deprecated packages with their dependents — the retirement queue, hardest
   *  (most active-dependents) first. */
  readonly deprecated: readonly LifecycleMember[];
  /** Abandoned packages with their dependents — the frozen contracts and who
   *  rests on them. */
  readonly abandoned: readonly LifecycleMember[];
  /** Every active→deprecated dependency edge — the migration debt. */
  readonly migrationDebt: readonly MigrationDebtEdge[];
  readonly activeCount: number;
}

export function workspaceLifecycle(graph: WorkspaceDependencyGraph): WorkspaceLifecycle {
  const lifeOf = new Map<string, PackageLifecycle>();
  const matOf = new Map<string, PackageMaturity>();
  const dependents = new Map<string, string[]>();
  for (const n of graph.nodes) {
    lifeOf.set(n.name, n.lifecycle);
    matOf.set(n.name, n.maturity);
    dependents.set(n.name, []);
  }
  for (const e of graph.edges) {
    if (dependents.has(e.to)) dependents.get(e.to)!.push(e.from);
  }

  const byLifecycle = Object.fromEntries(LIFECYCLES.map((l) => [l, [] as string[]])) as Record<PackageLifecycle, string[]>;
  const byMaturity = Object.fromEntries(MATURITIES.map((m) => [m, [] as string[]])) as Record<PackageMaturity, string[]>;
  for (const n of graph.nodes) {
    byLifecycle[n.lifecycle].push(n.name);
    byMaturity[n.maturity].push(n.name);
  }
  for (const l of LIFECYCLES) byLifecycle[l].sort();
  for (const m of MATURITIES) byMaturity[m].sort();

  const memberOf = (name: string): LifecycleMember => {
    const deps = (dependents.get(name) ?? []).slice().sort();
    return {
      name,
      lifecycle: lifeOf.get(name) ?? "active",
      maturity: matOf.get(name) ?? "experimental",
      dependents: Object.freeze(deps),
      activeDependents: Object.freeze(deps.filter((d) => (lifeOf.get(d) ?? "active") === "active")),
    };
  };

  const deprecated = byLifecycle.deprecated
    .map(memberOf)
    .sort((a, b) => b.activeDependents.length - a.activeDependents.length || a.name.localeCompare(b.name));
  const abandoned = byLifecycle.abandoned
    .map(memberOf)
    .sort((a, b) => b.dependents.length - a.dependents.length || a.name.localeCompare(b.name));

  const deprecatedSet = new Set(byLifecycle.deprecated);
  const migrationDebt: MigrationDebtEdge[] = [];
  for (const e of graph.edges) {
    if (deprecatedSet.has(e.to) && (lifeOf.get(e.from) ?? "active") === "active") {
      migrationDebt.push({ from: e.from, to: e.to });
    }
  }
  migrationDebt.sort((a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from));

  return {
    kind: "jsnode.lifecycle",
    packageCount: graph.nodes.length,
    byLifecycle: Object.freeze(
      Object.fromEntries(LIFECYCLES.map((l) => [l, Object.freeze(byLifecycle[l])])),
    ) as Record<PackageLifecycle, readonly string[]>,
    byMaturity: Object.freeze(
      Object.fromEntries(MATURITIES.map((m) => [m, Object.freeze(byMaturity[m])])),
    ) as Record<PackageMaturity, readonly string[]>,
    deprecated: Object.freeze(deprecated),
    abandoned: Object.freeze(abandoned),
    migrationDebt: Object.freeze(migrationDebt),
    activeCount: byLifecycle.active.length,
  };
}
