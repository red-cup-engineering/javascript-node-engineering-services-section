/**
 * package-liberties — the workspace's internal dependency graph read as a
 * board: every package's open faces are its source-declared consumers (other
 * workspace packages that depend on it) plus one more face if it is published
 * to the registry. A package with zero open faces is captured; with exactly
 * one it is in atari (one bad move from capture); otherwise it is live.
 *
 * Pure over a discovered workspace and an injected publish check — no
 * filesystem beyond what `discoverWorkspace` already read, no registry access
 * of its own. The registry probe (`npm view`) is the CLI's job, in
 * `scripts/derive-set-of-package-liberties.mts`; this module only combines
 * whatever answer it is given with the consumer graph `workspaceDependencyGraph`
 * already computes.
 */
import { workspaceDependencyGraph } from "./graph.mjs";
import type { JSNodeWorkspace } from "@red-cup-engineering/jsnode-topology";

export type PackageLibertyClassification = "captured" | "atari" | "live";

export interface PackageLibertyRecord {
  readonly name: string;
  /** Other workspace packages that source-declare a runtime dependency on
   *  this one, by exact name, sorted. */
  readonly consumers: readonly string[];
  /** Whether the exact name resolves at the registry; `null` means unknown
   *  (the check was skipped, e.g. `--offline`) — distinct from a confirmed
   *  `false`, and never counted toward `liberties`. */
  readonly published: boolean | null;
  readonly liberties: number;
  readonly classification: PackageLibertyClassification;
}

export interface PackageLibertiesReadout {
  readonly kind: "jsnode.package-liberties";
  readonly root: string;
  /** True when the publish check was skipped for every package (`--offline`);
   *  every `published` is then `null` and no package can reach atari or live
   *  purely on registry presence. */
  readonly offline: boolean;
  readonly counts: {
    readonly packages: number;
    readonly captured: number;
    readonly atari: number;
    readonly live: number;
  };
  /** Every package, sorted by name. */
  readonly packages: readonly PackageLibertyRecord[];
  /** The three classification buckets, each the matching subset of
   *  `packages` in the same name order. */
  readonly captured: readonly PackageLibertyRecord[];
  readonly atari: readonly PackageLibertyRecord[];
  readonly live: readonly PackageLibertyRecord[];
}

/** Classify a liberties count: 0 is captured, exactly 1 is atari, otherwise
 *  live. */
export function classifyLiberties(liberties: number): PackageLibertyClassification {
  if (liberties === 0) return "captured";
  if (liberties === 1) return "atari";
  return "live";
}

/** Combine the workspace's internal consumer graph with an injected publish
 *  check into one liberties readout per package, sorted deterministically by
 *  name throughout. `isPublished(name)` is called once per package name; the
 *  CLI is responsible for any caching or `--offline` short-circuit — this
 *  function only awaits whatever it returns. */
export async function derivePackageLiberties(
  workspace: JSNodeWorkspace,
  isPublished: (name: string) => Promise<boolean | null>,
  opts: { readonly offline?: boolean } = {},
): Promise<PackageLibertiesReadout> {
  const graph = workspaceDependencyGraph(workspace);
  const consumersByName = new Map<string, string[]>();
  for (const pkg of workspace.packages) consumersByName.set(pkg.name, []);
  for (const edge of graph.edges) consumersByName.get(edge.to)?.push(edge.from);

  const sortedPackages = [...workspace.packages].sort((a, b) => a.name.localeCompare(b.name));
  // Every publish check is started here, before any is awaited, so an
  // `isPublished` that queues its own bounded concurrency (the CLI's
  // registry checker) actually runs concurrently — awaiting each call in
  // turn inside this loop would serialize them regardless of what the
  // injected function supports.
  const publishedByIndex = await Promise.all(sortedPackages.map((pkg) => isPublished(pkg.name)));
  const records: PackageLibertyRecord[] = sortedPackages.map((pkg, i) => {
    const consumers = [...(consumersByName.get(pkg.name) ?? [])].sort();
    const published = publishedByIndex[i] ?? null;
    const liberties = consumers.length + (published === true ? 1 : 0);
    return { name: pkg.name, consumers, published, liberties, classification: classifyLiberties(liberties) };
  });

  const bucket = (c: PackageLibertyClassification): PackageLibertyRecord[] => records.filter((r) => r.classification === c);
  const captured = bucket("captured");
  const atari = bucket("atari");
  const live = bucket("live");

  return {
    kind: "jsnode.package-liberties",
    root: workspace.root,
    offline: opts.offline ?? false,
    counts: { packages: records.length, captured: captured.length, atari: atari.length, live: live.length },
    packages: records,
    captured,
    atari,
    live,
  };
}
