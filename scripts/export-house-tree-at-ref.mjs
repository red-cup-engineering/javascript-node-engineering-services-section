#!/usr/bin/env node
// A read-only export of lib/emsenn/services/561-group at a git ref (`git archive <ref> --
// lib/emsenn/services/561-group | tar -x`, no worktree, no checkout) into a fresh temp directory
// that mirrors the repository's own path layout — so a caller resolves `layers.root`, a package
// map's directories, or any other repository-relative path under the export's temp root exactly as
// it would under the real repository root. This is the one export every tree-wide, ref-aware audit
// (audit-layer-imports, audit-phantom-imports, measure-house-tree) shares, rather than each
// re-implementing its own git-archive-into-tar plumbing.
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The one directory a ref export always covers: every house package lives under it, so exporting it is exporting the whole tree an audit needs. */
export const HOUSE_TREE_DIRECTORY = "lib/emsenn/services/561-group";

/**
 * Exports HOUSE_TREE_DIRECTORY at `ref` into a fresh temp directory, read-only.
 *
 * `cache`, when given, is a `Map` keyed by ref: within one caller-supplied cache the same ref is
 * exported once and reused by every call that needs it (the gate auditing both layers and phantoms
 * at the same ref, say), rather than re-archived per call — the owner of `cache` is responsible for
 * tearing every entry down once, after every call sharing it is done. Without one, this call exports
 * its own copy and the caller is responsible for removing the returned directory itself.
 *
 * @returns {string | undefined} the export's temp root (HOUSE_TREE_DIRECTORY lives under it at its
 *   usual repository-relative path), or undefined when the ref or the directory does not exist there.
 */
export function exportHouseTreeAtRef(root, ref, { cache } = {}) {
  const ownCache = cache ?? new Map();
  if (ownCache.has(ref)) return ownCache.get(ref);
  const tempRoot = mkdtempSync(join(tmpdir(), "house-tree-at-ref-"));
  // The whole house tree's archive runs well past a gigabyte (the house is large and this is the
  // one directory a ref export always covers), so maxBuffer needs real headroom above that, not the
  // 1 << 30 a single package's own export gets away with.
  const archive = spawnSync("git", ["archive", ref, "--", HOUSE_TREE_DIRECTORY], { cwd: root, maxBuffer: Infinity });
  if (archive.status !== 0 || !archive.stdout || archive.stdout.length === 0) {
    rmSync(tempRoot, { recursive: true, force: true });
    ownCache.set(ref, undefined);
    return undefined;
  }
  const extract = spawnSync("tar", ["-x", "-C", tempRoot], { input: archive.stdout, maxBuffer: Infinity });
  if (extract.status !== 0) {
    rmSync(tempRoot, { recursive: true, force: true });
    ownCache.set(ref, undefined);
    return undefined;
  }
  ownCache.set(ref, tempRoot);
  return tempRoot;
}
