import { readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { RELEASE_RECEIPT, derivedPaths, releaseDigest } from "./release-digest.mjs";

// A staged tree becomes a release: it is digested, receipted with its source (for a repository,
// the commit and pathspecs it was archived from), and moved to <releaseRoot>/<digest>, where the
// promoter can verify it. Materializing the same bytes twice is the same release, once the existing
// directory is checked to still hold them: a release edited in place is moved aside to
// `.drifted-<digest>-<time>` as evidence and replaced by the committed bytes. Paths the release
// declares derived are built by its install, so the receipt names them and no digest reads them.
//
// A release of a repository commit is named by its git identity (src/release-source.mjs) instead,
// which the caller computed from the commit's objects: no byte of the staged tree is read, the
// receipt says which identity version named it, and a release already holding that identity is
// reused once its receipt is checked. Reading the bytes back is the drift check (src/release-drift.mjs).
export async function materializeNodeRuntimeRelease({ stagedRoot, releaseRoot, source = {}, derived = [], identity }) {
  if (!stagedRoot || !releaseRoot) throw new Error("stagedRoot and releaseRoot are required");
  const staged = resolve(stagedRoot);
  const declared = derivedPaths(derived);
  if (identity !== undefined && (!Number.isInteger(identity.version) || !/^[0-9a-f]{64}$/u.test(identity.digest ?? ""))) throw new Error("identity is { version, digest } with a SHA-256 hex digest");
  const artifactDigest = identity?.digest ?? await releaseDigest(staged, { derived: declared });
  const release = join(resolve(releaseRoot), artifactDigest);
  const receipt = {
    type: "NodeRuntimeReleaseMaterializationReceipt",
    version: 1,
    artifactDigest,
    ...(identity ? { identityVersion: identity.version } : {}),
    source,
    ...(declared.length > 0 ? { derived: declared } : {}),
    materializedAt: new Date().toISOString(),
  };
  const already = await stat(release).then(() => true, (error) => { if (error?.code === "ENOENT") return false; throw error; });
  let drifted = null;
  if (already && identity) {
    const held = await readFile(join(release, RELEASE_RECEIPT), "utf8").then(JSON.parse, () => null);
    if (held?.artifactDigest === artifactDigest && held.identityVersion === identity.version) {
      await rm(staged, { recursive: true, force: true });
      return { ...receipt, release, reused: true, drifted };
    }
    drifted = join(resolve(releaseRoot), `.drifted-${artifactDigest}-${receipt.materializedAt.replaceAll(":", "-")}`);
    await rename(release, drifted);
    await utimes(drifted, new Date(), new Date());
  } else if (already) {
    if (await releaseDigest(release, { derived: declared }) === artifactDigest) {
      await rm(staged, { recursive: true, force: true });
      return { ...receipt, release, reused: true, drifted };
    }
    drifted = join(resolve(releaseRoot), `.drifted-${artifactDigest}-${receipt.materializedAt.replaceAll(":", "-")}`);
    await rename(release, drifted);
    await utimes(drifted, new Date(), new Date());
  }
  await writeFile(join(staged, RELEASE_RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
  await rename(staged, release);
  return { ...receipt, release, reused: false, drifted };
}
