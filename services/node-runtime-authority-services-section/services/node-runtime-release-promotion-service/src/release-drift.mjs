// The drift check, off the release's hot path: do the bytes under a release's directory still equal
// the commit it was made from? A release named by its git identity is compared with git itself: each
// file the commit's selection lists must be there with the blob id (and executable bit) git recorded,
// and nothing else may be there but what the install builds (node_modules, the derived paths, the
// receipt). A release named by its byte digest is compared by digesting its bytes, as before.
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { RELEASE_RECEIPT, releaseDigest } from "./release-digest.mjs";
import { selectionEntries } from "./release-source.mjs";

const blobId = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

/** `{ ok, kind, drifted: [{ path, why }] }`; for a legacy release, `drifted` is empty and `ok` is the digest's. */
export async function verifyReleaseDrift({ release, repository }) {
  const receipt = JSON.parse(await readFile(join(release, RELEASE_RECEIPT), "utf8"));
  if (receipt.identityVersion === undefined) {
    return { ok: await releaseDigest(release, { derived: receipt.derived ?? [] }) === receipt.artifactDigest, kind: "byte-digest", drifted: [] };
  }
  const commit = receipt.source?.commit;
  if (!commit || !Array.isArray(receipt.source?.archives)) throw new Error("release receipt names no commit to compare with");
  const entries = selectionEntries({ repository, commit, archives: receipt.source.archives, derived: receipt.derived ?? [] });
  const expected = new Map(entries.map((entry) => [entry.path, entry]));
  const derived = new Set(receipt.derived ?? []);
  const drifted = [];
  const seen = new Set();
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(release, path);
      if (entry.name === "node_modules" || name === RELEASE_RECEIPT || derived.has(name)) continue;
      if (entry.isDirectory()) { await visit(path); continue; }
      seen.add(name);
      const listed = expected.get(name);
      if (!listed) { drifted.push({ path: name, why: "not in the commit" }); continue; }
      if (entry.isSymbolicLink()) {
        if (listed.mode !== "120000" || blobId(Buffer.from(await readlink(path))) !== listed.oid) drifted.push({ path: name, why: "link differs" });
      } else if (entry.isFile()) {
        if (listed.mode === "120000" || blobId(await readFile(path)) !== listed.oid) drifted.push({ path: name, why: "bytes differ" });
        else if (((await lstat(path)).mode & 0o111 ? "100755" : "100644") !== listed.mode) drifted.push({ path: name, why: "mode differs" });
      }
    }
  }
  await visit(release);
  for (const path of expected.keys()) if (!seen.has(path)) drifted.push({ path, why: "missing" });
  return { ok: drifted.length === 0, kind: "git-identity", drifted };
}
