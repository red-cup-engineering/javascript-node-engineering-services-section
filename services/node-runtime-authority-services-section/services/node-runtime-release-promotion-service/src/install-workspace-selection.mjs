import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  workspace, selector, stateDirectory, pnpm = "pnpm", storeDirectory,
  prepareOnly = false, environment = process.env, onOutput = (chunk) => process.stderr.write(chunk),
}) {
  if (typeof selector !== "string" || !selector.trim() || selector.startsWith("-")) throw new TypeError("one nonempty pnpm selector is required");
  if (!workspace || !stateDirectory) throw new TypeError("workspace and stateDirectory are required");
  const root = await realpath(resolve(workspace));
  const git = (...args) => execute("git", ["-C", root, ...args], { environment });
  assert.equal(await realpath((await git("rev-parse", "--show-toplevel")).trim()), root, "workspace must be the actual checkout root");
  const commit = (await git("rev-parse", "--verify", "HEAD^{commit}")).trim();
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
    const projects = JSON.parse(await runPnpm(["--filter", selector, "--fail-if-no-match", "list", "--depth=-1", "--json"]));
    if (!projects.length) throw new Error("pnpm selector matched no projects");
    const importerIds = [...new Set([".", ...projects.map(({ path }) => {
      const id = portable(relative(root, resolve(path))) || ".";
      if (!contained(root, resolve(path))) throw new Error("pnpm selected a project outside the checkout");
      return id;
    })])].sort();
    const workspaceArgs = importerIds.filter((id) => id !== ".").map((id) => "--workspace-packages=" + id);
    const scopedProjects = JSON.parse(await runPnpm([...workspaceArgs, "list", "--recursive", "--depth=-1", "--json"]));
    assert.deepEqual(scopedProjects.map(({ path }) => portable(relative(root, path)) || ".").sort(), importerIds, "explicit pnpm workspace scope differs from selection");
    const manifestHashes = {};
    for (const id of importerIds) manifestHashes[id] = digest(await readFile(join(root, id, "package.json")));
    const policies = {};
    for (const name of policyNames) {
      const value = (await runPnpm(["config", "get", name, "--json"])).trim();
      if (value) policies[name] = JSON.parse(value);
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
    const sourceHashes = Object.fromEntries([...before].filter(([, bytes]) => bytes !== undefined).map(([name, bytes]) => [name, digest(bytes)]));
    const identity = { workspace: root, commit, selector, pnpmVersion, sourceHashes, manifestHashes };
    const artifact = join(state, "selections", digest(json(identity)));
    await mkdir(artifact, { recursive: true });
    const scopedLock = projectSelectedWorkspaceLock({ lockfile: sourceLock, importerIds, workspace: root, lockfileDirectory: artifact, filterLockfileByImporters });
    await writeWantedLockfile(artifact, scopedLock);
    assert.deepEqual(await readWantedLockfile(artifact, { ignoreIncompatible: false }), scopedLock, "selected lock failed semantic round trip");
    const scopedBytes = await readFile(join(artifact, "pnpm-lock.yaml"));
    const command = [...storeArgs, "--lockfile-dir=" + artifact, ...workspaceArgs, "install", "--filter", selector, "--frozen-lockfile", "--ignore-scripts"];
    receipt = {
      type: "NodeRuntimeWorkspaceSelectionInstallReceipt", version: 1, ...identity,
      recordedAt: new Date().toISOString(), artifact, tooling, importerIds,
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
      await runPnpm(command, root, onOutput);
      receipt.elapsedMilliseconds = Date.now() - started;
      assert.deepEqual(await readFile(join(artifact, "pnpm-lock.yaml")), scopedBytes, "selected frozen lock changed");
      receipt.status = "installed";
    }
    for (const [name, bytes] of before) assert.deepEqual(await optionalBytes(join(root, name)), bytes, "source configuration changed: " + name);
    for (const [id, hash] of Object.entries(manifestHashes)) assert.equal(digest(await readFile(join(root, id, "package.json"))), hash, "source manifest changed: " + id);
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
