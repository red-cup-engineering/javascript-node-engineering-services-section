#!/usr/bin/env node
// Opens a session's worktree of the node's repository, the other half of the landing rail
// (land-candidate): a detached worktree at origin/main, with the submodules the commit composes
// checked out at the commits its gitlinks record (borrowing the node's submodule objects, so
// nothing is cloned twice), optionally sparse.
//   node open-worktree.mjs --name <lane-N> [--root ~/.local/state/561-group/lane-worktrees]
//     [--sparse <dir>]... [--repository /home/emsenn/info]
// The worktree is a session's own: it edits there, commits there, and lands with
//   land-candidate --name <lane-N>/<slice> --commit HEAD --wait
// A session never edits the node's checkout.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { gitSync, gitTextSync } from "../src/git-objects.mjs";

function submodulesOf(repository, commit) {
  const gitlinks = gitTextSync(repository, ["ls-tree", "-r", "-z", "--full-tree", commit]).split("\0")
    .map((entry) => /^160000 commit ([0-9a-f]{40})\t(.+)$/u.exec(entry)).filter(Boolean).map(([, object, path]) => ({ object, path }));
  if (gitlinks.length === 0) return [];
  const config = gitTextSync(repository, ["config", "--blob", `${commit}:.gitmodules`, "-z", "--get-regexp", "^submodule\\..*\\.(path|update)$"]);
  const modules = new Map();
  for (const record of config.split("\0").filter(Boolean)) {
    const [key, value] = record.split("\n");
    const [, name, field] = /^submodule\.(.+)\.(path|update)$/u.exec(key);
    modules.set(name, { ...modules.get(name), name, [field]: value });
  }
  const byPath = new Map([...modules.values()].map((module) => [module.path, module]));
  // A submodule marked `update = none` is data with its own lifecycle (a channel's production state).
  return gitlinks.map((gitlink) => ({ ...gitlink, ...byPath.get(gitlink.path) })).filter((module) => module.name && module.update !== "none");
}

export function openWorktree({ repository = "/home/emsenn/info", name, root = join(homedir(), ".local/state/561-group/lane-worktrees"), sparse = [], onStep = (line) => process.stderr.write(`${line}\n`) }) {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name)) throw new Error("--name is lowercase letters, digits, '.', '_' and '-'");
  const worktree = resolve(root, name);
  if (existsSync(worktree)) throw new Error(`${worktree} exists; remove it with \`git worktree remove\` first, or pick another name`);
  try { gitSync(repository, ["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"]); } catch (error) { onStep(`fetch failed, opening at the last fetched main: ${error.message.split("\n")[0]}`); }
  const main = gitTextSync(repository, ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"]);
  gitSync(repository, ["worktree", "add", "--detach", ...(sparse.length ? ["--no-checkout"] : []), worktree, main]);
  if (sparse.length) {
    gitSync(worktree, ["sparse-checkout", "set", "--no-cone", "/*", "!/*/", ...sparse.map((path) => `/${path.replace(/^\/+|\/+$/gu, "")}/`)]);
    gitSync(worktree, ["read-tree", "-mu", "HEAD"]);
  }
  onStep(`opened ${worktree} at ${main}`);
  const common = resolve(repository, gitTextSync(repository, ["rev-parse", "--git-common-dir"]));
  for (const module of submodulesOf(repository, main)) {
    if (sparse.length && !sparse.some((path) => module.path.startsWith(path.replace(/^\/+|\/+$/gu, "")))) continue;
    const reference = join(common, "modules", module.name);
    gitSync(worktree, ["-c", "protocol.file.allow=always", "submodule", "update", "--init", ...(existsSync(reference) ? ["--reference", reference] : []), "--", module.path]);
    onStep(`submodule ${module.name} at ${module.object.slice(0, 12)}`);
  }
  return { worktree, main };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { name: { type: "string" }, root: { type: "string" }, sparse: { type: "string", multiple: true, default: [] }, repository: { type: "string" } } });
  if (!values.name) throw new Error("usage: open-worktree.mjs --name <lane-N> [--root <dir>] [--sparse <dir>]... [--repository <checkout>]");
  const opened = openWorktree({ name: values.name, sparse: values.sparse, ...(values.root ? { root: values.root } : {}), ...(values.repository ? { repository: values.repository } : {}) });
  process.stdout.write(`${JSON.stringify(opened)}\n`);
}
