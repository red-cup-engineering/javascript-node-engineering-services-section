#!/usr/bin/env node
// Release one commit of a repository to a host, as a spec kept with the instance describes:
//   node release-git-commit.mjs <release.json> [--commit <ref>]
//   node release-git-commit.mjs --spec-in-commit <path> --repository <checkout> [--commit <ref>]
//   node release-git-commit.mjs ... --admit
// The second form reads the spec from the commit being released, so the desired state is exactly
// what the commit says, and it runs from a release as well as from a checkout.
// The spec names the host, the release and receipt roots (relative to the host's home), the
// pathspec groups archived from the commit, and the install, restart and health commands.
// The commit's tree is staged on the host, materialized as a content-addressed release,
// installed and verified before any downtime. A backup requires a managed systemd unit: stop
// its state writers, finish and verify the archive, then promote `current` and restart. A failed
// snapshot resumes the existing release without moving its pointer. `previous` remains available
// for rollback after promotion. Completed snapshots are retained and optionally copied off host.
// Admission (--admit) runs the same staging, materialization, install and verification and stops
// before promotion: pushing a commit is releasing it, so a commit is admitted before it is pushed,
// and the release then reuses the tree admission materialized. An unadmitted commit was never
// released, so it leaves no refusal receipt.
// An integrator (src/integrate.mjs) passes `beforePromotion`, run once the commit is admitted and
// before any downtime: it publishes the admitted commit as main, so main never names a commit the
// node refused. A step that defers (an error marked `deferred`, such as main having moved since
// the commit was composed) ends the release without promotion and without a refusal: the commit
// was not refused, only overtaken.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { constants, homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { constants as zlibConstants, createZstdCompress } from "node:zlib";
import { EMPTY_TREE, WRITE_BATCH, composedModules, excluding, literalPath, moduleRepository, moduleTree, releaseIdentity, sampledEntries, stageFromPrevious, stagePlan, writtenSources } from "../src/release-source.mjs";
import { adoptDependencies, carryDependencies, installKeyOf, pnpmCommandOf } from "../src/dependency-reuse.mjs";
import { prunedSnapshots } from "../src/snapshot-retention.mjs";
import { prepareRuntimeBindings, runtimeBindingTransaction, retainedRuntimeTargets } from "../src/runtime-bindings.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
}

const here = dirname(fileURLToPath(import.meta.url));
// A mounted section's checkout: its .git is a file naming a git directory inside its superproject's
// modules. The tree it ships in is the superproject that mounts it, not the section alone.
function isMountedCheckout(candidate) {
  const marker = resolve(candidate, ".git");
  try { return statSync(marker).isFile() && /\/modules\//u.test(readFileSync(marker, "utf8")); } catch { return false; }
}
// The tree this script ships in: a checkout (the outermost, through any mounts), or a materialized release
// carrying its receipt.
function treeRoot(directory) {
  for (let candidate = directory; ; candidate = dirname(candidate)) {
    if ((existsSync(resolve(candidate, ".git")) && !isMountedCheckout(candidate)) || existsSync(resolve(candidate, "release-receipt.json"))) return candidate;
    if (dirname(candidate) === candidate) throw new Error(`no checkout or release contains ${directory}`);
  }
}
// The commit whose release tool this is, as the tree's receipt names it (a release, or the tool tree
// a reconciler extracted from the commit it releases). A checkout's working tree is no commit's.
function toolCommit() {
  const receipt = resolve(treeRoot(here), "release-receipt.json");
  return existsSync(receipt) ? JSON.parse(readFileSync(receipt, "utf8")).source?.commit ?? null : null;
}
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

// A step another process ended (a memory killer, a shutdown) says nothing about the commit: the
// release was interrupted, and the commit is released again rather than refused. A step that
// crashed on its own (SIGSEGV, SIGABRT) is the commit's failure. A shell, and ssh for its remote
// shell, report a child's signal as 128 + its number.
const INTERRUPTING = new Set(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"]);
const signalNames = Object.fromEntries(Object.entries(constants.signals).map(([name, number]) => [number, name]));
function exitError(message, code, signal, { shell = false } = {}) {
  const by = signal ?? (shell && code > 128 ? signalNames[code - 128] : undefined);
  const error = new Error(`${message} ${code ?? signal}${by !== undefined && code !== null ? ` (${by})` : ""}`);
  if (INTERRUPTING.has(by)) error.interruptedBy = by;
  return error;
}
const interruptionOf = (error) => {
  for (let cause = error; cause instanceof Error; cause = cause.cause) if (cause.interruptedBy !== undefined) return cause.interruptedBy;
  return undefined;
};

function commandOutput(file, arguments_, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, arguments_, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) return resolvePromise(stdout);
      const error = exitError(`${file}: exited`, code, signal);
      if (stderr) error.message += `: ${stderr.trim()}`;
      reject(error);
    });
  });
}

export async function releaseGitCommit({
  specPath,
  specInCommit,
  repository: repositoryPath,
  commitRef = "HEAD",
  admit = false,
  beforePromotion,
  releaseBase,
  localHome = homedir(),
  environment = process.env,
  onStep = (message) => process.stderr.write(`${message}\n`),
}) {
  if (!specPath && !specInCommit) throw new Error("specPath or specInCommit is required");
  // A spec names the repository it is kept in; a script mounted inside that repository is not it.
  const repository = repositoryPath ? (await commandOutput("git", ["rev-parse", "--show-toplevel"], { cwd: repositoryPath })).trim() : treeRoot(specPath ? dirname(resolve(specPath)) : here);
  let commit = (await commandOutput("git", ["rev-parse", "--verify", `${commitRef}^{commit}`], { cwd: repository })).trim();
  const spec = JSON.parse(specInCommit
    ? await commandOutput("git", ["show", `${commit}:${specInCommit}`], { cwd: repository })
    : readFileSync(specPath, "utf8"));
  if (spec.backup && (!spec.unit?.name || !spec.restart)) throw new Error("state backup requires the managed unit and its restart command");
  if (spec.backup && (!Number.isInteger(spec.backup.keep ?? 3) || (spec.backup.keep ?? 3) < 1)) throw new Error("backup.keep must be a positive integer");
  if (spec.backup && (!Number.isInteger(spec.backup.keepDays ?? 14) || (spec.backup.keepDays ?? 14) < 0)) throw new Error("backup.keepDays must be a non-negative integer");
  const scripts = relative(treeRoot(here), here);
  const local = !spec.host || spec.host === "local";
  if (Object.hasOwn(spec, "entrances")) throw new TypeError("Node runtime release does not own Caddy ingress; compose entrances in the machine's Guix service tree");
  if (spec.runtimes?.length && !local) throw new Error("independent runtime bindings require the local host");
  let runtime = local ? quote(process.execPath) : "node";
  // Installers and verification commands must use the same Node as this release.
  const commandEnvironment = local
    ? { ...environment, PATH: `${dirname(process.execPath)}:${environment.PATH ?? "/usr/bin:/bin"}` }
    : environment;
  const natural = (name, fallback, minimum) => {
    const value = spec[name] ?? fallback;
    if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
    return value;
  };

// A step's stderr reaches the journal as it is written, and its tail stays with the step as
// `said`, so a refusal names what the step said and not only the command it ran.
const SAID_TAIL = 8192;
const tailOf = (text) => text.trimEnd().split("\n").slice(-20).join("\n");
function commandProcess(command, { input = false } = {}) {
  const child = local
    ? spawn("sh", ["-c", command], { cwd: localHome, env: commandEnvironment, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] })
    : spawn("ssh", [spec.host, command], { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
  child.said = "";
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    child.said = (child.said + chunk).slice(-SAID_TAIL);
  });
  return child;
}

async function jsonStep(command, receiptPath) {
  if (!local) return JSON.parse(await run(command));
  const absoluteReceipt = resolve(localHome, receiptPath);
  try {
    await run(`${command} > ${quote(receiptPath)}`);
    return JSON.parse(readFileSync(absoluteReceipt, "utf8"));
  } finally {
    rmSync(absoluteReceipt, { force: true });
  }
}

function run(command) {
  return new Promise((resolvePromise, reject) => {
    const child = commandProcess(command);
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) return resolvePromise(output);
      const error = exitError(`${spec.host && spec.host !== "local" ? `ssh ${spec.host}` : "local shell"}: exited`, code, signal, { shell: true });
      // What the step said leads, so a refusal read from its head (a node's report) names the
      // condition, and the command follows as where it was said. Installers report their refusal on
      // stdout (pnpm does), a thrown script on stderr.
      const said = [output, child.said].map(tailOf).filter(Boolean).join("\n");
      error.message += said ? `: ${said}\n(${command})` : `: ${command}`;
      reject(error);
    });
  });
}

function unpackArchive(stage, archiveArguments) {
  return new Promise((resolvePromise, reject) => {
    // A remote stage is reached over the home connection's upstream, which every other user of the
    // network shares: the tar travels zstd-compressed (a release tree is about a third of its size).
    const unpack = commandProcess(`mkdir -p ${quote(stage)} && ${local ? "" : "zstd -d -q -c | "}tar -x -C ${quote(stage)}`, { input: true });
    const archive = spawn("git", archiveArguments, {
      cwd: repository,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let archiveCode, archiveSignal;
    let unpackCode, unpackSignal;
    const settle = () => {
      if (archiveCode === undefined || unpackCode === undefined) return;
      if (archiveCode !== 0) reject(exitError("git archive exited", archiveCode, archiveSignal));
      else if (unpackCode !== 0) {
        const error = exitError(`${spec.host && spec.host !== "local" ? `ssh ${spec.host}` : "local tar"}: exited`, unpackCode, unpackSignal, { shell: true });
        if (unpack.said) error.message += `: ${tailOf(unpack.said)}`;
        reject(error);
      }
      else resolvePromise();
    };
    archive.on("error", reject);
    unpack.on("error", reject);
    archive.stdout.on("error", reject);
    unpack.stdin.on("error", reject);
    if (local) archive.stdout.pipe(unpack.stdin);
    else {
      const compress = createZstdCompress({ params: { [zlibConstants.ZSTD_c_compressionLevel]: 3 } });
      compress.on("error", reject);
      archive.stdout.pipe(compress).pipe(unpack.stdin);
    }
    archive.on("close", (code, signal) => { archiveCode = code; archiveSignal = signal; settle(); });
    unpack.on("close", (code, signal) => { unpackCode = code; unpackSignal = signal; settle(); });
  });
}

// Run `command` on the host with `input` on its stdin; resolves with its stdout.
function runWithInput(command, input) {
  return new Promise((resolvePromise, reject) => {
    const child = commandProcess(command, { input: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) return resolvePromise(output);
      const error = exitError(`${local ? "local shell" : `ssh ${spec.host}`}: exited`, code, signal, { shell: true });
      if (child.said) error.message += `: ${tailOf(child.said)}`;
      reject(error);
    });
    child.stdin.end(input);
  });
}

// Read back `entries` ({ mode, oid, path }) from `stage` on the host and compare each with its git
// blob id and executable bit, as verifyStagedEntries does for a local stage.
const VERIFY_ON_HOST = `const fs=require("fs"),p=require("path"),c=require("crypto");const s=process.argv[1];let w=[],n=0;for(const l of fs.readFileSync(0,"utf8").split("\\n")){if(!l)continue;n++;const e=JSON.parse(l),f=p.join(s,e.path);let y=null;try{const t=fs.lstatSync(f);const id=b=>c.createHash("sha1").update("blob "+b.length+"\\0").update(b).digest("hex");if(e.mode==="120000")y=!t.isSymbolicLink()?"not a link":id(Buffer.from(fs.readlinkSync(f)))!==e.oid?"link differs":null;else if(!t.isFile())y="not a file";else if(id(fs.readFileSync(f))!==e.oid)y="bytes differ";else if((t.mode&0o111?"100755":"100644")!==e.mode)y="mode differs"}catch(x){y=x.code==="ENOENT"?"missing":"unreadable"}if(y)w.push(e.path+": "+y)}if(w.length){console.error(w.length+" of "+n+" paths differ: "+w.slice(0,10).join("; "));process.exit(1)}console.log(n)`;
async function verifyOnHost(stage, entries) {
  if (entries.length === 0) return 0;
  return Number((await runWithInput(`node -e ${quote(VERIFY_ON_HOST)} ${quote(stage)}`, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n")).trim());
}

/**
 * Stage `commit` on a remote host from its running release, by the plan a local stage follows: the
 * previous release's unchanged tracked files are hard-linked on the host, and only the written paths
 * travel, as a compressed archive. Every written path and a sample of the linked ones are read back
 * on the host before the stage is used.
 */
async function stageRemoteFromPrevious({ previousCommit, previousRelease, selection, sampleSize = 2000 }) {
  const { linked, written, removed, files } = stagePlan({ repository, previousCommit, commit, archives: spec.archives, derived: spec.derived ?? [], selection });
  await runWithInput(`set -e; rm -rf ${quote(stage)}; mkdir -p ${quote(stage)}; to=$(cd ${quote(stage)} && pwd); cd ${quote(previousRelease)}; xargs -0 -r cp -P -l --parents -t "$to"`,
    Buffer.from(linked.filter((entry) => entry.mode !== "160000").map((entry) => `${entry.path}\0`).join("")));
  for (const { gitDirectory, tree, entries } of writtenSources({ repository, commit, entries: written })) {
    for (let start = 0; start < entries.length; start += WRITE_BATCH) {
      await unpackArchive(stage, [...(gitDirectory ? ["--git-dir", gitDirectory] : []), "archive", "--format=tar", tree, "--", ...entries.slice(start, start + WRITE_BATCH).map((entry) => literalPath(entry.path))]);
    }
  }
  const verified = await verifyOnHost(stage, written.filter((entry) => entry.mode !== "160000"));
  const sample = await verifyOnHost(stage, sampledEntries(linked.filter((entry) => entry.mode !== "160000"), sampleSize));
  return { carried: linked.length, removed: removed.length, written: written.length, files, verified, sampled: sample };
}

// A commit composes other repositories at its gitlinks, and a release carries each one the
// group's pathspecs reach, archived from that repository at the commit its gitlink records
// (src/release-source.mjs reads the composition and finds each repository).
const compositions = new Map();
const composition = (atCommit = commit) => {
  if (!compositions.has(atCommit)) compositions.set(atCommit, composedModules(repository, atCommit));
  return compositions.get(atCommit);
};

// `git archive` refuses a pathspec that matches nothing, and a group's pathspecs span the
// repositories the commit composes, so each repository archives the positive pathspecs that reach
// one of its files, together with the group's exclusions. A pathspec that reaches nothing in any of
// them is still an error.
function reaches(gitDirectory, tree, pathspec, exclusions) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", [...(gitDirectory ? ["--git-dir", gitDirectory] : []), "diff", "--quiet", "--no-renames", EMPTY_TREE, tree, "--", pathspec, ...exclusions], { cwd: repository, stdio: ["ignore", "ignore", "inherit"] });
    child.on("error", reject);
    child.on("close", (code, signal) => (code === 0 || code === 1 ? resolvePromise(code === 1) : reject(exitError("git diff exited", code, signal))));
  });
}
async function archiveFrom(stage, gitDirectory, tree, pathspecs, reached) {
  const exclusions = pathspecs.filter(excluding);
  const including = [];
  for (const pathspec of pathspecs.filter((candidate) => !excluding(candidate))) {
    if (await reaches(gitDirectory, tree, pathspec, exclusions)) { including.push(pathspec); reached.add(pathspec); }
  }
  if (including.length > 0) await unpackArchive(stage, [...(gitDirectory ? ["--git-dir", gitDirectory] : []), "archive", "--format=tar", tree, "--", ...including, ...exclusions]);
}

async function archiveInto(stage, pathspecs) {
  const reached = new Set();
  await archiveFrom(stage, undefined, commit, pathspecs, reached);
  const { composed, common } = composition();
  const gitlinks = composed.length === 0 ? new Set() : new Set((await commandOutput("git", ["diff", "--name-only", "-z", "--no-renames", EMPTY_TREE, commit, "--", ...pathspecs], { cwd: repository })).split("\0"));
  const within = (module) => pathspecs.some((pathspec) => !excluding(pathspec) && pathspec.startsWith(`${module.path}/`));
  for (const module of composed.filter((candidate) => gitlinks.has(candidate.path) || within(candidate))) {
    const gitDirectory = moduleRepository(common, module);
    const tree = moduleTree(repository, common, gitDirectory, commit, module);
    await archiveFrom(stage, gitDirectory, tree, pathspecs, reached);
  }
  const missing = pathspecs.filter((pathspec) => !excluding(pathspec) && !reached.has(pathspec));
  if (missing.length > 0) throw new Error(`pathspec ${missing.join(", ")} reaches no file of ${commit}`);
}

const receiptJson = (value, kind) => `mkdir -p ${quote(spec.receiptRoot)} && printf '%s\\n' ${quote(JSON.stringify(value))} > ${quote(`${spec.receiptRoot}/${value.recordedAt.replaceAll(":", "-")}-${commit}.${kind}.json`)}`;

async function retireUnpromotedAttempt(stage, digest) {
  if (stage) await run(`rm -rf -- ${quote(stage)}`);
  if (!/^[0-9a-f]{64}$/u.test(digest ?? "")) return;
  const targetOf = async (name) => {
    const path = `${spec.releaseRoot}/${name}`;
    const result = (await run(`if [ -L ${quote(path)} ]; then readlink -- ${quote(path)}; elif [ -e ${quote(path)} ]; then printf '%s' '__occupied__'; elif [ -d ${quote(spec.releaseRoot)} ] && [ -r ${quote(spec.releaseRoot)} ] && [ -x ${quote(spec.releaseRoot)} ]; then printf '%s' '__absent__'; else exit 1; fi`)).trim();
    if (result === "__occupied__") throw new Error(`${name} is present but is not a readable release link`);
    return result === "__absent__" ? "" : result;
  };
  const pointsTo = (target) => target.split("/").filter(Boolean).at(-1) === digest;
  if (pointsTo(await targetOf("current")) || pointsTo(await targetOf("previous"))) return;
  if (local && (await retainedRuntimeTargets(resolve(localHome, spec.releaseRoot))).includes(digest)) return;
  await run(`rm -rf -- ${quote(`${spec.releaseRoot}/${digest}`)}`);
  if (spec.unit) await run(`rm -rf -- ${quote(`${spec.releaseRoot}/units/${digest}`)}`);
}

// Keep the kernel's lease on the target host until the controller closes stdin.
// The inode stays in place: unlinking it would allow two independent lock owners.
const lock = `${spec.releaseRoot}/.release.lock`;
const lockTimeoutSeconds = natural("lockTimeoutSeconds", 900, 0);
const lockKeeper = 'process.stdout.write("locked\\n");process.stdin.on("end",()=>process.exit(0));process.stdin.resume();';
const refuseLegacy = `if [ -f ${quote(lock)} ] || [ -e ${quote(`${lock}/holder.json`)} ]; then echo 'legacy release lock requires owner review' >&2; exit 75; fi`;
const lockChild = commandProcess(`mkdir -p ${quote(spec.releaseRoot)} && ${refuseLegacy} && mkdir -p ${quote(lock)} && flock --exclusive --wait ${lockTimeoutSeconds} ${quote(`${lock}/lease`)} sh -c ${quote(`${refuseLegacy}; exec ${runtime} -e ${quote(lockKeeper)}`)}`, { input: true });
const lockClosed = new Promise((resolvePromise, reject) => {
  lockChild.once("error", reject);
  lockChild.once("close", (code) => resolvePromise(code));
});
await new Promise((resolvePromise, reject) => {
  let output = "";
  let acquired = false;
  lockChild.stdout.on("data", (chunk) => {
    output += chunk;
    if (!acquired && output.includes("locked\n")) {
      acquired = true;
      resolvePromise();
    }
  });
  lockClosed.then((code) => {
    if (!acquired) reject(new Error(`release lock ${lock} was not acquired (exit ${code}${lockChild.said ? `: ${tailOf(lockChild.said)}` : ""}); waited at most ${lockTimeoutSeconds} seconds`));
  }, reject);
});

let stage;
let materializedDigest;
let promotionAttempted = false;
try {
// A floating source ref can advance while another release holds the lease.
// Select its immutable commit here, before inspecting the running source or
// archiving it. An explicitly pinned commit remains pinned.
const selected = (await commandOutput("git", ["rev-parse", "--verify", `${commitRef}^{commit}`], { cwd: repository })).trim();
if (selected !== commit) {
  const selectedSpec = JSON.parse(specInCommit
    ? await commandOutput("git", ["show", `${selected}:${specInCommit}`], { cwd: repository })
    : readFileSync(specPath, "utf8"));
  if (JSON.stringify(selectedSpec) !== JSON.stringify(spec)) throw new Error("release configuration changed while waiting for its lease; retry with the current configuration");
  commit = selected;
}
stage = `${spec.releaseRoot}/.staging-${commit}`;
onStep(`release ${commit} to ${spec.host && spec.host !== "local" ? `${spec.host}:` : "local:"}${spec.releaseRoot}`);
// A concurrent checkout branch must not erase capabilities already published
// on this host. Deliberate rollback remains the verified restore path below.
/** Whether `commit` descends from a commit with the same tree and parents as `running`. */
async function holdsTwinOf(running, commit) {
  try {
    const [tree, ...parents] = (await commandOutput("git", ["show", "-s", "--format=%T %P", running], { cwd: repository })).trim().split(/\s+/u);
    if (parents.length === 0) return false;
    const listed = (await commandOutput("git", ["rev-list", "--parents", "--ancestry-path", `${parents[0]}..${commit}`], { cwd: repository })).trim().split("\n");
    for (const line of listed) {
      const [candidate, ...its] = line.split(" ");
      if (its.join(" ") !== parents.join(" ")) continue;
      if ((await commandOutput("git", ["rev-parse", `${candidate}^{tree}`], { cwd: repository })).trim() === tree) return true;
    }
  } catch { /* an unreadable commit holds no twin */ }
  return false;
}
const runningReceipt = (await run(`cat ${quote(`${spec.releaseRoot}/current/release-receipt.json`)} 2>/dev/null || true`)).trim();
const runningSource = runningReceipt ? JSON.parse(runningReceipt).source : undefined;
if (spec.repository && runningSource?.repository === spec.repository && runningSource.commit !== commit) {
  try {
    await commandOutput("git", ["merge-base", "--is-ancestor", runningSource.commit, commit], { cwd: repository });
  } catch (cause) {
    // The running source is included when the release holds its twin: a commit of the same tree
    // over the same parents (the same integration made twice, before integration commits were
    // derived from their inputs). What runs is then exactly what the release descends from.
    if (!(await holdsTwinOf(runningSource.commit, commit))) {
      throw new Error(`release ${commit} does not include running source ${runningSource.commit}; integrate the deployed source before releasing`, { cause });
    }
    onStep(`running source ${runningSource.commit} is included as its twin`);
  }
}
// An integration is exempt: its integrator publishes it, absorbing any outside commit main gained
// meanwhile (src/integrate.mjs absorbOutsideMain). Requiring main here deferred every batch while an
// outside writer pushed every few minutes (2026-10-03, 19:00-19:15: five deferrals in a row).
if (spec.sourceRef && !beforePromotion && runningSource?.commit !== commit) {
  const published = (await commandOutput("git", ["rev-parse", "--verify", `${spec.sourceRef}^{commit}`], { cwd: repository })).trim();
  try {
    await commandOutput("git", ["merge-base", "--is-ancestor", published, commit], { cwd: repository });
  } catch (cause) {
    const error = new Error(`release ${commit} does not include published source ${published} at ${spec.sourceRef}; integrate that source before releasing`, { cause });
    // Another writer published while this commit waited: the commit is overtaken, not refused.
    error.deferred = true;
    throw error;
  }
  // Main has one writer, the merge queue, and a node runs only what main publishes. A release that
  // is not the queue's own integration (`beforePromotion`) nor an admission is of main itself: a
  // commit main does not hold (a branch released from a worktree, 2026-10-04 17:38Z) is refused
  // before anything is staged, so it never runs where main cannot follow.
  if (!admit && commit !== published) {
    throw new Error(`release ${commit} is not ${spec.sourceRef} (${published}): only the merge queue releases a commit main does not hold; name it as a candidate (land-candidate.mjs) instead`);
  }
}
// Each phase says how long it took, so the time from candidate to live is read off the journal.
const timed = async (phase, effect) => {
  const began = Date.now();
  const value = await effect();
  onStep(`${phase} took ${Math.round((Date.now() - began) / 1000)}s`);
  return value;
};
// The release is named by what git says it holds, so naming it reads no file: a tree walk selects
// the blobs the archive pathspecs reach, and the digest of that listing is the name.
const identity = await timed("identity", async () => releaseIdentity({ repository, commit, archives: spec.archives, derived: spec.derived ?? [] }));
const source = { repository: spec.repository ?? null, commit, archives: spec.archives };
const heldReceipt = (await run(`cat ${quote(`${spec.releaseRoot}/${identity.digest}/release-receipt.json`)} 2>/dev/null || true`)).trim();
const held = heldReceipt ? JSON.parse(heldReceipt) : null;
const reusing = held?.identityVersion === identity.version && held.artifactDigest === identity.digest;
// The running release's installed dependencies are carried while the tree is staged: when the install
// key equals the running release's, its node_modules are linked into a side directory beside the
// stage in parallel with the stage's own links (both are the kernel's linking, and neither needs
// the other), and are moved into the release once it exists (adoptDependencies).
const pnpm = spec.dependencies ? pnpmCommandOf(spec.dependencies) : null;
let installKey = null;
let sideDependencies = null;
let carrying = null;
const runningDigest = (await run(`readlink ${quote(`${spec.releaseRoot}/current`)} || true`)).trim();
if (pnpm && !reusing) {
  installKey = await timed("install key", async () => installKeyOf({
    gitDir: resolve(repository, (await commandOutput("git", ["rev-parse", "--git-common-dir"], { cwd: repository })).trim()), commit,
    pnpmVersion: (await run(`${pnpm} --version`)).trim(), nodeVersion: (await run(`${runtime} --version`)).trim(),
  })).catch((error) => { onStep(`no install key (${error.message.split("\n")[0]}); installing`); return null; });
}
if (installKey && local && /^(?:[0-9a-f]{64}|current-[0-9]+-link)$/u.test(runningDigest) && JSON.parse(runningReceipt || "{}").installKey === installKey) {
  sideDependencies = resolve(localHome, spec.releaseRoot, `.dependencies-${commit}`);
  await run(`rm -rf ${quote(sideDependencies)}`);
  const projects = new Set(["."]);
  for (const { path } of identity.entries) for (let directory = dirname(path); directory !== "." && !projects.has(directory); directory = dirname(directory)) projects.add(directory);
  const began = Date.now();
  carrying = carryDependencies({ from: resolve(localHome, spec.releaseRoot, runningDigest), to: sideDependencies, projects }).then((result) => ({ result, seconds: Math.round((Date.now() - began) / 1000) }), (error) => ({ error }));
}
let materialized;
if (reusing) {
  // Another commit with these very blobs was released: nothing to stage.
  materialized = { ...held, release: `${spec.releaseRoot}/${identity.digest}`, reused: true, drifted: null };
} else {
  // A release is staged from the running one when the running one was made from a commit of this
  // repository the same pathspecs archive: its tracked files are carried by link and only the paths
  // that differ between the two commits are written. Anything else (no running release, a receipt
  // without a commit, another repository or pathspecs, a commit this checkout lacks, a remote host)
  // archives the whole commit, as does any failure of the incremental stage.
  let staged = false;
  if (local && spec.repository && runningSource?.commit && runningSource.repository === spec.repository && JSON.stringify(runningSource.archives) === JSON.stringify(spec.archives)
    && /^(?:[0-9a-f]{64}|current-[0-9]+-link)$/u.test((await run(`readlink ${quote(`${spec.releaseRoot}/current`)} || true`)).trim())) {
    const previousRelease = resolve(localHome, spec.releaseRoot, (await run(`readlink ${quote(`${spec.releaseRoot}/current`)}`)).trim());
    try {
      await commandOutput("git", ["cat-file", "-e", `${runningSource.commit}^{commit}`], { cwd: repository });
      const applied = await timed("stage from running release", () => stageFromPrevious({ repository, previousCommit: runningSource.commit, commit, archives: spec.archives, derived: spec.derived ?? [], previousRelease, stage: resolve(localHome, stage), selection: identity.entries }));
      onStep(`staged from ${runningSource.commit}: ${applied.written} written, ${applied.removed} removed of ${applied.files} files`);
      staged = true;
    } catch (error) {
      onStep(`incremental stage failed (${error.message.split("\n")[0]}); archiving the whole commit`);
    }
  }
  if (!local && spec.repository && runningSource?.commit && runningSource.repository === spec.repository && JSON.stringify(runningSource.archives) === JSON.stringify(spec.archives)) {
    const running = (await run(`readlink ${quote(`${spec.releaseRoot}/current`)} || true`)).trim();
    if (/^(?:[0-9a-f]{64}|current-[0-9]+-link)$/u.test(running)) {
      try {
        await commandOutput("git", ["cat-file", "-e", `${runningSource.commit}^{commit}`], { cwd: repository });
        const applied = await timed("stage from running release", () => stageRemoteFromPrevious({ previousCommit: runningSource.commit, previousRelease: `${spec.releaseRoot}/${running}`, selection: identity.entries }));
        onStep(`staged from ${runningSource.commit}: ${applied.written} written, ${applied.removed} removed of ${applied.files} files (${applied.verified} written and ${applied.sampled} carried verified on the host)`);
        staged = true;
      } catch (error) {
        onStep(`incremental stage failed (${error.message.split("\n")[0]}); archiving the whole commit`);
      }
    }
  }
  if (!staged) await run(`rm -rf ${quote(stage)}`);
  if (!staged) await timed("archive", async () => { for (const pathspecs of spec.archives) await archiveInto(stage, pathspecs); });
  materialized = await timed("materialize", () => jsonStep(
    `${runtime} ${quote(`${stage}/${scripts}/materialize-node-runtime-release.mjs`)} --staged ${quote(stage)} --release-root ${quote(spec.releaseRoot)} --source ${quote(JSON.stringify(source))} --identity ${quote(JSON.stringify({ version: identity.version, digest: identity.digest }))}${spec.derived?.length ? ` --derived ${quote(JSON.stringify(spec.derived))}` : ""}`,
    `${spec.releaseRoot}/.materialization-${commit}.json`,
  ));
}
materializedDigest = materialized.artifactDigest;
let release = `${spec.releaseRoot}/${materialized.artifactDigest}`;
const preparedRelease = release;
onStep(`${materialized.reused ? "reused" : "materialized"} ${materialized.artifactDigest}`);
if (materialized.drifted) onStep(`the release had been edited in place; the edited tree is kept at ${materialized.drifted}`);
// A commit whose released bytes are the ones already running changes nothing on the host, unless
// the running tree had drifted from them, when the restored bytes are installed and restarted.
const running = (await run(`readlink ${quote(`${spec.releaseRoot}/current`)} || true`)).trim();
if (running === materialized.artifactDigest && !materialized.drifted) {
  onStep(`unchanged: ${commit} releases the running ${running}`);
  return { commit, release, materialized, unchanged: true };
}

// Derived paths are rebuilt by the install, also in a reused release whose files were made read-only.
if (spec.derived?.length) await run(`cd ${quote(release)} && chmod -f u+w -- ${spec.derived.map(quote).join(" ")} || true`);
// Install and verification know what they admit and against what: a gate that ratchets (findings may
// only fall) compares RELEASE_COMMIT with RELEASE_BASE_COMMIT -- the main an integration composed
// onto, or else the running release's commit -- reading either from RELEASE_REPOSITORY.
const admitting = `export RELEASE_COMMIT=${quote(commit)} RELEASE_BASE_COMMIT=${quote(releaseBase ?? runningSource?.commit ?? "")} RELEASE_REPOSITORY=${quote(repository)};`;
// A fresh release installs onto the dependencies the running release installed, linked rather than
// copied, so the installer changes only what the lockfile changed instead of relinking every
// project. A linked tree writes nothing through to the running one: its package files are links
// into the shared store already, and the installer replaces its own records by renaming them. Only
// directories the new tree also has are seeded, and only where it has none of its own. Seeding only
// ever saves time: a seeded install that fails is installed again from nothing, so a refusal is
// always the commit's own and never the seed's.
// A spec that splits `dependencies` (the package manager's install) from `derive` (code generated from
// the installed tree) lets a release whose install key equals the running release's carry that
// release's node_modules and run only `derive`. `install` is the unsplit form, and stays beside the
// split one in a spec so that an older tool, which reads only `install`, releases the same commit.
const dependencies = spec.dependencies ?? spec.install;
const install = () => run(`${admitting} cd ${quote(release)} && ${dependencies}`);
const unseed = () => run(`find ${quote(release)} -name node_modules -type d -prune -exec rm -rf {} +`);
let seeded = false;
let carried = false;
if (carrying) {
  carried = await timed("carry dependencies", async () => {
    const outcome = await carrying;
    if (outcome.error) throw outcome.error;
    const adopted = adoptDependencies({ from: sideDependencies, to: resolve(localHome, release) });
    onStep(`dependencies unchanged since ${running.slice(0, 12)}: carried ${outcome.result.directories} node_modules by ${outcome.result.method} in ${outcome.result.jobs} jobs (${outcome.seconds}s, alongside the stage), adopted ${adopted}`);
  }).then(() => true, async (error) => { onStep(`carrying failed (${error.message.split("\n")[0]}); installing`); await unseed(); return false; });
  await run(`rm -rf ${quote(sideDependencies)}`);
}
if (dependencies && !carried && !materialized.reused && /^(?:[0-9a-f]{64}|current-[0-9]+-link)$/u.test(running)) {
  const previous = `${spec.releaseRoot}/${running}`;
  seeded = await timed("seed dependencies", () => run(`if [ -d ${quote(previous)} ]; then target=$(cd ${quote(release)} && pwd) && cd ${quote(previous)} && find . -name node_modules -type d -prune -exec sh -c 'target=$1; shift; for d; do if [ -d "$target/$(dirname "$d")" ] && [ ! -e "$target/$d" ]; then cp -al "$d" "$target/$d" || exit 1; fi; done' sh "$target" {} +; fi`))
    .then(() => true, async (error) => { onStep(`seeding failed (${error.message.split("\n")[0]}); installing from nothing`); await unseed(); return false; });
}
if (dependencies && !carried) {
  await timed("install", () => install().catch(async (error) => {
    // A refusal the lockfile or the store makes (pnpm's lockfile and offline errors) is the
    // commit's whatever node_modules held, and is not paid for twice.
    if (!seeded || interruptionOf(error) !== undefined || /ERR_PNPM_(OUTDATED_LOCKFILE|LOCKFILE_|NO_OFFLINE|BROKEN_LOCKFILE)/u.test(error.message)) throw error;
    onStep(`the seeded install failed; installing from nothing: ${error.message.split("\n")[0]}`);
    await unseed();
    return install();
  }));
}
// What the release's node_modules were installed from, recorded once they are (a release whose
// install did not finish names no key, so none is ever reused unproven). The receipt is replaced,
// never written through: a staged release may share its files with the running one.
if (installKey) await run(`${runtime} -e ${quote('const fs=require("node:fs");const [file,key]=process.argv.slice(1);const receipt=JSON.parse(fs.readFileSync(file,"utf8"));receipt.installKey=key;fs.writeFileSync(file+".tmp",JSON.stringify(receipt,null,2)+"\\n");fs.renameSync(file+".tmp",file);')} ${quote(`${release}/release-receipt.json`)} ${installKey}`);
if (spec.dependencies && spec.derive) await timed("derive", () => run(`${admitting} cd ${quote(release)} && ${spec.derive}`));
if (spec.verify) await timed("verify", () => run(`${admitting} cd ${quote(release)} && ${spec.verify}`));
// A health reading meets its expectation when every expected field is present with the expected value
// (arrays: each expected item is among the actual ones), and each `empty` path holds an empty list.
const healthPredicate = `const fs=require("node:fs"); const includes=(actual,expected)=>Array.isArray(expected)
  ? Array.isArray(actual)&&expected.every(item=>actual.some(candidate=>includes(candidate,item)))
  : expected!==null&&typeof expected==="object"
    ? actual!==null&&typeof actual==="object"&&Object.entries(expected).every(([key,value])=>includes(actual[key],value))
    : actual===expected;
  const at=(value,path)=>path.split(".").reduce((node,key)=>node?.[key],value);
  try { const reading=JSON.parse(fs.readFileSync(0,"utf8"));
    if(!includes(reading,JSON.parse(process.argv[1]))) process.exit(1);
    for (const path of JSON.parse(process.argv[2]||"[]")) { const list=at(reading,path); if(!Array.isArray(list)||list.length>0) process.exit(1); } }
  catch { process.exit(1); }`;
function healthProbeOf(url, expect, empty = []) {
  return expect === undefined && empty.length === 0
    ? `curl --connect-timeout 2 --max-time 5 -fsS ${quote(url)} >/dev/null 2>&1`
    : `health_response=$(curl --connect-timeout 2 --max-time 5 -fsS ${quote(url)} 2>/dev/null) && printf '%s' "$health_response" | ${runtime} -e ${quote(healthPredicate)} ${quote(JSON.stringify(expect ?? {}))} ${quote(JSON.stringify(empty))}`;
}
// The source installer is still the JS lockfile's producer. Production custody,
// runtime selection and generations belong to Guix for a Guix deployment.
const guixCommand = (tree, arguments_) => {
  const at = (path) => local ? resolve(localHome, tree, path) : tree + "/" + path;
  return ["guix", "time-machine", "-C", at(spec.guix.channels), "--", "repl", "--", at(spec.guix.driver), ...arguments_].map(quote).join(" ");
};
let guixBuild;
if (spec.guix) {
  const at = (path) => local ? resolve(localHome, release, path) : release + "/" + path;
  const root = spec.releaseRoot + "/guix/admitted-" + materialized.artifactDigest;
  const buildRoot = local ? resolve(localHome, root) : root;
  await run("mkdir -p " + quote(spec.releaseRoot + "/guix"));
  const built = await timed("Guix closure", () => jsonStep(guixCommand(release, [
    "build", at(spec.guix.channels), at(spec.guix.loadPath), at(spec.guix.package),
    local ? resolve(localHome, release) : release, buildRoot,
  ]), spec.releaseRoot + "/.guix-build-" + commit + ".json"));
  // Preserve the owning driver's storePath/root/narSha256 result. Receiving its
  // shape is not independent store verification or authority to promote it.
  if (!built || typeof built.storePath !== "string" || !built.storePath.startsWith("/gnu/store/") ||
      resolve(built.storePath) !== built.storePath || built.storePath.slice("/gnu/store/".length).includes("/") ||
      built.storePath === "/gnu/store/" || built.root !== buildRoot ||
      typeof built.narSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(built.narSha256)) {
    throw new Error("Guix build receipt does not bind the requested root, store output and NAR SHA256");
  }
  guixBuild = { storePath: built.storePath, root: built.root, narSha256: built.narSha256 };
  release = guixBuild.storePath;
  runtime = quote(release + "/bin/node");
}
// Everything the new release needs to start is checked before `current` moves.
if (spec.unit) await run(`test -f ${quote(`${release}/${spec.unit.file}`)}`);
if (spec.unit?.socket) await run(`test -f ${quote(`${release}/${spec.unit.socket.file}`)}`);
for (const part of Object.values(spec.unit?.reconciler ?? {})) await run(`test -f ${quote(`${release}/${part.file}`)}`);
// Released files are not edited in place: a hand patch fails instead of silently drifting the host
// from every commit. Installed dependencies stay writable for the installer.
if (!spec.guix) await run(`find ${quote(release)} -name node_modules -prune -o -type f -perm /222 -exec chmod a-w {} +`);
// Boot before promotion: a release that declares `probe` ({ command, health, healthExpect?, empty?,
// timeoutSeconds?, environment? }) is booted from its own tree, read-only, before admission ends --
// in a transient unit of its own, with scratch state, behind the live node in priority -- and must
// answer `health` as expected, each `empty` path an empty list (MetroPlat's probe mode lists the
// operation families that failed to load). "{release}" and "{scratch}" in the command and the
// environment stand for the release tree and the probe's scratch state. The deployment's probe mode
// keeps the booted tree off the clock, the network and the live node's leases; the probe unit is
// stopped and its scratch removed whatever the outcome. A tree that does not answer is refused, with
// what it said.
if (spec.probe) await timed("probe", async () => {
  if (!local) throw new Error("a boot probe runs on the local host only");
  const { command, health, healthExpect, empty = [], timeoutSeconds = 180, environment: probeEnvironment = {} } = spec.probe;
  const scratch = `${spec.releaseRoot}/.probe-${commit}`;
  const probeUnit = `${(spec.unit?.name ?? "node.service").replace(/\.service$/u, "")}-probe`;
  const fill = (value) => String(value).replaceAll("{release}", resolve(localHome, release)).replaceAll("{scratch}", resolve(localHome, scratch))
    .replaceAll("/home/emsenn/.local/bin/node", spec.guix ? release + "/bin/node" : "/home/emsenn/.local/bin/node");
  await commandOutput("systemctl", ["--user", "stop", probeUnit]).catch(() => {});
  await run(`rm -rf ${quote(scratch)} && mkdir -p ${quote(scratch)}`);
  try {
    await commandOutput("systemd-run", [
      "--user", `--unit=${probeUnit}`, "--collect", "--quiet", "--nice=10", "--property=CPUWeight=20", "--property=IOWeight=20",
      `--working-directory=${resolve(localHome, release)}`, `--setenv=HOME=${localHome}`, `--setenv=PATH=${commandEnvironment.PATH}`,
      ...Object.entries(probeEnvironment).map(([name, value]) => `--setenv=${name}=${fill(value)}`),
      "sh", "-c", fill(command),
    ]);
    const attempts = Math.max(1, Math.ceil(timeoutSeconds / 3));
    const answered = await run(`for i in $(seq 1 ${attempts}); do ${healthProbeOf(health, healthExpect, empty)} && exit 0; systemctl --user is-active --quiet ${quote(probeUnit)} || exit 2; sleep 3; done; exit 1`).then(() => true, () => false);
    if (!answered) {
      const said = await commandOutput("journalctl", ["--user", "-u", probeUnit, "-n", "40", "--no-pager", "-o", "cat"]).catch(() => "");
      throw new Error(`the release tree did not boot to ${health} within ${timeoutSeconds}s:\n${tailOf(said)}`);
    }
  } finally {
    await commandOutput("systemctl", ["--user", "stop", probeUnit]).catch(() => {});
    await run(`rm -rf ${quote(scratch)}`).catch(() => {});
  }
});
const runtimePlans = await timed("runtime closures", () => prepareRuntimeBindings({
  releaseRoot: resolve(localHome, spec.releaseRoot), release: resolve(localHome, release),
  runtimes: spec.runtimes, home: localHome, repository,
  compilerPackage: resolve(localHome, release, scripts, '../package.json'),
}));
if (admit) {
  onStep(`admitted ${commit} as ${materialized.artifactDigest}`);
  return { commit, release, materialized, admitted: true, ...(guixBuild ? { guix: guixBuild } : {}) };
}
if (beforePromotion) await beforePromotion({ commit, digest: materialized.artifactDigest });
// Capture the old target before the state transition, including promotion failures that occur
// after moving the pointer but before returning the promotion receipt.
const replaced = running && running !== materialized.artifactDigest ? running : null;
let promoted;
let stoppedForSnapshot = false;

// The service's unit travels with the commit: `unit` ({ file, name }) names the unit file inside
// the release and the user unit it installs as, so a release that changes how the service starts
// installs that change with the code. The unit a release ran under is kept beside the releases as
// `units/<target>/<name>` when it is replaced, because the next commit's `unit.file` need not
// exist in an older release's tree; a rollback reinstalls exactly the unit it replaced. Installing
// also enables the unit, so a service's first release is one that survives the host rebooting.
// `unit.socket` ({ file, name }) is the service's socket-activation unit: systemd holds the listener,
// so a restart queues connections instead of refusing them. The service unit names it with Wants=
// and After=, so its restart starts the socket before the service. A changed socket is stopped so
// that restart rebinds it; a rollback to a release without one removes it, since that release
// binds the address itself.
// `unit.reconciler` ({ service, timer }, each { file, name }) is the host's release supervision: a
// timer its supervisor fires to run the release-reconciliation pass outside the service, so a
// service too saturated to run its own pass is still released the commit that relieves it.
const installedUnit = spec.unit ? `.config/systemd/user/${spec.unit.name}` : undefined;
const keptUnit = (target) => `${spec.releaseRoot}/units/${target}/${spec.unit.name}`;
const socket = spec.unit?.socket;
const installedSocket = socket ? `.config/systemd/user/${socket.name}` : undefined;
const keptSocket = (target) => `${spec.releaseRoot}/units/${target}/${socket.name}`;
const installSocket = (file) => run(`if ! cmp -s ${quote(file)} ${quote(installedSocket)}; then install -D -m 644 ${quote(file)} ${quote(installedSocket)} && systemctl --user daemon-reload && systemctl --user stop ${quote(socket.name)}; fi && systemctl --user enable ${quote(socket.name)}`);
const removeSocket = () => run(`if [ -f ${quote(installedSocket)} ]; then systemctl --user disable --now ${quote(socket.name)}; rm -f -- ${quote(installedSocket)}; systemctl --user daemon-reload; fi`);
const installUnit = async (file) => {
  await run(`install -D -m 644 ${quote(file)} ${quote(installedUnit)} && systemctl --user daemon-reload && systemctl --user enable ${quote(spec.unit.name)}`);
  if (socket) await installSocket(`${release}/${socket.file}`);
  const reconciler = spec.unit.reconciler;
  if (reconciler) {
    for (const part of [reconciler.service, reconciler.timer]) await run(`install -D -m 644 ${quote(`${release}/${part.file}`)} ${quote(`.config/systemd/user/${part.name}`)}`);
    await run(`systemctl --user daemon-reload && systemctl --user enable --now ${quote(reconciler.timer.name)}`);
  }
};
const healthAttempts = natural("healthAttempts", 60, 1);
const healthIntervalSeconds = natural("healthIntervalSeconds", 5, 0);
const healthProbe = healthProbeOf(spec.health, spec.healthExpect);
const healthy = () => run(`for i in $(seq 1 ${healthAttempts}); do ${healthProbe} && exit 0; sleep ${healthIntervalSeconds}; done; exit 1`).then(() => true, () => false);
const bindings = runtimeBindingTransaction(runtimePlans, {
  systemctl: (arguments_) => commandOutput("systemctl", ["--user", ...arguments_], { cwd: localHome, env: commandEnvironment }),
  healthy: (plan) => run(`for i in $(seq 1 ${healthAttempts}); do ${healthProbeOf(plan.health, plan.healthExpect)} && exit 0; sleep ${healthIntervalSeconds}; done; exit 1`).then(() => true, () => false),
  onStep,
});

// A digest is returned to by an ordinary verified promotion; a hand-placed target by relinking.
async function restore(target) {
  if (spec.guix) {
    await run(guixCommand(release, ["rollback", release + "/" + spec.guix.channels,
      local ? resolve(localHome, spec.releaseRoot, "current") : spec.releaseRoot + "/current", target]));
  } else if (/^[0-9a-f]{64}$/u.test(target)) {
    await run(`${runtime} ${quote(`${spec.releaseRoot}/${target}/${scripts}/promote-node-runtime-release.mjs`)} --release-root ${quote(spec.releaseRoot)} --digest ${target} --receipt-root ${quote(spec.receiptRoot)}`);
  } else {
    await run(`cd ${quote(spec.releaseRoot)} && ln -sfn ${quote(target)} .current.rollback && mv -T .current.rollback current && ln -sfn ${quote(materialized.artifactDigest)} .previous.rollback && mv -T .previous.rollback previous`);
  }
  if (spec.unit) await run(`if [ -f ${quote(keptUnit(target))} ]; then install -D -m 644 ${quote(keptUnit(target))} ${quote(installedUnit)} && systemctl --user daemon-reload; fi`);
  if (socket) await ((await run(`test -f ${quote(keptSocket(target))} && echo kept || true`)).trim() === "kept" ? installSocket(keptSocket(target)) : removeSocket());
  if (spec.restart) await run(spec.restart);
  return spec.health ? healthy() : true;
}

try {
  if (spec.backup) {
    const { state, root, keep = 3, keepDays = 14, fetchTo } = spec.backup;
    const snapshot = `${root}/${new Date().toISOString().replaceAll(":", "-")}-${materialized.artifactDigest.slice(0, 12)}.tar.gz`;
    // systemctl waits for the unit's control group to stop. Its shutdown drains the host's
    // custody, journals and SQLite connections; no release pointer has moved yet.
    stoppedForSnapshot = true;
    // A listening socket would start the service again on the next request; it stops with it.
    // A process may fail while draining and still be fully stopped. Its recorded
    // failure is not a live writer; both service processes must be gone.
    // A unit this host has never installed (a service's first release) has no writers to stop.
    await run(`{ ! systemctl --user cat ${quote(spec.unit.name)} >/dev/null 2>&1 || systemctl --user stop ${quote(spec.unit.name)}${socket ? ` ${quote(socket.name)}` : ""}; } && case "$(systemctl --user show ${quote(spec.unit.name)} --property=ActiveState --value)" in inactive|failed) ;; *) exit 1 ;; esac && test "$(systemctl --user show ${quote(spec.unit.name)} --property=MainPID --value)" = 0 && test "$(systemctl --user show ${quote(spec.unit.name)} --property=ControlPID --value)" = 0`);
    onStep(`state writers stopped: ${spec.unit.name}`);
    const partial = `${snapshot}.partial`;
    try {
      await run(`mkdir -p ${quote(root)} && tar -czf ${quote(partial)} -C ${quote(state)} . && tar -tzf ${quote(partial)} >/dev/null && mv -T ${quote(partial)} ${quote(snapshot)}`);
    } catch (error) {
      await run(`rm -f -- ${quote(partial)}`).catch(() => {});
      throw error;
    }
    onStep(`quiescent state snapshot ${snapshot}`);
    // Retention is by time (src/snapshot-retention.mjs), on the host and in the fetched copies alike.
    const retention = { keep, keepDays, now: new Date().toISOString() };
    const hosted = (await run(`cd ${quote(root)} && ls -1 -- *.tar.gz 2>/dev/null || true`)).split("\n").map((line) => line.trim()).filter(Boolean);
    const expired = prunedSnapshots(hosted, retention);
    if (expired.length > 0) await run(`cd ${quote(root)} && rm -f -- ${expired.map(quote).join(" ")}`);
    if (fetchTo) {
      const local = fetchTo.replace(/^~(?=\/|$)/u, localHome);
      mkdirSync(local, { recursive: true, mode: 0o700 });
      if (!spec.host || spec.host === "local") await commandOutput("cp", [snapshot.replace(/^~(?=\/|$)/u, localHome), `${local}/`], { cwd: localHome });
      else await commandOutput("scp", ["-q", `${spec.host}:${snapshot}`, `${local}/`]);
      onStep(`copied to ${local}`);
      for (const name of prunedSnapshots(readdirSync(local).filter((entry) => entry.endsWith(".tar.gz")), retention)) rmSync(resolve(local, name), { force: true });
    }
  }
  promotionAttempted = true;
  promoted = spec.guix ? await jsonStep(guixCommand(release, [
    "activate", release + "/" + spec.guix.channels, guixBuild.storePath,
    local ? resolve(localHome, spec.releaseRoot, "current") : spec.releaseRoot + "/current",
  ]), spec.releaseRoot + "/.promotion-" + commit + ".json") : await jsonStep(
    `${runtime} ${quote(`${release}/${scripts}/promote-node-runtime-release.mjs`)} --release-root ${quote(spec.releaseRoot)} --digest ${materialized.artifactDigest} --receipt-root ${quote(spec.receiptRoot)}${materialized.reused ? "" : ` --commit ${quote(commit)}`} --derived ${quote(JSON.stringify(spec.derived ?? []))}`,
    `${spec.releaseRoot}/.promotion-${commit}.json`,
  );
  onStep(`promoted ${running || "(none)"} -> ${promoted.toDigest}`);
  if (spec.unit) {
    if (replaced) await run(`if [ -f ${quote(installedUnit)} ]; then install -D -m 644 ${quote(installedUnit)} ${quote(keptUnit(replaced))}; fi`);
    if (replaced && socket) await run(`if [ -f ${quote(installedSocket)} ]; then install -D -m 644 ${quote(installedSocket)} ${quote(keptSocket(replaced))}; fi`);
    await installUnit(`${release}/${spec.unit.file}`);
  }
  if (spec.restart) await run(spec.restart);
  if (spec.health && !(await timed("health", healthy))) throw new Error(`${spec.health} did not answer`);
  await timed("runtime receivers", () => bindings.apply());
} catch (error) {
  if (!promotionAttempted) {
    // Snapshot creation or transfer failed: the existing pointer and unit are still intact.
    if (!stoppedForSnapshot) throw error;
    await run(spec.restart);
    const back = spec.health ? await healthy() : true;
    throw new Error(`${error.message}; retained ${running || "(none)"} and resumed its service${back ? ", which is healthy" : ", which is not answering"}`, { cause: error });
  }
  // Promotion itself, unit installation, restart and health belong to one rollback boundary.
  if (!replaced) {
    await bindings.rollback();
    throw new Error(`${error.message} on ${materialized.artifactDigest}, and there is no previous release to return to`, { cause: error });
  }
  let back;
  try { back = await restore(replaced); }
  finally { await bindings.rollback(); }
  throw new Error(`${error.message} on ${materialized.artifactDigest}; rolled back to ${replaced}${back ? ", which is healthy" : ", which is not answering either"}`, { cause: error });
}
if (spec.health) onStep(`healthy: ${spec.health}`);
// Native profile generations retain rollback closures and GC roots. The mutable
// preparation tree is not a deployed generation and can leave after receiving.
if (spec.guix) {
  if (materialized.artifactDigest !== running) await run("rm -rf -- " + quote(preparedRelease));
  await run("rm -f -- " + quote(spec.releaseRoot + "/guix/admitted-" + materialized.artifactDigest));
  return { commit, release, materialized, promoted, guix: guixBuild };
}
// Every independent process retains its own immutable tree beyond platform rollback history.
const runtimeTargets = local ? await retainedRuntimeTargets(resolve(localHome, spec.releaseRoot)) : [];
const kept = [...new Set([promoted.toDigest, replaced ?? (await run(`readlink ${quote(`${spec.releaseRoot}/previous`)} || true`)).trim(), ...runtimeTargets].filter(Boolean))];
// Removing a release's files is not part of releasing: an unkept release is renamed aside (one
// rename each), and a detached idle unit deletes what was set aside, so the queue's next candidate
// never waits on it (a synchronous rm -rf of two releases held the queue 6 min on 2026-10-03). A
// deletion that fails or is cut off leaves `.retired-*` for the next release's sweep.
await run(`cd ${quote(spec.releaseRoot)} && stamp=$(date -u +%Y%m%dT%H%M%SZ) && for d in $(ls -1 | grep -E '^[0-9a-f]{64}$'); do case " ${kept.join(" ")} " in *" $d "*) ;; *) mv -- "$d" ".retired-$d-$stamp";; esac; done && mkdir -p units && for d in $(ls -1 units); do case " ${kept.join(" ")} " in *" $d "*) ;; *) mv -- "units/$d" ".retired-unit-$d-$stamp";; esac; done`);
await run(`cd ${quote(spec.releaseRoot)} && systemd-run --user --collect --quiet --nice=19 --property=IOSchedulingClass=idle --property=CPUWeight=1 --working-directory="$PWD" --description="Delete retired releases of ${spec.releaseRoot}" sh -c "rm -rf -- .retired-*; find . -maxdepth 1 -name '.drifted-*' -mtime +7 -exec rm -rf {} +" || true`);
return { commit, release, materialized, promoted };
} catch (error) {
  // A refused commit is knowledge: a reconciler reads it and does not retry that commit with the
  // tool that refused it, which the receipt names. An interrupted release is not: it is recorded
  // beside the refusals, and the next pass retries it.
  const interruptedBy = interruptionOf(error);
  const tool = toolCommit();
  let terminalReceiptWritten = false;
  if (error.deferred) throw error;
  if (!admit) {
    try {
      await run(interruptedBy === undefined
        ? receiptJson({ type: "NodeRuntimeReleaseRefusalReceipt", version: 1, commit, tool, reason: error.message, recordedAt: new Date().toISOString() }, "refusal")
        : receiptJson({ type: "NodeRuntimeReleaseInterruptionReceipt", version: 1, commit, tool, interruptedBy, reason: error.message, recordedAt: new Date().toISOString() }, "interruption"));
      terminalReceiptWritten = true;
    } catch {}
  }
  // Retire this attempt only after its tool-qualified terminal receipt is durable and before
  // promotion could have changed either release pointer. Keep artifacts when either fact is unknown.
  if (terminalReceiptWritten && !promotionAttempted) {
    try {
      await retireUnpromotedAttempt(stage, materializedDigest);
    } catch (cleanupError) {
      onStep(`could not retire terminal pre-promotion artifacts: ${cleanupError.message}`);
    }
  }
  throw error;
} finally {
  lockChild.stdin.end();
  await lockClosed;
}
}

if (import.meta.main) {
  const specPath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;
  const specInCommit = option("--spec-in-commit");
  if (!specPath && !specInCommit) throw new Error("usage: release-git-commit.mjs <release.json> | --spec-in-commit <path> [--repository <checkout>] [--commit <ref>] [--admit]");
  const receipt = await releaseGitCommit({ specPath, specInCommit, repository: option("--repository"), commitRef: option("--commit", "HEAD"), admit: process.argv.includes("--admit") });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}
