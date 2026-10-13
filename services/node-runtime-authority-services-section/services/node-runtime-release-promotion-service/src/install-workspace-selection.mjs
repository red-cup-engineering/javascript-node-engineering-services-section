import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
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
      // A superrepo pathspec does not inspect files beneath a gitlink. Refuse
      // dirty source at the actual package before preserving its bin modes.
      const changed = await execute("git", ["-C", join(root, id), "status", "--porcelain=v1",
        "--untracked-files=no", "--ignore-submodules=none", "--", "."]);
      if (changed.trim()) sourceChanges.push({importerId: id, changes: changed.trim()});
    }
    for (const entry of entries) {
      const file = resolve(root, id, entry);
      if (!contained(root, file)) throw new Error("source bin escapes the selected checkout");
      const bytes = await optionalBytes(file);
      if (bytes !== undefined) bins.set(file, { mode: (await stat(file)).mode & 0o777, hash: digest(bytes) });
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
    assert.equal(digest(await readFile(file)), original.hash, "source bin changed during installation: " + file);
    const mode = (await stat(file)).mode & 0o777;
    if (mode !== original.mode) {
      // pnpm links source bins and adds execute bits. Preserve the immutable
      // checkout's modes; deployed copies receive their executable bin modes.
      if ((mode & ~0o111) !== (original.mode & ~0o111)) throw new Error("source bin permissions changed beyond executable bits: " + file);
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
  return root;
}

/** Reuse the frozen installation's scope for its actual generation or packing command. */
export async function runWorkspaceSelection({ receipt, arguments: args, environment = process.env, onOutput } = {}) {
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
  const scope = receipt.importerIds.filter(id => id !== ".").map(id => "--workspace-packages=" + id);
  // `run` does not expose install's --lockfile-dir CLI flag; the maintained
  // pnpm config namespace carries this same setting across both commands.
  const command = ["--config.lockfile-dir=" + receipt.artifact, ...scope, ...args];
  const bins = await sourceBinModes(root, receipt.importerIds);
  try { await execute(receipt.executable, command, { cwd: root, environment, onOutput }); }
  finally { await preserveSourceBinModes(bins); }
  await verifyWorkspaceSelection(receipt, { environment });
  return { type: "NodeRuntimeWorkspaceSelectionCommandReceipt", version: 1, commit: receipt.commit,
    executable: receipt.executable, arguments: args, sourceConfigurationUnchanged: true };
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

/** Receive recorded selected Gitlinks; acquisition is allowed only during requested installation. */
async function receiveSelectedSources({ root, importerIds, environment, onOutput, materialize = false }) {
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
        await execute("git", ["-c", "protocol.file.allow=never", "submodule", "update", "--init", "--checkout", "--", path], { cwd: repository, environment });
      }
      assert.equal((await git(target, "rev-parse", "HEAD")).trim(), match[1], "selected mount source changed: " + path);
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
    const workspaceArgs = importerIds.filter((id) => id !== ".").map((id) => "--workspace-packages=" + id);
    const scopedProjects = JSON.parse(await runPnpm([...workspaceArgs, "list", "--recursive", "--depth=-1", "--json"]));
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
    const command = [...storeArgs, "--lockfile-dir=" + artifact, ...workspaceArgs, "install", ...(selector === undefined ? [] : ["--filter", selector]), "--frozen-lockfile", "--ignore-scripts"];
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
