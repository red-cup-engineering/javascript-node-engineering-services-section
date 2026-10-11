import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export const RELEASE_RECEIPT = "release-receipt.json";

// Installed dependencies are derived from the lockfile the release carries, so they are not
// part of its identity: a release installed in place still verifies, and so does a rollback to it.
const DERIVED = new Set([RELEASE_RECEIPT, "node_modules"]);

/**
 * A release may declare further derived paths: files its install builds from the sources it
 * carries (generated code). Their bytes are not its identity either, but which paths are derived
 * is, so two releases agree only when they derive the same paths from the same sources.
 */
export function derivedPaths(derived = []) {
  if (!Array.isArray(derived) || derived.some((path) => typeof path !== "string" || !path || path.startsWith("/") || path.split("/").includes("..")))
    throw new Error("derived must be a list of release-relative paths");
  return [...new Set(derived)].sort();
}

// Files are read this many at a time and hashed in their fixed order: the digest is the same one a
// file-at-a-time walk gives, without waiting on each read in turn (58k files per release).
const READ_AHEAD = 64;

export async function releaseDigest(root, { derived = [] } = {}) {
  const declared = derivedPaths(derived);
  const skipped = new Set(declared);
  const hash = createHash("sha256");
  if (declared.length > 0) { hash.update(`derived\0${declared.join("\0")}`); hash.update("\0\0"); }
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (DERIVED.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (skipped.has(relative(root, path))) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  const reads = files.slice(0, READ_AHEAD).map((path) => readFile(path));
  for (let index = 0; index < files.length; index += 1) {
    const bytes = await reads[index];
    reads[index] = undefined;
    if (index + READ_AHEAD < files.length) reads[index + READ_AHEAD] = readFile(files[index + READ_AHEAD]);
    hash.update(relative(root, files[index])); hash.update("\0"); hash.update(bytes); hash.update("\0");
  }
  return hash.digest("hex");
}
