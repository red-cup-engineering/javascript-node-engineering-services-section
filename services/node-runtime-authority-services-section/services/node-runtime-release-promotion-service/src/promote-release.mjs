import { randomUUID } from "node:crypto";
import { mkdir, readFile, readlink, rename, stat, symlink, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { RELEASE_RECEIPT, derivedPaths, releaseDigest } from "./release-digest.mjs";
import { IDENTITY_VERSION } from "./release-source.mjs";

const DIGEST = /^[0-9a-f]{64}$/u;
const POINTER = /^[a-z][a-z0-9-]*$/u;

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

async function atomicRelativeLink(directory, name, target) {
  const temporaryName = `.${name}.${randomUUID()}`;
  const temporary = join(directory, temporaryName);
  await symlink(target, temporary);
  await rename(temporary, join(directory, name));
}

export async function promoteNodeRuntimeRelease({ releaseRoot, digest, pointerName = "current", receiptRoot, commit, derived }) {
  if (!releaseRoot || !receiptRoot) throw new Error("releaseRoot and receiptRoot are required");
  if (!DIGEST.test(digest ?? "")) throw new Error("digest must be one lowercase SHA-256 hex value");
  if (!POINTER.test(pointerName)) throw new Error("pointerName must be a lowercase deployment name");
  const root = resolve(releaseRoot);
  const release = resolve(root, digest);
  if (!inside(root, release) || basename(release) !== digest || !(await exists(release))) throw new Error("release is absent or outside the admitted root");
  const materialization = JSON.parse(await readFile(join(release, RELEASE_RECEIPT), "utf8"));
  // A release named by its git identity is verified by its receipt: the name is the receipt's, the
  // identity version is one this promoter knows, and, when the caller says which commit it
  // materialized or which paths it derives, the receipt agrees. Its bytes are checked by the drift
  // check (release-drift.mjs), off this path. A release named by its byte digest (made before
  // identities, and kept as a rollback target) is verified by reading its bytes, as it always was.
  let observedDigest = null;
  if (materialization.identityVersion !== undefined) {
    if (materialization.identityVersion !== IDENTITY_VERSION) throw new Error(`release identity version ${materialization.identityVersion} is not one this promoter verifies`);
    if (materialization.artifactDigest !== digest) throw new Error("release receipt does not name the selected digest");
    if (commit !== undefined && materialization.source?.commit !== commit) throw new Error("release receipt is of another commit than the one promoted");
    if (derived !== undefined && JSON.stringify(derivedPaths(derived)) !== JSON.stringify(materialization.derived ?? [])) throw new Error("release receipt derives other paths than the ones promoted");
  } else {
    observedDigest = await releaseDigest(release, { derived: materialization.derived ?? [] });
    if (materialization.artifactDigest !== digest || observedDigest !== digest) throw new Error("release bytes do not satisfy the selected digest");
  }

  // The displaced target is whatever the pointer named, digest or not: a hand-placed release is
  // still the one a failed promotion must return to.
  let fromTarget = null;
  try {
    const prior = await readlink(join(root, pointerName));
    if (inside(root, resolve(root, prior)) && await exists(resolve(root, prior))) fromTarget = prior;
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "EINVAL") throw error;
  }
  const fromDigest = fromTarget !== null && DIGEST.test(fromTarget) ? fromTarget : null;
  if (fromTarget && fromTarget !== digest) await atomicRelativeLink(root, "previous", fromTarget);
  await atomicRelativeLink(root, pointerName, digest);

  const receipt = {
    type: "NodeRuntimeReleasePromotionReceipt",
    version: 1,
    pointer: join(root, pointerName),
    fromTarget,
    fromDigest,
    toDigest: digest,
    observedDigest,
    ...(materialization.identityVersion !== undefined ? { identityVersion: materialization.identityVersion } : {}),
    changed: fromTarget !== digest,
    recordedAt: new Date().toISOString(),
  };
  const receipts = resolve(receiptRoot);
  await mkdir(receipts, { recursive: true });
  const receiptPath = join(receipts, `${receipt.recordedAt.replaceAll(":", "-")}-${digest}.json`);
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  return { ...receipt, receiptPath };
}
