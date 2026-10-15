/**
 * A workspace's lockfile is derived source: the package manager's resolution of the commit's
 * workspace manifests, starting from the resolutions the commit's lockfile already holds. Nobody
 * authors it. Integration derives it for every commit it admits, from that commit's manifests --
 * the root pnpm files and every package.json, including those of the submodules at the commits
 * their gitlinks record -- so a writer whose checkout lacks a submodule, or whose hand merged two
 * lockfiles, cannot put a lockfile on main that the release install refuses.
 *
 * Both readings work on the commit's objects, never a working tree: the manifests are written to a
 * scratch directory, and the package manager reads only them and the lockfile there.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const LOCKFILE = "pnpm-lock.yaml";
const ROOT_FILES = new Set(["package.json", LOCKFILE, "pnpm-workspace.yaml", ".npmrc"]);

const gitSync = (gitDir, ...args) => execFileSync("git", [`--git-dir=${gitDir}`, ...args], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });

/** The commit's submodule names by path, from its .gitmodules (a module's gitdir is named for it). */
function submoduleNames(gitDir, commit) {
  let config;
  try { config = gitSync(gitDir, "show", `${commit}:.gitmodules`).toString(); }
  catch { return new Map(); }
  const names = new Map();
  let name;
  for (const line of config.split("\n")) {
    const section = line.match(/^\s*\[submodule\s+"(.+)"\]/u);
    if (section) name = section[1];
    const path = line.match(/^\s*path\s*=\s*(.+?)\s*$/u);
    if (path && name) names.set(path[1], name);
  }
  return names;
}

/**
 * The commit's workspace manifests (and its submodules', recursively) as `{ gitDir, path, object }`:
 * every package.json, and at the root the files the package manager reads. Only trees are walked,
 * so naming them reads no file; a submodule's missing objects are fetched.
 */
export function workspaceManifestEntries(gitDir, commit, { rootFiles = ROOT_FILES, prefix = "", fetchMissing = true } = {}) {
  const names = submoduleNames(gitDir, commit);
  const found = [];
  for (const entry of gitSync(gitDir, "ls-tree", "-r", "-z", commit).toString().split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t"), meta = entry.slice(0, tab), path = entry.slice(tab + 1);
    const [mode, type, object] = meta.split(" ");
    if (type === "commit") {
      const moduleDir = join(gitDir, "modules", names.get(path) ?? path);
      if (!within(resolve(gitDir, "modules"), resolve(moduleDir))) throw new Error(`workspace mount name escapes its repository: ${prefix}${path}`);
      try { gitSync(moduleDir, "cat-file", "-e", `${object}^{commit}`); }
      catch (cause) {
        if (!fetchMissing) throw new Error(`workspace manifest source is not locally available: ${prefix}${path}@${object}`, { cause });
        gitSync(moduleDir, "fetch", "--quiet", "origin", object);
      }
      found.push(...workspaceManifestEntries(moduleDir, object, { rootFiles, prefix: `${prefix}${path}/`, fetchMissing }));
    } else if (type === "blob" && (path === "package.json" || path.endsWith("/package.json") || (!prefix && rootFiles.has(path)))) {
      // A submodule's own package.json sits at its root, where its path has no directory.
      if (mode !== "100644" && mode !== "100755") throw new Error(`workspace input is not a regular source file: ${prefix}${path}`);
      found.push({ gitDir, path: `${prefix}${path}`, object });
    }
  }
  return found;
}

/** Writes the commit's workspace manifests (and its submodules', recursively) under `out`. */
export function extractWorkspaceManifests(gitDir, commit, out, { entries = workspaceManifestEntries(gitDir, commit) } = {}) {
  const byRepository = new Map();
  for (const entry of entries) byRepository.set(entry.gitDir, [...(byRepository.get(entry.gitDir) ?? []), entry]);
  for (const [repository, blobs] of byRepository) {
    // One cat-file for the lot: each record is "<oid> blob <size>\n<bytes>\n".
    const batch = execFileSync("git", [`--git-dir=${repository}`, "cat-file", "--batch"], {
      input: blobs.map(({ object }) => object).join("\n") + "\n", maxBuffer: 1 << 28,
    });
    let offset = 0;
    for (const { path, object } of blobs) {
      const target = join(out, path);
      const headerEnd = batch.indexOf(10, offset);
      const [actual, type, length] = batch.subarray(offset, headerEnd).toString().split(" ");
      const size = Number(length);
      if (actual !== object || type !== "blob" || !Number.isSafeInteger(size) || size < 0 || headerEnd + size + 2 > batch.length) throw new Error(`unread workspace input: ${path}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, batch.subarray(headerEnd + 1, headerEnd + 1 + size));
      offset = headerEnd + 1 + size + 1;
    }
  }
}

// Submodule repositories belong to this worktree. The shared common directory
// holds root objects, but not the linked worktree’s initialized modules.
const gitDirOf = (repository) => execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repository }).toString().trim();
// What the package manager said about its refusal, without the cyclic-workspace warning that
// leads every run of this workspace.
const saidOf = (output) => output.split("\n").filter((line) => line.trim() && !/cyclic workspace/iu.test(line)).slice(-24).join("\n");

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const within = (root, path) => {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};

/** Read the exact input projection without a package-manager bootstrap or remote fetch. */
export function planWorkspaceLockfile({ repository, commit = "HEAD", fetchMissing = false }) {
  const gitDir = gitDirOf(repository);
  const source = gitSync(gitDir, "rev-parse", "--verify", `${commit}^{commit}`).toString().trim();
  for (const hook of [".pnpmfile.cjs", ".pnpmfile.mjs"]) {
    if (gitSync(gitDir, "ls-tree", source, "--", hook).length) throw new Error(`manifest-only qualification cannot omit source hook: ${hook}`);
  }
  const entries = workspaceManifestEntries(gitDir, source, { fetchMissing }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const inputs = entries.map(({ path, object }) => ({ path, object }));
  for (const required of ["package.json", "pnpm-workspace.yaml"]) {
    if (!inputs.some(({ path }) => path === required)) throw new Error(`workspace source is missing ${required}`);
  }
  return { repository: realpathSync(repository), commit: source, gitDir, entries, inputs };
}

/** The existing release contract's frozen step, narrowed to manifest/lock receiving. */
function commandArguments(command, home) {
  // A deliberately bounded invocation grammar, not a shell interpreter. The
  // release's dependencies/lockfile.derive contracts are simple pnpm commands.
  // Control flow, expansions and substitutions must never mask install failure.
  if (Array.isArray(command)) {
    if (!command.length || command.some(value => typeof value !== "string" || !value || value.includes("\0"))) throw new TypeError("nonempty package-manager argv is required");
    return command.map(value => value.startsWith("~/") ? `${home}/${value.slice(2)}` : value);
  }
  if (typeof command !== "string" || !command.trim()) throw new TypeError("one simple package-manager invocation is required");
  const tokens = [], pattern = /[ \t]*(?:'([^'\n]*)'|"([^"$`\\\n]*)"|([A-Za-z0-9_@%+=:,.~\/!-]+))([ \t]*)/uy;
  let offset = 0;
  while (offset < command.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(command);
    if (!match || match.index !== offset || pattern.lastIndex === offset) throw new TypeError("unsupported shell syntax in workspace package-manager command");
    if (pattern.lastIndex < command.length && !match[4]) throw new TypeError("workspace command words require whitespace; use explicit argv for concatenated quoting");
    const token = match[1] ?? match[2] ?? match[3];
    if (!token) throw new TypeError("empty workspace command argument");
    tokens.push(token.startsWith("~/") ? `${home}/${token.slice(2)}` : token);
    offset = pattern.lastIndex;
  }
  return tokens;
}

function invocationIdentity(args, environment) {
  const runnable = path => { try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; } };
  const executable = args[0].includes("/") ? resolve(args[0]) : (environment.PATH ?? "").split(":").map(path => join(path, args[0])).find(runnable);
  if (!executable || !runnable(executable)) throw Object.assign(new Error(`workspace tool is unavailable: ${args[0]}`), { interrupted: true });
  const entry = path => {
    try { const actual = realpathSync(path); return { path: actual, sha256: hash(readFileSync(actual)) }; }
    catch (cause) { throw Object.assign(new Error(`workspace tool entry is unavailable: ${path}`, { cause }), { interrupted: true }); }
  };
  const tools = [entry(executable)];
  // An explicit Node/JS entrypoint is part of the invocation, not merely an
  // unchanged interpreter binary. Package-manager symlink targets are read too.
  for (const arg of args.slice(1)) if (/\.(?:[mc]?js)$/u.test(arg) && isAbsolute(arg)) tools.push(entry(arg));
  return tools;
}

export function frozenWorkspaceLockfileArguments(install, home = process.env.HOME) {
  const args = commandArguments(install, home);
  assertProjectionArguments(args);
  if (!args.includes("--frozen-lockfile")) throw new TypeError("workspace qualification requires one release frozen-lockfile install step");
  return [...args, "--frozen-lockfile", "--lockfile-only", "--ignore-scripts"];
}

function assertProjectionArguments(args) {
  if (args.includes("--") || args.some(arg => /^(?:--(?:config[.])?(?:dir|lockfile-dir|workspace-dir|workspace-root|workspace-packages)|-C|--global|-g)(?:=|$)/u.test(arg))) {
    throw new TypeError("workspace qualification cannot replace the projected source or lock scope");
  }
}

function invoke(args, cwd, environment) {
  return new Promise((accept, reject) => {
    const child = spawn(args[0], args.slice(1), { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("error", cause => reject(Object.assign(new Error("workspace tool could not execute", { cause }), { interrupted: true })));
    child.once("close", (code, signal) => accept({ code, signal, output }));
  });
}

function sourceInputsUnchanged(directory, originals, { frozen = false } = {}) {
  for (const [path, bytes] of originals) {
    if (!frozen && path === LOCKFILE) continue;
    let current = directory;
    for (const [index, part] of path.split("/").entries()) {
      current = join(current, part);
      const entry = lstatSync(current);
      if (entry.isSymbolicLink() || (index === path.split("/").length - 1 ? !entry.isFile() : !entry.isDirectory())) throw new Error(`workspace input was redirected: ${path}`);
    }
    if (!readFileSync(current).equals(bytes)) throw new Error(`workspace input changed during qualification: ${path}`);
  }
}

// The release owner already uses a kernel lease kept until its controller's stdin
// closes. Reuse that lifetime here: SIGKILL releases it without a clock-based steal.
async function qualificationLease(file) {
  if (existsSync(file) && !lstatSync(file).isFile()) throw new Error("qualification lease is not a regular file");
  const keeper = "process.stdout.write('locked\\n'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));";
  const child = spawn("flock", ["--exclusive", "--nonblock", file, process.execPath, "-e", keeper], { stdio: ["pipe", "pipe", "pipe"] });
  let held = false, releasing = false, said = "";
  const closed = new Promise(resolveExit => child.once("close", resolveExit));
  await new Promise((accept, reject) => {
    let output = "";
    child.stdout.on("data", bytes => { output += bytes; if (!held && output.includes("locked\n")) { held = true; accept(); } });
    child.stderr.on("data", bytes => { said += bytes; });
    child.once("error", cause => reject(Object.assign(new Error("qualification lease could not start", { cause }), { interrupted: true })));
    child.once("close", code => { const acquired = held; held = false; if (!acquired) reject(Object.assign(new Error(`qualification lease is busy or unavailable (${code}): ${said.trim()}`), { interrupted: true })); });
  });
  return {
    assertHeld() { if (!held || releasing) throw Object.assign(new Error("qualification lease was interrupted"), { interrupted: true }); },
    async release() { releasing = true; child.stdin.end(); await closed; },
  };
}

/**
 * Resolve once, then independently receive the exact result with the release's frozen command.
 * A retained derivation is only a candidate: every resumption re-extracts immutable inputs and
 * repeats frozen receiving. No successful process exit or cache record establishes acceptance.
 */
export async function qualifyWorkspaceLockfile({ repository, commit, derive, install, stateDirectory, rederive = false,
  home = process.env.HOME, environment = process.env }) {
  if (!derive) throw new TypeError("workspace derivation command is required");
  const frozen = frozenWorkspaceLockfileArguments(install, home);
  const plan = planWorkspaceLockfile({ repository, commit, fetchMissing: true });
  const identity = { commit: plan.commit, inputs: plan.inputs, derive: [...commandArguments(derive, home), "--lockfile-only", "--ignore-scripts"], frozen };
  assertProjectionArguments(identity.derive);
  identity.tools = { derive: invocationIdentity(identity.derive, environment), frozen: invocationIdentity(frozen, environment) };
  const toolsUnchanged = () => {
    const current = { derive: invocationIdentity(identity.derive, environment), frozen: invocationIdentity(frozen, environment) };
    if (JSON.stringify(current) !== JSON.stringify(identity.tools)) throw Object.assign(new Error("workspace qualification tools changed during execution"), { interrupted: true });
  };
  let artifact, lease, scratch, receiver;
  if (stateDirectory !== undefined) {
    const state = resolve(stateDirectory);
    if (within(plan.repository, state)) throw new Error("workspace qualification state must be outside source");
    mkdirSync(state, { recursive: true });
    if (realpathSync(state) !== state) throw new Error("workspace qualification state is redirected");
    artifact = join(state, hash(JSON.stringify(identity)));
    mkdirSync(artifact, { recursive: true });
    if (realpathSync(artifact) !== artifact) throw new Error("workspace qualification artifact is redirected");
    lease = await qualificationLease(join(artifact, "qualification.lease"));
  }
  try {
    scratch = mkdtempSync(join(artifact ?? tmpdir(), "workspace-lockfile-"));
    extractWorkspaceManifests(plan.gitDir, plan.commit, scratch, { entries: plan.entries });
    const originals = new Map(plan.inputs.map(({ path }) => [path, readFileSync(join(scratch, path))]));
    const committed = originals.get(LOCKFILE);
    const retained = artifact && join(artifact, "derived-lock.json");
    let resumed = false, said = "", lockfile;
    if (!rederive && retained && existsSync(retained)) {
      if (!lstatSync(retained).isFile()) throw new Error("retained workspace derivation is not a regular file");
      const record = JSON.parse(readFileSync(retained, "utf8"));
      if (JSON.stringify(record.inputs) !== JSON.stringify(identity) || typeof record.lockfile !== "string") throw new Error("retained workspace derivation inputs differ");
      lockfile = Buffer.from(record.lockfile, "base64");
      if (hash(lockfile) !== record.sha256) throw new Error("retained workspace derivation bytes differ");
      writeFileSync(join(scratch, LOCKFILE), lockfile);
      resumed = true;
    } else {
      const result = await invoke(identity.derive, scratch, environment);
      said = saidOf(result.output);
      sourceInputsUnchanged(scratch, originals);
      if (result.code !== 0) throw Object.assign(new Error(`lockfile derivation refused ${plan.commit}: ${said}`), { said, signal: result.signal, interrupted: Boolean(result.signal) });
      if (!lstatSync(join(scratch, LOCKFILE)).isFile()) throw new Error("derived workspace lock is not a regular file");
      lockfile = readFileSync(join(scratch, LOCKFILE));
      toolsUnchanged();
      lease?.assertHeld();
      if (retained) {
        // One atomic record binds identity and bytes. An interrupted publication
        // cannot leave a new lock with an old receipt or a reusable partial pair.
        writeFileSync(join(scratch, "retained-inputs"), JSON.stringify({ inputs: identity, sha256: hash(lockfile), lockfile: lockfile.toString("base64") }) + "\n", { flag: "wx" });
        renameSync(join(scratch, "retained-inputs"), retained);
      }
    }
    // The resolver's additional manifests, config, hooks, caches and node_modules
    // cannot become receiver inputs. Reconstruct the original projection afresh.
    receiver = mkdtempSync(join(artifact ?? tmpdir(), "workspace-receiver-"));
    extractWorkspaceManifests(plan.gitDir, plan.commit, receiver, { entries: plan.entries });
    writeFileSync(join(receiver, LOCKFILE), lockfile);
    lease?.assertHeld();
    const received = await invoke(identity.frozen, receiver, environment);
    sourceInputsUnchanged(receiver, new Map([...originals, [LOCKFILE, lockfile]]), { frozen: true });
    const receivedSaid = saidOf(received.output);
    if (received.code !== 0) throw Object.assign(new Error(`derived lock failed frozen receiving ${plan.commit}: ${receivedSaid}`), { said: receivedSaid, signal: received.signal, interrupted: Boolean(received.signal) });
    lease?.assertHeld();
    toolsUnchanged();
    if (artifact) {
      writeFileSync(join(receiver, "received-lock"), lockfile, { flag: "wx" });
      renameSync(join(receiver, "received-lock"), join(artifact, "pnpm-lock.yaml"));
    }
    return { lockfile, changed: committed === undefined || !committed.equals(lockfile), said,
      received: true, resumed, commit: plan.commit, inputs: plan.inputs, ...(artifact ? { artifact } : {}) };
  } finally {
    try {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      if (receiver) rmSync(receiver, { recursive: true, force: true });
    } finally { await lease?.release(); }
  }
}

/**
 * Runs `command` over the commit's manifests. `derive` returns the lockfile the command left; `check`
 * only its verdict. The command is the spec's: a frozen check is the release install with
 * `--lockfile-only`; a derivation resolves online so the store learns any new registry package.
 */
async function overManifests({ repository, commit, command, home = process.env.HOME, environment = process.env }) {
  const scratch = mkdtempSync(join(tmpdir(), "workspace-lockfile-"));
  try {
    extractWorkspaceManifests(gitDirOf(repository), commit, scratch);
    const { code, output } = await invoke(commandArguments(command, home), scratch, environment);
    const lockfile = (() => { try { return readFileSync(join(scratch, LOCKFILE)); } catch { return null; } })();
    return { code, said: saidOf(output), lockfile };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Whether the commit's lockfile satisfies its manifests as the release's frozen install reads them. */
export async function checkWorkspaceLockfile({ repository, commit, install, ...rest }) {
  const frozen = frozenWorkspaceLockfileArguments(install, rest.home);
  const { code, said } = await overManifests({ repository, commit, command: frozen, ...rest });
  return { ok: code === 0, said };
}

/** The lockfile the commit's manifests derive, and whether it differs from the one committed. */
export async function deriveWorkspaceLockfile({ repository, commit, derive, ...rest }) {
  return qualifyWorkspaceLockfile({ repository, commit, derive, ...rest });
}

