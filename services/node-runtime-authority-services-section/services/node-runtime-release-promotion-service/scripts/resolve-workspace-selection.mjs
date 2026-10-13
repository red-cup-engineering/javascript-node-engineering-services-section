#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, join, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { materializeSelectedSources, selectLockedWorkspaceClosure } from "../src/install-workspace-selection.mjs";
const args = process.argv.slice(2), flags = { importers: [] };
for (let at = 0; at < args.length; at += 2) {
  if (!["--receipt", "--importer", "--source-lock"].includes(args[at]) || !args[at+1]) throw new TypeError("resolve-workspace-selection --receipt <installed receipt> [--importer <new project>...] [--source-lock <upstream lock>]");
  if (args[at] === "--importer") flags.importers.push(args[at+1]);
  else if (args[at] === "--source-lock") flags.sourceLock = args[at+1];
  else flags.receipt = args[at+1];
}
const previous = JSON.parse(readFileSync(flags.receipt, "utf8"));
if (previous.type !== "NodeRuntimeWorkspaceSelectionInstallReceipt" || previous.status !== "installed" || previous.sourceConfigurationUnchanged !== true) throw new TypeError("an installed unchanged selection is required");
const root = realpathSync(previous.workspace);
let ids = [...new Set([...previous.importerIds, ...flags.importers])].sort();
if (flags.sourceLock !== undefined) {
  const require = createRequire(resolve(previous.tooling, "package.json"));
  const { readWantedLockfile } = await import(pathToFileURL(require.resolve("@pnpm/lockfile.fs")).href);
  const supplied = await readWantedLockfile(dirname(resolve(flags.sourceLock)), { ignoreIncompatible: false });
  const current = await readWantedLockfile(root, { ignoreIncompatible: false });
  if (String(supplied.lockfileVersion) !== String(current.lockfileVersion)) throw new TypeError("upstream and receiving locks use different codecs");
  // Read supplementary supplier paths, retaining the receiving composition's
  // existing links. pnpm resolves the actual manifests below; no joined lock is written.
  ids = selectLockedWorkspaceClosure({ lockfile: { ...supplied, importers: { ...supplied.importers, ...current.importers } }, importerIds: ids, workspace: root });
  await materializeSelectedSources({ root, importerIds: ids, environment: process.env, onOutput: text => process.stderr.write(text) });
}
const names = new Set();
for (const id of ids) {
  const offset = relative(root, resolve(root, id));
  if (isAbsolute(offset) || offset === ".." || offset.startsWith("../")) throw new TypeError("project leaves the receiving workspace");
  const manifest = JSON.parse(readFileSync(join(root,id,"package.json"), "utf8"));
  if (names.has(manifest.name)) throw new TypeError("competing project name in the selected composition: " + manifest.name);
  names.add(manifest.name);
}
for (const id of ids) {
  const manifest = JSON.parse(readFileSync(join(root,id,"package.json"), "utf8"));
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) for (const [name, version] of Object.entries(manifest[field] ?? {})) {
    if (version.startsWith("workspace:") && !names.has(name)) throw new TypeError("selected composition lacks " + name + " required by " + manifest.name);
  }
}
const command = [...ids.filter(id => id !== ".").map(id => "--workspace-packages="+id), "install", "--lockfile-only", "--no-frozen-lockfile", "--ignore-scripts", "--prefer-offline"];
const child = spawn(previous.executable, command, {cwd:root, env:process.env, stdio:["ignore", "pipe", "pipe"]});
child.stdout.on("data", chunk => process.stderr.write(chunk));
child.stderr.on("data", chunk => process.stderr.write(chunk));
const code = await new Promise((accept,reject) => {child.on("error",reject);child.on("exit",accept);});
if (code !== 0) throw new Error("pnpm could not resolve the selected composition: " + code);
process.stdout.write(JSON.stringify({type:"NodeRuntimeWorkspaceSelectionResolution",version:1,workspace:root,importerIds:ids,lockOwner:"pnpm",applicationExecuted:false})+"\n");
