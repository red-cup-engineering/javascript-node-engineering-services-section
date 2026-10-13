import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolchainSource = resolve(dirname(fileURLToPath(import.meta.url)), "../data/selected-install-tools");
const fields = ["dependencies", "devDependencies", "optionalDependencies"];
const policyNames = [
  "minimumReleaseAge", "minimumReleaseAgeExclude", "minimumReleaseAgeIgnoreMissingTime",
  "minimumReleaseAgeStrict", "trustPolicy", "trustPolicyExclude", "trustPolicyIgnoreAfter",
  "trustLockfile", "blockExoticSubdeps", "verifyStoreIntegrity", "strictStorePkgContentCheck",
  "strictSsl", "allowBuilds",
];
const digest = (value) => createHash("sha256").update(value).digest("hex");
const portable = (value) => value.split(sep).join("/");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const contained = (parent, child) => {
  const from = relative(parent, child);
  return from === "" || (!isAbsolute(from) && from !== ".." && !from.startsWith(".." + sep));
};

async function execute(command, args, { cwd, environment, onOutput } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; onOutput?.(chunk.toString()); });
    child.stderr.on("data", (chunk) => { stderr += chunk; onOutput?.(chunk.toString()); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) accept(stdout);
      else reject(Object.assign(new Error(command + " exited " + (code ?? signal) + ": " + stderr.trim()), { exitCode: code, signal }));
    });
  });
}

async function optionalBytes(file) {
  try { return await readFile(file); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

async function sourceBinModes(root, importerIds) {
  const bins = new Map();
  const sourceChanges = [];
  for (const id of importerIds) {
    const manifest = JSON.parse(await readFile(join(root, id, "package.json"), "utf8"));
    const entries = typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
    if (entries.length) {
      // Inspect the actual bin carriers in their owning repository. A broad
      // parent status also reports unrelated untracked historical submodules.
      if (entries.some(entry => typeof entry !== "string" || !entry)) throw new TypeError("source bin must name its file");
      const changed = await execute("git", ["--literal-pathspecs", "-C", join(root, id), "status", "--porcelain=v1",
        "--untracked-files=no", "--ignore-submodules=none", "--", ...entries]);
      if (changed.trim()) sourceChanges.push({importerId: id, changes: changed.trim()});
    }
    for (const entry of entries) {
      const file = resolve(root, id, entry);
      if (!contained(root, file)) throw new Error("source bin escapes the selected checkout");
      const path = portable(relative(root, file));
      // Check every ancestor and the declared target before its first byte read.
      // Missing generated bins retain the existing optional-input behavior.
      try { await regularSourceFile(root, path); }
      catch (error) { if (error.cause?.code === "ENOENT") continue; throw error; }
      const bytes = await readFile(file);
      bins.set(file, { root, path, mode: (await stat(file)).mode & 0o777, hash: digest(bytes) });
    }
  }
  if (sourceChanges.length) {
    const error = new Error("source bin packages have unreconciled tracked changes:\n" + sourceChanges.map(item => item.importerId + "\n" + item.changes).join("\n"));
    error.sourceChanges = sourceChanges;
    throw error;
  }
  return bins;
}

async function preserveSourceBinModes(bins) {
  for (const [file, original] of bins) {
    if (await realpath(original.root) !== original.root) throw new Error("source bin root is redirected");
    await regularSourceFile(original.root, original.path);
    assert.equal(digest(await readFile(file)), original.hash, "source bin changed during installation: " + file);
    const mode = (await stat(file)).mode & 0o777;
    if (mode !== original.mode) {
      // PNPM 11.19's bin linker sets exactly 0755, including non-execute bits.
      // Receive only that known normalization (or the existing execute-only
      // change) on unchanged regular declared bins, then restore source custody.
      if (mode !== 0o755 && (mode & ~0o111) !== (original.mode & ~0o111)) throw new Error("source bin permissions changed beyond executable bits: " + file + " (before " + original.mode.toString(8).padStart(4, "0") + ", after " + mode.toString(8).padStart(4, "0") + ")");
      await regularSourceFile(original.root, original.path);
      await chmod(file, original.mode);
    }
  }
}

/** Refuse redirected source carriers before reading their bytes. */
async function regularSourceFile(root, path) {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\0") || path.includes("\\")
      || path.split(/[\\/]/u).some(part => !part || part === "." || part === "..")) {
    throw new TypeError("source carrier needs a canonical relative path");
  }
  const parts = path.split("/");
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const entry = await lstat(current).catch(error => {
      if (error.code === "ENOENT") throw new Error("selected source carrier is missing or not materialized: " + path, { cause: error });
      throw error;
    });
    if (entry.isSymbolicLink() || (index === parts.length - 1 ? !entry.isFile() : !entry.isDirectory())) {
      throw new Error("source carrier is redirected or not regular: " + path);
    }
  }
  return current;
}

/** Verify the exact source, manifests and frozen lock bound by an installed receipt. */
export async function verifyWorkspaceSelection(receipt, { environment = process.env } = {}) {
  if (receipt?.type !== "NodeRuntimeWorkspaceSelectionInstallReceipt" || receipt.version !== 1
      || receipt.status !== "installed" || receipt.sourceConfigurationUnchanged !== true) {
    throw new TypeError("an installed, unchanged workspace selection is required");
  }
  const root = await realpath(receipt.workspace);
  if (root !== resolve(receipt.workspace)) throw new Error("selected source root is redirected");
  // Establish the source-file boundary before the verifier's first byte read.
  // Mount identity alone does not confine ordinary packages below that mount.
  for (const id of receipt.importerIds) {
    await regularSourceFile(root, id === "." ? "package.json" : id + "/package.json");
  }
  for (const name of Object.keys(receipt.sourceHashes)) await regularSourceFile(root, name);
  for (const id of Object.keys(receipt.manifestHashes)) {
    await regularSourceFile(root, id === "." ? "package.json" : id + "/package.json");
  }
  const artifact = await realpath(receipt.artifact);
  if (artifact !== resolve(receipt.artifact)) throw new Error("selected receipt artifact is redirected");
  await regularSourceFile(artifact, "pnpm-lock.yaml");
  assert.equal((await execute("git", ["-C", root, "rev-parse", "HEAD"], { environment })).trim(), receipt.commit,
    "selected source revision changed");
  const sourceMounts = await receiveSelectedSources({ root, importerIds: receipt.importerIds, environment });
  assert.deepEqual(sourceMounts, receipt.sourceMounts, "selected source mounts differ from their installed receipt");
  assert.equal(digest(await readFile(join(receipt.artifact, "pnpm-lock.yaml"))), receipt.scopedLockSha256,
    "selected frozen lock changed");
  for (const [name, hash] of Object.entries(receipt.sourceHashes)) {
    assert.equal(digest(await readFile(join(root, name))), hash, "source configuration changed: " + name);
  }
  for (const [id, hash] of Object.entries(receipt.manifestHashes)) {
    assert.equal(digest(await readFile(join(root, id, "package.json"))), hash, "selected manifest changed: " + id);
  }
  // A matching manifest does not receive changed non-bin source bodies. Read
  // tracked state at each selected repository, without refreshing its index.
  // Untracked/generated payload inclusion remains the producer's separate
  // obligation; a changed tracked build product needs attributed receiving.
  const scopes = new Map();
  for (const id of receipt.importerIds) {
    const mount = sourceMounts.filter(row => id === row.path || id.startsWith(row.path + "/"))
      .sort((a, b) => b.path.length - a.path.length)[0];
    const directory = mount ? join(root, mount.path) : root;
    const path = mount ? id === mount.path ? "." : id.slice(mount.path.length + 1) : id;
    if (!scopes.has(directory)) scopes.set(directory, []);
    scopes.get(directory).push(path);
  }
  const sourceState = [];
  let omittedScopes = 0;
  const observationEnvironment = { ...environment, GIT_OPTIONAL_LOCKS: "0" };
  const mountIdentity = async mount => {
    const parent = sourceMounts.filter(row => mount.path.startsWith(row.path + "/"))
      .sort((a, b) => b.path.length - a.path.length)[0];
    const parentDirectory = parent ? join(root, parent.path) : root;
    const path = parent ? mount.path.slice(parent.path.length + 1) : mount.path;
    return { path: mount.path, recordedCommit: mount.revision,
      indexGitlink: await execute("git", ["-C", parentDirectory, "ls-files", "--stage", "--", path], { environment: observationEnvironment }),
      actualCommit: (await execute("git", ["-C", join(root, mount.path), "rev-parse", "HEAD"], { environment: observationEnvironment })).trim() };
  };
  for (const [directory, paths] of scopes) {
    const changes = await execute("git", ["-C", directory, "status", "--porcelain=v1",
      "--untracked-files=no", "--ignore-submodules=untracked", "--", ...paths],
    { environment: observationEnvironment });
    if (!changes.trim()) continue;
    // Git excludes untracked payload here while preserving tracked changes and
    // changed gitlink heads. Keep bounded diagnostics for every actual refusal.
    const allRecords = (await execute("git", ["-C", directory, "status", "--porcelain=v2", "-z",
      "--untracked-files=no", "--ignore-submodules=untracked", "--", ...paths],
    { environment: observationEnvironment })).split("\0").filter(Boolean);
    if (sourceState.length === 8) { omittedScopes++; continue; }
    const records = allRecords.slice(0, 24);
    const scope = portable(relative(root, directory)) || ".";
    const implicated = sourceMounts.filter(mount => mount.path === scope || records.some(record => {
      const path = portable(relative(directory, join(root, mount.path)));
      return record.startsWith("1 ") && record.split(" ")[2]?.startsWith("S") && record.endsWith(" " + path);
    }));
    sourceState.push({ scope, porcelainV1: changes.slice(0, 4096), porcelainV1Truncated: changes.length > 4096,
      porcelainV2: records.map(record => record.slice(0, 1024)), omittedRecords: allRecords.length - records.length,
      longRecordsTruncated: records.some(record => record.length > 1024),
      mounts: await Promise.all(implicated.slice(0, 24).map(mountIdentity)), omittedMounts: Math.max(0, implicated.length - 24) });
  }
  if (sourceState.length) {
    const error = new Error("selected source has tracked changes or nested submodule state; receive source or derived output before reuse:\n" + JSON.stringify({ scopes: sourceState, omittedScopes }, null, 2));
    error.sourceState = sourceState;
    throw error;
  }
  return root;
}

/** Reuse the frozen installation's scope for its actual generation or packing command. */
export async function runWorkspaceSelection({ receipt, arguments: args, deployOutput, deployImporter, environment = process.env, onOutput } = {}) {
  if (receipt?.type !== "NodeRuntimeWorkspaceSelectionInstallReceipt" || receipt.version !== 1
      || receipt.status !== "installed" || receipt.sourceConfigurationUnchanged !== true) {
    throw new TypeError("an installed, unchanged workspace selection is required");
  }
  if (!Array.isArray(args) || !args.length || args.some(arg => typeof arg !== "string" || !arg || arg.includes("\0"))) {
    throw new TypeError("pnpm arguments are required");
  }
  if (args.some(arg => /^(?:--(?:config\.)?(?:workspace-packages|lockfile-dir|dir)|-C)(?:=|$)/u.test(arg))) {
    throw new TypeError("a consumer command cannot replace the selected source or lock scope");
  }
  const root = await verifyWorkspaceSelection(receipt, { environment });
  let output, owner;
  if (deployOutput !== undefined) {
    if (typeof deployImporter !== "string" || !receipt.importerIds.includes(deployImporter))
      throw new TypeError("deploy output needs its explicit selected importer");
    if (typeof deployOutput !== "string" || !deployOutput) throw new TypeError("deploy output needs its explicit path");
    output = resolve(deployOutput);
    if (contained(root, output) || await realpath(dirname(output)) !== dirname(output)) throw new Error("deploy output must have a canonical parent outside source");
    owner = JSON.parse(await readFile(join(root, deployImporter, "package.json"), "utf8"));
    if (typeof owner.name !== "string" || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(owner.name))
      throw new TypeError("deploy importer must declare its literal package name");
    for (const id of receipt.importerIds) {
      if (id !== deployImporter && JSON.parse(await readFile(join(root, id, "package.json"), "utf8")).name === owner.name)
        throw new Error("deploy package has competing selected owners: " + owner.name);
    }
    assert.deepEqual(args, ["--filter", owner.name, "--config.ignore-scripts=true", "--config.inject-workspace-packages=true", "deploy", "--prod", output], "produced output requires the exact selected deploy invocation");
    try { await lstat(output); throw new Error("deploy output already exists"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const scope = receipt.importerIds.map(id => "--workspace-packages=" + id);
  // `run` does not expose install's --lockfile-dir CLI flag; the maintained
  // pnpm config namespace carries this same setting across both commands.
  const command = ["--config.lockfile-dir=" + receipt.artifact, ...scope, ...args];
  const bins = await sourceBinModes(root, receipt.importerIds);
  try { await execute(receipt.executable, command, { cwd: root, environment, onOutput }); }
  finally { await preserveSourceBinModes(bins); }
  let produced;
  if (output !== undefined) {
    if (await realpath(output) !== output || !(await lstat(output)).isDirectory()) throw new Error("deploy output is redirected");
    const files = [];
    // These are PNPM deployFromSharedLockfile's documented root products, not
    // a caller-selected file inventory. Preserve optional-file absence too.
    for (const path of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
      const file = join(output, path);
      const entry = await lstat(file).catch(error => { if (error.code === "ENOENT" && path === "pnpm-workspace.yaml") return null; throw error; });
      if (entry && !entry.isFile()) throw new Error("deploy metadata must be a regular nonredirected file: " + path);
      files.push({ path, sha256: entry ? digest(await readFile(file)) : null });
    }
    const packed = JSON.parse(await readFile(join(output, "package.json"), "utf8"));
    for (const field of ["name", "version", "exports", "bin", "files"])
      assert.deepEqual(packed[field], owner[field], "deployed package differs from its selected owner: " + field);
    produced = { directory: output, importerId: deployImporter, package: owner.name, files };
  }
  await verifyWorkspaceSelection(receipt, { environment });
  return { type: "NodeRuntimeWorkspaceSelectionCommandReceipt", version: 1, commit: receipt.commit,
    executable: receipt.executable, arguments: args, sourceConfigurationUnchanged: true, ...(produced ? { produced } : {}) };
}

/** Match only the lock-selected importer directories in pnpm's own project filter.
 * This is additional to --workspace-packages: a broad manifest or ignored
 * workspace override must never silently expand a frozen selected install.
 * Reject selector metacharacters instead of interpreting source paths as globs.
 */
export function exactImporterFilterArgs(importerIds) {
  if (!Array.isArray(importerIds) || !importerIds.length) throw new TypeError("nonempty selected importer paths required");
  const seen = new Set();
  return importerIds.map((id) => {
    if (typeof id !== "string" || (id !== "." &&
        (!/^[a-zA-Z0-9_@./-]+$/u.test(id) || id.startsWith("/") || id.startsWith("./") || id.includes("//") || id.split("/").some(part=>part==="."||part==="..")))) {
      throw new Error("unsafe locked importer path for exact pnpm filtering: " + String(id));
    }
    if (seen.has(id)) throw new Error("duplicate locked importer path: " + id);
    seen.add(id);
    return "--filter={" + id + "}";
  });
}

/** Select source importers by following committed links, without discovering unrelated projects. */
export function selectLockedWorkspaceClosure({ lockfile, importerIds, workspace }) {
  if (String(lockfile?.lockfileVersion) !== "9.0") throw new Error("selected install requires a pnpm v9 lockfile");
  if (!Array.isArray(importerIds) || !importerIds.length) throw new TypeError("at least one importer path is required");
  const root = resolve(workspace), selected = new Set(), pending = [".", ...importerIds];
  while (pending.length) {
    const input = pending.pop();
    if (typeof input !== "string" || !input || isAbsolute(input) || input.includes("\0")) throw new TypeError("relative importer path required");
    const path = resolve(root, input);
    if (!contained(root, path)) throw new Error("importer escapes workspace: " + input);
    const id = portable(relative(root, path)) || ".";
    if (selected.has(id)) continue;
    const importer = lockfile.importers?.[id];
    if (!importer) throw new Error("selected importer is absent from the committed lock: " + id);
    selected.add(id);
    for (const field of fields) for (const [name, ref] of Object.entries(importer[field] ?? {})) {
      if (typeof ref !== "string") throw new TypeError("invalid locked dependency " + name + " from " + id);
      if (ref.startsWith("file:")) throw new Error("selected install cannot relocate local file dependencies: " + name);
      if (ref.startsWith("link:")) {
        const target = resolve(root, id, ref.slice(5));
        if (!contained(root, target)) throw new Error("workspace link escapes checkout: " + name + " from " + id);
        pending.push(portable(relative(root, target)) || ".");
      }
    }
  }
  return [...selected].sort();
}

/** A package projection includes the recorded Git controls that govern its checkout. */
function selectedSourceProjection(tree, selected) {
  if (selected.some(id => /[\\\r\n\0]/u.test(id))) throw new Error("selected sparse path is not literal");
  const literal = id => "/" + id.replace(/([*?\[\] ])/gu, "\\$1");
  const patterns = selected.includes(".") ? ["/*"] : ["/.gitmodules", ...selected.map(id => literal(id) + "/")];
  const blobs = new Set();
  for (const row of tree.split("\0").filter(Boolean)) {
    const tab = row.indexOf("\t"), [mode, type, oid] = row.slice(0, tab).split(" "), file = row.slice(tab + 1);
    const parent = portable(dirname(file));
    const attributes = (file === ".gitattributes" || file.endsWith("/.gitattributes"))
      && selected.some(id => id === "." || parent === "." || id === parent || id.startsWith(parent + "/"));
    if (attributes) {
      if (mode !== "100644" && mode !== "100755") throw new Error("selected checkout attributes are not regular recorded source: " + file);
      patterns.push(literal(file));
    }
    if (mode === "160000" && selected.some(id => id === file || id.startsWith(file + "/"))) patterns.push(literal(file));
    if (type === "blob" && (attributes || file === ".gitmodules" || selected.includes(".") || selected.some(id => file.startsWith(id + "/")))) blobs.add(oid);
  }
  return { patterns: [...new Set(patterns)], blobs };
}

/** Receive recorded selected Gitlinks; acquisition is allowed only during requested installation. */
export async function receiveSelectedSources({ root, importerIds, environment, onOutput, materialize = false }) {
  const git = (cwd, ...args) => execute("git", args, { cwd, environment });
  const sparse = await git(root, "config", "--bool", "core.sparseCheckout").catch((error) => {
    if (error.exitCode === 1) return "false"; throw error;
  });
  if (materialize && sparse.trim() === "true") {
    // Root-owned instance data and agency carriers are package files too. A
    // source selection which keeps only nested importers silently drops them.
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const assets = (manifest.files ?? []).filter(path => typeof path === "string" && !path.startsWith("!"))
      .map(path => path.split(/[?*[{]/u, 1)[0].replace(/\/$/u, ""));
    for (const asset of assets) {
      if (!asset || !contained(root, resolve(root, asset))) throw new Error("root package files require bounded paths within the selected checkout");
    }
    await git(root, "sparse-checkout", "add", "--skip-checks", "--", ...importerIds.filter(id => id !== "."), ...assets);
  }
  const mounts = [];
  async function receive(repository, paths) {
    const hasModules = await git(repository, "ls-tree", "HEAD", "--", ".gitmodules");
    if (!hasModules.trim()) return;
    await regularSourceFile(root, portable(relative(root, join(repository, ".gitmodules"))));
    assert.deepEqual(await readFile(join(repository, ".gitmodules")), Buffer.from(await git(repository, "show", "HEAD:.gitmodules")), "mount configuration differs from recorded source");
    const lines = await git(repository, "config", "--blob", "HEAD:.gitmodules", "--get-regexp", "[.]path$").catch((error) => {
      if (error.exitCode === 1) return ""; throw error;
    });
    for (const line of lines.trim().split("\n").filter(Boolean)) {
      const path = line.replace(/^\S+\s+/u, "");
      const wanted = paths.filter((id) => id === path || id.startsWith(path + "/"));
      if (!wanted.length) continue;
      const entry = (await git(repository, "ls-tree", "HEAD", "--", path)).trim();
      const match = /^160000 commit ([a-f0-9]{40})\t(.+)$/u.exec(entry);
      if (!match || match[2] !== path) throw new Error("selected mount is not a recorded Gitlink: " + path);
      const staged = (await git(repository, "ls-files", "--stage", "--", path)).trim();
      assert.equal(staged, "160000 " + match[1] + " 0\t" + path, "selected mount index differs from recorded source: " + path);
      const target = resolve(repository, path);
      if (!contained(root, target)) throw new Error("selected Gitlink escapes source checkout: " + path);
      const status = await git(repository, "submodule", "status", "--", path);
      if (status.startsWith("+") || status.startsWith("U")) throw new Error("selected mount differs from recorded source; preserve and reconcile it: " + path);
      if (status.startsWith("-")) {
        if (!materialize) throw new Error("selected mount is not materialized: " + path);
        onOutput?.("Materializing selected Gitlink: " + portable(relative(root, target)) + "\n");
        // Set the literal package projection BEFORE checkout. A full owner
        // checkout can hydrate unrelated corpus bodies; cone mode also includes
        // ordinary files in ancestor directories, so it is not sufficient here.
        const selected = wanted.map(id => id === path ? "." : id.slice(path.length + 1));
        const key = line.slice(0, line.search(/\s/u)).replace(/[.]path$/u, ".url");
        const url = (await git(repository, "config", "--blob", "HEAD:.gitmodules", "--get", key)).trim();
        if (!/^(?:https:\/\/github[.]com\/|git@github[.]com:|ssh:\/\/git@github[.]com\/)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[.]git)?$/u.test(url)) throw new Error("selected mount needs its committed GitHub source URL");
        // A sparse owner can hold the committed Gitlink without any physical
        // ancestor directories. Create only that recorded path, checking each
        // existing ancestor before mkdir can follow a redirected carrier.
        let parent = repository;
        for (const part of path.split("/").slice(0, -1)) {
          parent = join(parent, part);
          const held = await lstat(parent).catch(error => { if (error.code === "ENOENT") return null; throw error; });
          if (held && (!held.isDirectory() || held.isSymbolicLink())) throw new Error("selected mount parent is redirected");
          if (!held) await mkdir(parent);
        }
        if (await realpath(dirname(target)) !== dirname(target)) throw new Error("selected mount parent is redirected");
        const existing = await lstat(target).catch(error => { if (error.code === "ENOENT") return null; throw error; });
        if (existing && (!existing.isDirectory() || (await readdir(target)).length)) throw new Error("unreceived selected mount holds existing contents; preserve and reconcile it: " + path);
        await execute("git", ["submodule", "init", "--", path], { cwd: repository, environment });
        await git(repository, "init", "-q", target);
        await git(target, "remote", "add", "origin", url);
        await git(target, "config", "remote.origin.promisor", "true");
        await git(target, "config", "remote.origin.partialclonefilter", "blob:none");
        await execute("git", ["-c", "protocol.file.allow=never", "-c", "core.hooksPath=/dev/null", "fetch", "--quiet", "--depth=1", "--no-tags", "--filter=blob:none", "origin", match[1]], { cwd: target, environment });
        const objects = async () => (await git(target, "cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype)")).trim().split("\n").filter(Boolean);
        // --filter is a request: some servers warn and send an unfiltered pack.
        // A refused partial acquisition is retained, never certified or erased.
        if ((await objects()).some(row => row.endsWith(" blob"))) throw new Error("selected source transport did not honor blob:none; preserve the unreceived carrier");
        const { patterns, blobs: selectedBlobs } = selectedSourceProjection(await git(target, "ls-tree", "-r", "-z", match[1]), selected);
        await git(target, "sparse-checkout", "init", "--no-cone");
        await git(target, "sparse-checkout", "set", "--no-cone", "--", ...patterns);
        await execute("git", ["-c", "protocol.file.allow=never", "-c", "core.hooksPath=/dev/null", "checkout", "-q", "--detach", match[1]], { cwd: target, environment });
        if ((await objects()).some(row => row.endsWith(" blob") && !selectedBlobs.has(row.split(" ")[0]))) throw new Error("selected checkout received blobs outside its package projection; preserve the unreceived carrier");
      }
      assert.equal((await git(target, "rev-parse", "HEAD")).trim(), match[1], "selected mount source changed: " + path);
      if (materialize && !status.startsWith("-")) {
        const sparse = await git(target,"config","--bool","core.sparseCheckout").catch(error=>{
          if(error.exitCode===1)return "false";throw error;
        });
        if(sparse.trim()==="true") {
          const selected=wanted.map(id=>id===path?".":id.slice(path.length+1));
          const { patterns } = selectedSourceProjection(await git(target, "ls-tree", "-r", "-z", match[1]), selected);
          // Extend this recorded source owner; never repin, reset or discard
          // already received paths when a later selection needs another face.
          await git(target,"sparse-checkout","add","--no-cone","--",...patterns);
          assert.equal((await git(target,"rev-parse","HEAD")).trim(),match[1],"sparse expansion changed selected source");
        }
      }
      mounts.push({ path: portable(relative(root, target)), revision: match[1] });
      await receive(target, wanted.map((id) => id === path ? "." : id.slice(path.length + 1)));
    }
  }
  await receive(root, importerIds);
  return mounts;
}

/** Project pnpm's selected closure without changing pins, peers, integrity or workspace links. */
export function projectSelectedWorkspaceLock({ lockfile, importerIds, workspace, lockfileDirectory, filterLockfileByImporters }) {
  if (String(lockfile?.lockfileVersion) !== "9.0") throw new Error("selected install requires a pnpm v9 lockfile");
  if (lockfile.pnpmfileChecksum || Object.keys(lockfile.patchedDependencies ?? {}).length) {
    throw new Error("selected install cannot relocate pnpm hooks or patches; use their existing full-workspace install");
  }
  const selected = new Set(importerIds);
  for (const id of selected) {
    if (!lockfile.importers[id]) throw new Error("selected importer is absent from the committed lock: " + id);
    for (const field of fields) for (const [name, ref] of Object.entries(lockfile.importers[id][field] ?? {})) {
      if (ref.startsWith("file:")) throw new Error("selected install cannot relocate local file dependencies: " + name);
      if (ref.startsWith("link:")) {
        const target = portable(relative(workspace, resolve(workspace, id, ref.slice(5)))) || ".";
        if (!selected.has(target)) throw new Error("selection is not closed over workspace link " + name + " from " + id);
      }
    }
  }
  const filtered = filterLockfileByImporters(lockfile, [...selected], {
    include: { dependencies: true, devDependencies: true, optionalDependencies: true },
    skipped: new Set(), failOnMissingDependencies: true,
  });
  for (const [key, value] of Object.entries(lockfile)) {
    if (key !== "packages" && key !== "importers") assert.deepEqual(filtered[key], value, "pnpm changed lockfile metadata " + key);
  }
  for (const [key, snapshot] of Object.entries(filtered.packages ?? {})) {
    assert.deepEqual(snapshot, lockfile.packages[key], "pnpm changed locked package " + key);
    const resolution = snapshot.resolution ?? {};
    if (key.startsWith("file:") || resolution.directory || resolution.type === "directory"
      || (resolution.tarball && !/^[a-z][a-z0-9+.-]*:\/\//iu.test(resolution.tarball))) {
      throw new Error("selected install cannot relocate local package resolution " + key);
    }
    for (const field of fields) for (const ref of Object.values(snapshot[field] ?? {})) {
      if (ref.startsWith("link:") || ref.startsWith("file:")) throw new Error("selected install cannot relocate a package-local source reference: " + key);
    }
  }
  return {
    ...filtered,
    importers: Object.fromEntries([...selected].map((id) => [
      portable(relative(lockfileDirectory, resolve(workspace, id))) || ".",
      lockfile.importers[id],
    ])),
  };
}

/** Derive only workspace-star demand from actual manifests and existing canonical lock links.
 * Registry resolution, version selection and whole-lock acceptance remain pnpm-owned. */
export function deriveWorkspaceOnlyImporter({lockfile, importerId, manifest, providers}) {
  if (String(lockfile?.lockfileVersion) !== "9.0" || !lockfile.importers || !Array.isArray(providers))
    throw new TypeError("workspace-only demand requires a pnpm9 lock and source providers");
  const canonical = path => typeof path === "string" && path && !isAbsolute(path) && !/[\\\0]/u.test(path)
    && (path === "." || path.split("/").every(part => part && part !== "." && part !== ".."));
  if (!canonical(importerId) || typeof manifest?.name !== "string") throw new TypeError("canonical importer and manifest required");
  const importer = {dependencies:undefined, devDependencies:undefined, optionalDependencies:undefined, specifiers:{}}, used = [];
  for (const field of fields) for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
    if (field !== "dependencies" && name in (manifest.dependencies ?? {})) continue;
    if (specifier !== "workspace:*") throw new TypeError("workspace-only derivation cannot resolve registry or version demand: " + name);
    const matches = providers.filter(provider => provider.manifest?.name === name);
    if (matches.length !== 1 || !canonical(matches[0].path) || !lockfile.importers[matches[0].path])
      throw new Error("workspace demand needs one already-locked source owner: " + name);
    const provider = matches[0], links = new Set();
    for (const [path, row] of Object.entries(lockfile.importers)) for (const entries of fields.map(key => row[key] ?? {})) {
      const entry = entries[name];
      if (typeof entry === "string" && entry.startsWith("link:"))
        links.add(portable(relative("/", resolve("/", path, entry.slice(5)))) || ".");
    }
    if (links.size !== 1 || !links.has(provider.path)) throw new Error("workspace demand has absent or competing lock owners: " + name);
    importer.specifiers[name] = specifier;
    (importer[field] ??= {})[name] = "link:" + (portable(relative(importerId, provider.path)) || ".");
    used.push({name, path:provider.path});
  }
  return {lockfile:{...lockfile, importers:{...lockfile.importers, [importerId]:importer}}, importerId, providers:used,
    registryResolved:false, frozenReceived:false};
}

/** Read source lock data through the existing exact, frozen pnpm codec toolchain. */
export async function readWorkspaceSelectionLock({workspace, tooling}) {
  const root=await realpath(workspace), tools=await realpath(tooling);
  if(root!==resolve(workspace)||tools!==resolve(tooling))throw new Error("lock reader source or tooling is redirected");
  for(const file of ["package.json","pnpm-lock.yaml"])await regularSourceFile(tools,file);
  assert.deepEqual(await readFile(join(tools,"package.json")),await readFile(join(toolchainSource,"manifest.json")),"lock reader tooling manifest differs");
  assert.deepEqual(await readFile(join(tools,"pnpm-lock.yaml")),await readFile(join(toolchainSource,"pnpm-lock.yaml")),"lock reader tooling lock differs");
  await regularSourceFile(root,"pnpm-lock.yaml");
  const require=createRequire(join(tools,"package.json"));
  const {readWantedLockfile}=await import(pathToFileURL(require.resolve("@pnpm/lockfile.fs")).href);
  return readWantedLockfile(root,{ignoreIncompatible:false});
}

/**
 * Install a pnpm-selected source closure in a real checkout.
 * pnpm owns project discovery, graph traversal, lockfile codecs, materialization and policy checks.
 * Only generated tooling, scoped lockfiles and receipts go into the external state directory.
 */
export async function installWorkspaceSelection({
  workspace, expectedCommit, selector, importerIds: requestedImporters, materializeSources = false, planOnly = false, stateDirectory, pnpm = "pnpm", storeDirectory,
  prepareOnly = false, environment = process.env, onOutput = (chunk) => process.stderr.write(chunk),
}) {
  if ((selector !== undefined) === (requestedImporters !== undefined)) throw new TypeError("choose a pnpm selector or explicit importer paths");
  if (selector !== undefined && (typeof selector !== "string" || !selector.trim() || selector.startsWith("-"))) throw new TypeError("one nonempty pnpm selector is required");
  if ((materializeSources || planOnly) && requestedImporters === undefined) throw new TypeError("source planning and materialization require explicit importer paths");
  if (planOnly && (materializeSources || prepareOnly)) throw new TypeError("plan-only cannot install or materialize source");
  const startedAt = Date.now();
  if (!workspace || !stateDirectory) throw new TypeError("workspace and stateDirectory are required");
  const root = await realpath(resolve(workspace));
  const git = (...args) => execute("git", ["-C", root, ...args], { environment });
  assert.equal(await realpath((await git("rev-parse", "--show-toplevel")).trim()), root, "workspace must be the actual checkout root");
  const commit = (await git("rev-parse", "--verify", "HEAD^{commit}")).trim();
  if (expectedCommit !== undefined) assert.equal(commit, expectedCommit, "source checkout is not the requested revision");
  const before = new Map();
  for (const name of ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".npmrc"]) before.set(name, await optionalBytes(join(root, name)));
  if (!before.get("pnpm-workspace.yaml") || !before.get("pnpm-lock.yaml")) throw new Error("checkout must contain a workspace and committed full lockfile");
  assert.deepEqual(before.get("pnpm-lock.yaml"), Buffer.from(await git("show", "HEAD:pnpm-lock.yaml")), "full source lock must match the checkout commit");
  for (const name of [".pnpmfile.cjs", ".pnpmfile.mjs"]) {
    if (await optionalBytes(join(root, name))) throw new Error("selected install cannot relocate pnpm hooks: " + name);
  }
  await mkdir(resolve(stateDirectory), { recursive: true });
  const state = await realpath(resolve(stateDirectory));
  if (contained(root, state)) throw new Error("generated installation state must be outside the source checkout");
  const guard = join(state, ".install-" + digest(root).slice(0, 16));
  await mkdir(guard).catch((cause) => { throw new Error("another selected install holds " + guard, { cause }); });
  let receipt;
  let receiptPath;
  try {
    const runPnpm = (args, cwd = root, output) => execute(pnpm, args, { cwd, environment, onOutput: output });
    const pnpmVersion = (await runPnpm(["--version"])).trim();
    const version = /^(\d+)\.(\d+)\.(\d+)/u.exec(pnpmVersion);
    if (!version || Number(version[1]) < 11 || (Number(version[1]) === 11 && Number(version[2]) < 19)) {
      throw new Error("selected install requires pnpm 11.19 or newer, without downgrading or disabling policy checks");
    }
    const policies = {};
    for (let offset = 0; offset < policyNames.length; offset += 4) {
      const values = await Promise.all(policyNames.slice(offset, offset + 4).map(async (name) =>
        [name, (await runPnpm(["config", "get", name, "--json"])).trim()]));
      for (const [name, value] of values) if (value) policies[name] = JSON.parse(value);
    }
    // The bootstrap uses only official, pinned pnpm packages and its own frozen lock.
    // Carry applicable source supply/build policies into the isolated toolchain as well.
    const toolManifest = await readFile(join(toolchainSource, "manifest.json"));
    const toolLock = await readFile(join(toolchainSource, "pnpm-lock.yaml"));
    const toolWorkspace = json({ packages: [], ...policies });
    const tooling = join(state, "tooling", digest(Buffer.concat([toolManifest, toolLock, Buffer.from(toolWorkspace)])));
    await mkdir(tooling, { recursive: true });
    await writeFile(join(tooling, "package.json"), toolManifest);
    await writeFile(join(tooling, "pnpm-lock.yaml"), toolLock);
    await writeFile(join(tooling, "pnpm-workspace.yaml"), toolWorkspace);
    const storeArgs = storeDirectory ? ["--store-dir=" + resolve(storeDirectory)] : [];
    await runPnpm([...storeArgs, "install", "--frozen-lockfile", "--ignore-scripts"], tooling, onOutput);
    assert.deepEqual(await readFile(join(tooling, "pnpm-lock.yaml")), toolLock, "toolchain frozen lock changed");
    const require = createRequire(join(tooling, "package.json"));
    const { readWantedLockfile, writeWantedLockfile } = await import(pathToFileURL(require.resolve("@pnpm/lockfile.fs")).href);
    const { filterLockfileByImporters } = await import(pathToFileURL(require.resolve("@pnpm/lockfile.filtering")).href);
    const sourceLock = await readWantedLockfile(root, { ignoreIncompatible: false });
    let importerIds, sourceMounts = [];
    if (requestedImporters !== undefined) {
      importerIds = selectLockedWorkspaceClosure({ lockfile: sourceLock, importerIds: requestedImporters, workspace: root });
      if (planOnly) {
        assert.equal((await git("rev-parse", "HEAD")).trim(), commit, "source revision changed during selection");
        for (const [name, bytes] of before) assert.deepEqual(await optionalBytes(join(root, name)), bytes, "source configuration changed: " + name);
        return { type: "NodeRuntimeLockedSourceSelection", version: 1, workspace: root, commit,
          roots: requestedImporters, importerIds, sourceLockSha256: digest(before.get("pnpm-lock.yaml")),
          sourceImporterCount: Object.keys(sourceLock.importers).length, sourceConfigurationUnchanged: true,
          elapsedMilliseconds: Date.now() - startedAt };
      }
      if (materializeSources) sourceMounts = await receiveSelectedSources({ root, importerIds, environment, onOutput, materialize: true });
      const sourceChanges = await git("status", "--porcelain=v1", "--untracked-files=normal", "--", "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".npmrc", ...importerIds.filter((id) => id !== "."));
      if (sourceChanges.trim()) throw new Error("selected source has local changes; preserve and reconcile it before locked installation");
    } else {
      const projects = JSON.parse(await runPnpm(["--filter", selector, "--fail-if-no-match", "list", "--depth=-1", "--json"]));
      if (!projects.length) throw new Error("pnpm selector matched no projects");
      importerIds = [...new Set([".", ...projects.map(({ path }) => {
        if (!contained(root, resolve(path))) throw new Error("pnpm selected a project outside the checkout");
        return portable(relative(root, resolve(path))) || ".";
      })])].sort();
    }
    // Even already-materialized and selector-based installs record the same
    // committed mount custody which later build/pack commands must re-receive.
    if (!materializeSources) sourceMounts = await receiveSelectedSources({ root, importerIds, environment });
    const workspaceArgs = importerIds.map((id) => "--workspace-packages=" + id);
    const exactFilters = exactImporterFilterArgs(importerIds);
    const scopedProjects = JSON.parse(await runPnpm([...workspaceArgs, ...exactFilters, "list", "--recursive", "--depth=-1", "--json"]));
    assert.deepEqual(scopedProjects.map(({ path }) => portable(relative(root, path)) || ".").sort(), importerIds, "explicit pnpm workspace scope differs from selection");
    const manifestHashes = {};
    for (const id of importerIds) manifestHashes[id] = digest(await readFile(join(root, id, "package.json")));
    const sourceHashes = Object.fromEntries([...before].filter(([, bytes]) => bytes !== undefined).map(([name, bytes]) => [name, digest(bytes)]));
    const identity = { workspace: root, commit, ...(selector === undefined ? { roots: requestedImporters } : { selector }), pnpmVersion, sourceHashes, manifestHashes };
    const artifact = join(state, "selections", digest(json(identity)));
    await mkdir(artifact, { recursive: true });
    const scopedLock = projectSelectedWorkspaceLock({ lockfile: sourceLock, importerIds, workspace: root, lockfileDirectory: artifact, filterLockfileByImporters });
    await writeWantedLockfile(artifact, scopedLock);
    assert.deepEqual(await readWantedLockfile(artifact, { ignoreIncompatible: false }), scopedLock, "selected lock failed semantic round trip");
    const scopedBytes = await readFile(join(artifact, "pnpm-lock.yaml"));
    const command = [...storeArgs, "--lockfile-dir=" + artifact, ...workspaceArgs, ...(selector === undefined ? exactFilters : ["--filter", selector]), "install", "--frozen-lockfile", "--ignore-scripts"];
    receipt = {
      type: "NodeRuntimeWorkspaceSelectionInstallReceipt", version: 1, ...identity,
      recordedAt: new Date().toISOString(), artifact, tooling, importerIds, sourceMounts, selectionElapsedMilliseconds: Date.now() - startedAt,
      sourceImporterCount: Object.keys(sourceLock.importers).length,
      selectedPackageSnapshots: Object.keys(scopedLock.packages ?? {}).length,
      sourcePackageSnapshots: Object.keys(sourceLock.packages ?? {}).length,
      scopedLockSha256: digest(scopedBytes), toolchainLockSha256: digest(toolLock),
      executable: pnpm, command, status: "prepared", scriptsIgnored: true,
    };
    receiptPath = join(artifact, "install-receipt.json");
    await writeFile(receiptPath, json(receipt));
    if (!prepareOnly) {
      const started = Date.now();
      const bins = await sourceBinModes(root, importerIds);
      try { await runPnpm(command, root, onOutput); }
      finally { await preserveSourceBinModes(bins); }
      receipt.elapsedMilliseconds = Date.now() - started;
      assert.deepEqual(await readFile(join(artifact, "pnpm-lock.yaml")), scopedBytes, "selected frozen lock changed");
      receipt.status = "installed";
    }
    for (const [name, bytes] of before) assert.deepEqual(await optionalBytes(join(root, name)), bytes, "source configuration changed: " + name);
    for (const [id, hash] of Object.entries(manifestHashes)) assert.equal(digest(await readFile(join(root, id, "package.json"))), hash, "source manifest changed: " + id);
    assert.equal((await git("rev-parse", "HEAD")).trim(), commit, "source revision changed during installation");
    receipt.sourceConfigurationUnchanged = true;
    await writeFile(receiptPath, json(receipt));
    return { ...receipt, receiptPath };
  } catch (error) {
    if (receiptPath) await writeFile(receiptPath, json({ ...receipt, status: "refused", error: error.message }));
    throw error;
  } finally {
    await rm(guard, { recursive: true });
  }
}
