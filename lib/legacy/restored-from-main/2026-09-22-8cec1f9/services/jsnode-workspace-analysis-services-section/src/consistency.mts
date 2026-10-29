/**
 * consistency — is the workspace internally consistent? (the normie health read)
 *
 * A workspace drifts: one package on an old Node engine, three without a test
 * script, a toolchain dependency pinned two ways. None of that shows in the
 * dependency DAG or the role grid, yet it is the first thing a maintainer wants.
 * This module reports it, with no reference to the naming convention:
 *
 *   - Node engine spread: the distinct `engines.node` ranges and who is on each,
 *     plus the packages that declare none.
 *   - Script coverage: the scripts most packages define, and which packages are
 *     missing each — "everyone has build & test except these". The common set is
 *     derived from frequency, not hard-coded, so it fits any workspace.
 *   - Module-type spread (ESM vs CommonJS), and the plain hygiene gaps:
 *     packages with no description, no license.
 *   - The dependency drift count, folded in from {@link workspaceDependencies}
 *     so this one page is the whole health view.
 *
 * Pure over the workspace carrier; no I/O.
 */
import type { JSNodeWorkspace, PackageLifecycle, PackageMaturity } from "@red-cup-engineering/jsnode-topology";
import { workspaceDependencies } from "./dependencies.mjs";

/** One distinct `engines.node` range and the packages that declare it. */
export interface EngineBand {
  readonly range: string;
  readonly packages: readonly string[];
}

/** Coverage of one script across the workspace: how many packages define it and
 *  which of the packages that have *any* scripts are missing it. */
export interface ScriptCoverage {
  readonly script: string;
  readonly have: number;
  readonly missing: readonly string[];
}

/** One module-type band (ESM / CommonJS / unstated) and its members. */
export interface ModuleTypeBand {
  readonly type: string;
  readonly count: number;
  readonly packages: readonly string[];
}

/** The workspace consistency report — the convention-agnostic health view.
 *
 *  The hygiene gaps below count only `active` packages: a deprecated package on
 *  its way out, or an abandoned one intentionally frozen, should not be nagged
 *  for an old engine or a missing script — that pressure is for the live set. */
export interface WorkspaceConsistency {
  readonly kind: "jsnode.consistency";
  readonly packageCount: number;
  /** Active packages — the set the hygiene gaps are measured against. */
  readonly activeCount: number;
  /** Package counts by lifecycle (active/maintenance/deprecated/abandoned). */
  readonly lifecycleCounts: Readonly<Record<PackageLifecycle, number>>;
  /** Package counts by maturity (experimental/alpha/beta/stable). */
  readonly maturityCounts: Readonly<Record<PackageMaturity, number>>;
  /** Packages exempted from the hygiene gaps (deprecated or abandoned). */
  readonly exempt: readonly string[];
  /** Distinct `engines.node` ranges, most common first. */
  readonly nodeEngines: readonly EngineBand[];
  /** Packages that declare no `engines.node`. */
  readonly noNodeEngine: readonly string[];
  /** Coverage of the scripts most packages define (frequency-derived). */
  readonly scripts: readonly ScriptCoverage[];
  /** Packages that define no scripts at all. */
  readonly noScripts: readonly string[];
  /** ESM / CommonJS / unstated split. */
  readonly moduleTypes: readonly ModuleTypeBand[];
  /** Packages with an empty description. */
  readonly missingDescription: readonly string[];
  /** Packages with no license field. */
  readonly missingLicense: readonly string[];
  /** Count of dependencies pinned at divergent versions (the drift). */
  readonly driftCount: number;
  /** The drifting dependency names, most-divergent first. */
  readonly driftNames: readonly string[];
}

// A script is "common" — worth reporting coverage of — when at least this
// fraction of the packages that have any scripts define it. Keeps the report to
// the scripts a workspace clearly expects of itself, not every one-off task.
const COMMON_SCRIPT_FRACTION = 0.25;

export function workspaceConsistency(workspace: JSNodeWorkspace): WorkspaceConsistency {
  const all = [...workspace.packages].sort((a, b) => a.name.localeCompare(b.name));
  const n = all.length;
  // Hygiene is measured against the *active* set only: a deprecated or abandoned
  // package is not held to the live workspace's standards. Spreads (engines,
  // module systems, lifecycle, maturity) still describe every package.
  const pkgs = all.filter((p) => p.lifecycle === "active");
  const exempt = all.filter((p) => p.lifecycle !== "active").map((p) => p.name);

  // Lifecycle and maturity spreads, over every package.
  const lifecycleCounts = { active: 0, maintenance: 0, deprecated: 0, abandoned: 0 } as Record<PackageLifecycle, number>;
  const maturityCounts = { experimental: 0, alpha: 0, beta: 0, stable: 0 } as Record<PackageMaturity, number>;
  for (const p of all) {
    lifecycleCounts[p.lifecycle]++;
    maturityCounts[p.maturity]++;
  }

  // Node engines (spread over all; the gap — no engine — over active only).
  const engineBands = new Map<string, string[]>();
  const noNodeEngine: string[] = [];
  for (const p of all) {
    const node = p.manifest.engines["node"];
    if (node !== undefined) (engineBands.get(node) ?? engineBands.set(node, []).get(node)!).push(p.name);
  }
  for (const p of pkgs) if (p.manifest.engines["node"] === undefined) noNodeEngine.push(p.name);
  const nodeEngines: EngineBand[] = [...engineBands.entries()]
    .map(([range, packages]) => ({ range, packages: Object.freeze(packages) }))
    .sort((a, b) => b.packages.length - a.packages.length || a.range.localeCompare(b.range));

  // Script coverage over the active set: count each script name, keep the common
  // ones, list which active packages lack them.
  const withScripts = pkgs.filter((p) => p.manifest.scripts.length > 0);
  const noScripts = pkgs.filter((p) => p.manifest.scripts.length === 0).map((p) => p.name);
  const scriptCount = new Map<string, number>();
  for (const p of withScripts) {
    for (const s of p.manifest.scripts) scriptCount.set(s, (scriptCount.get(s) ?? 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(withScripts.length * COMMON_SCRIPT_FRACTION));
  const scripts: ScriptCoverage[] = [...scriptCount.entries()]
    .filter(([, c]) => c >= threshold)
    .map(([script, have]) => ({
      script,
      have,
      missing: Object.freeze(withScripts.filter((p) => !p.manifest.scripts.includes(script)).map((p) => p.name)),
    }))
    .sort((a, b) => b.have - a.have || a.script.localeCompare(b.script));

  // Module type spread, over all packages.
  const typeBands = new Map<string, string[]>();
  for (const p of all) {
    const t = p.manifest.moduleType ?? "unstated";
    (typeBands.get(t) ?? typeBands.set(t, []).get(t)!).push(p.name);
  }
  const moduleTypes: ModuleTypeBand[] = [...typeBands.entries()]
    .map(([type, packages]) => ({ type, count: packages.length, packages: Object.freeze(packages) }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  const drift = workspaceDependencies(workspace).drift;

  return {
    kind: "jsnode.consistency",
    packageCount: n,
    activeCount: pkgs.length,
    lifecycleCounts: Object.freeze(lifecycleCounts),
    maturityCounts: Object.freeze(maturityCounts),
    exempt: Object.freeze(exempt),
    nodeEngines: Object.freeze(nodeEngines),
    noNodeEngine: Object.freeze(noNodeEngine),
    scripts: Object.freeze(scripts),
    noScripts: Object.freeze(noScripts),
    moduleTypes: Object.freeze(moduleTypes),
    missingDescription: Object.freeze(pkgs.filter((p) => p.description.trim() === "").map((p) => p.name)),
    missingLicense: Object.freeze(pkgs.filter((p) => p.manifest.license === null).map((p) => p.name)),
    driftCount: drift.length,
    driftNames: Object.freeze(drift.map((d) => d.name)),
  };
}
