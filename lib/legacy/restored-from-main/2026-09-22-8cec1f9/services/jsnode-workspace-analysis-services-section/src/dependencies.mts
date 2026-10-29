/**
 * dependencies — the workspace's dependency surface, read plainly.
 *
 * The dependency *graph* is the internal one: workspace package → workspace
 * package. But a Node ecosystem also rests on everything it pulls from the
 * registry, and the first question anyone asks of a workspace is "what do we
 * depend on, and is it consistent?" — questions the role/spectral views never
 * answer. This module answers them, with no reference to the naming convention:
 *
 *   - {@link workspaceDependencies}: every dependency (internal and external),
 *     across every kind (runtime/dev/peer/optional), with the packages that
 *     declare it and the version ranges they pin — and the ones pinned to more
 *     than one range, the drift that bites a workspace when it isn't watched.
 *
 * Pure over the workspace carrier; no I/O.
 */
import type { JSNodeWorkspace, DependencyKind } from "@red-cup-engineering/jsnode-topology";

/** One package's use of a dependency: the kind of dependency field and the
 *  version range it pinned. */
export interface DependencyUse {
  readonly by: string;
  readonly range: string;
  readonly kind: DependencyKind;
}

/** One depended-on package, gathered across the whole workspace. */
export interface DependencyEntry {
  /** The depended-on package name (e.g. "typescript", "@emsenn/meme-topology"). */
  readonly name: string;
  /** True when the dependency resolves to another package in this workspace. */
  readonly internal: boolean;
  /** Every workspace package that declares it, with kind and range. */
  readonly uses: readonly DependencyUse[];
  /** How many workspace packages declare it. */
  readonly usedBy: number;
  /** The distinct version ranges pinned across the workspace, sorted. More than
   *  one is drift: the same dependency held at incompatible versions. */
  readonly ranges: readonly string[];
  /** True when `ranges.length > 1` — the dependency is held at divergent
   *  versions, a maintenance hazard. */
  readonly drift: boolean;
  /** The kinds this dependency is declared under, in fixed order. */
  readonly kinds: readonly DependencyKind[];
}

/** The workspace dependency report: every dependency, internal and external,
 *  with usage and drift. */
export interface WorkspaceDependencies {
  readonly kind: "jsnode.dependencies";
  /** All dependencies, external first (the registry surface), then internal;
   *  within each, most-used first then alphabetical. */
  readonly entries: readonly DependencyEntry[];
  readonly externalCount: number;
  readonly internalCount: number;
  /** Dependencies pinned to more than one range — the drift, most-divergent
   *  first. A subset of `entries`. */
  readonly drift: readonly DependencyEntry[];
  /** Total distinct dependencies. */
  readonly total: number;
}

const KIND_ORDER: readonly DependencyKind[] = ["runtime", "dev", "peer", "optional"];
const kindRank = (k: DependencyKind): number => KIND_ORDER.indexOf(k);

/** Read every declared dependency across the workspace into one report: who
 *  declares what, at which ranges, and where those ranges diverge. Convention
 *  agnostic — it reads `pkg.deps`, nothing about names. */
export function workspaceDependencies(workspace: JSNodeWorkspace): WorkspaceDependencies {
  const internalNames = new Set(workspace.packages.map((p) => p.name));
  const byName = new Map<string, DependencyUse[]>();
  for (const pkg of workspace.packages) {
    for (const d of pkg.deps) {
      (byName.get(d.name) ?? byName.set(d.name, []).get(d.name)!).push({
        by: pkg.name,
        range: d.range,
        kind: d.kind,
      });
    }
  }

  const entries: DependencyEntry[] = [...byName.entries()].map(([name, uses]) => {
    uses.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.by.localeCompare(b.by));
    const ranges = [...new Set(uses.map((u) => u.range))].sort();
    const kinds = [...new Set(uses.map((u) => u.kind))].sort((a, b) => kindRank(a) - kindRank(b));
    return {
      name,
      internal: internalNames.has(name),
      uses: Object.freeze(uses),
      usedBy: new Set(uses.map((u) => u.by)).size,
      ranges: Object.freeze(ranges),
      drift: ranges.length > 1,
      kinds: Object.freeze(kinds),
    };
  });

  // External first (the registry surface a reader cares about most), then
  // internal; within each band, most-used first then alphabetical.
  entries.sort(
    (a, b) =>
      Number(a.internal) - Number(b.internal) ||
      b.usedBy - a.usedBy ||
      a.name.localeCompare(b.name),
  );

  const drift = entries
    .filter((e) => e.drift)
    .sort((a, b) => b.ranges.length - a.ranges.length || a.name.localeCompare(b.name));

  return {
    kind: "jsnode.dependencies",
    entries: Object.freeze(entries),
    externalCount: entries.filter((e) => !e.internal).length,
    internalCount: entries.filter((e) => e.internal).length,
    drift: Object.freeze(drift),
    total: entries.length,
  };
}
