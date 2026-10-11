// Claims before work: a slice declares the paths it will touch before it starts, under the queue it
// will land through (<queueRoot>/claims/<owner>~<slice>.json), and learns at once which open claims
// of other slices overlap it, while there is still time to agree an order instead of meeting at a
// conflict verdict. A claim is released when its slice's candidate is integrated (answer() in
// integrate.mjs), or by its owner. Claims are plain files, so any reader (Lane 8's world, a status
// page) shows who holds which part of the tree.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const fileOf = (queueRoot, name) => join(queueRoot, "claims", `${name.replaceAll("/", "~")}.json`);

/** Every open claim: { name, paths, claimedAt, by }. */
export function readClaims(queueRoot) {
  const directory = join(queueRoot, "claims");
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((file) => file.endsWith(".json")).flatMap((file) => {
    try { return [JSON.parse(readFileSync(join(directory, file), "utf8"))]; } catch { return []; }
  });
}

// Two claimed paths overlap when one is the other or contains it (a directory claim covers its files).
const covers = (outer, inner) => inner === outer || inner.startsWith(`${outer.replace(/\/+$/u, "")}/`);
export const pathsOverlap = (left, right) => covers(left, right) || covers(right, left);

/** The open claims of other slices that overlap `paths`, with the overlapping pairs. */
export function overlapsOf(queueRoot, name, paths) {
  return readClaims(queueRoot).filter((claim) => claim.name !== name).flatMap((claim) => {
    const pairs = paths.flatMap((path) => claim.paths.filter((held) => pathsOverlap(path, held)).map((held) => [path, held]));
    return pairs.length ? [{ name: claim.name, by: claim.by, claimedAt: claim.claimedAt, pairs }] : [];
  });
}

/** Records (or replaces) the slice's claim and returns the overlaps it has with other open claims. */
export function claimPaths(queueRoot, { name, paths, by = null, now = () => new Date() }) {
  const file = fileOf(queueRoot, name);
  mkdirSync(join(queueRoot, "claims"), { recursive: true });
  const claim = { type: "NodeIntegrationClaim", version: 1, name, paths: [...new Set(paths)].sort(), by, claimedAt: now().toISOString() };
  writeFileSync(`${file}.partial`, `${JSON.stringify(claim, null, 2)}\n`);
  renameSync(`${file}.partial`, file);
  return { claim, overlaps: overlapsOf(queueRoot, name, claim.paths) };
}

export function releaseClaim(queueRoot, name) {
  rmSync(fileOf(queueRoot, name), { force: true });
}
