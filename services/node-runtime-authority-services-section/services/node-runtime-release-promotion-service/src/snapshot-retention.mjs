// Which quiescent state snapshots a host keeps (release-git-commit's `backup`). Retention is by time,
// not by release count: a node released every few minutes kept its last 14 snapshots, seven hours of
// history at about 400 MB each, until Cold Red Gate's disk filled and its releases were refused
// (2026-10-03); the laptop's fetched copies were never pruned at all (36 GB). A host keeps its `keep`
// newest snapshots, and the newest of each UTC day for `keepDays` days.

/** The ISO instant a snapshot's name begins with (`2026-10-03T17-21-44.830Z-<digest>.tar.gz`), or undefined. */
export function snapshotInstantOf(name) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(\.\d+)?Z/u.exec(name);
  return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}${match[5] ?? ""}Z` : undefined;
}

/** The snapshot names to keep, newest first; names that carry no instant are always kept. */
export function retainedSnapshots(names, { keep = 3, keepDays = 14, now = new Date().toISOString() } = {}) {
  const dated = names.map((name) => ({ name, at: snapshotInstantOf(name) })).filter((entry) => entry.at !== undefined)
    .sort((left, right) => right.at.localeCompare(left.at));
  const kept = new Set(names.filter((name) => snapshotInstantOf(name) === undefined));
  for (const { name } of dated.slice(0, keep)) kept.add(name);
  const horizon = new Date(Date.parse(now) - keepDays * 86_400_000).toISOString().slice(0, 10);
  const days = new Set();
  for (const { name, at } of dated) {
    const day = at.slice(0, 10);
    if (day < horizon || days.has(day)) continue;
    days.add(day);
    kept.add(name);
  }
  return names.filter((name) => kept.has(name));
}

/** The snapshot names to remove. */
export const prunedSnapshots = (names, options) => {
  const kept = new Set(retainedSnapshots(names, options));
  return names.filter((name) => !kept.has(name));
};
