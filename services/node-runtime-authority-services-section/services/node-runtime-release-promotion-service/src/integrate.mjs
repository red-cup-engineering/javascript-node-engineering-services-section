/**
 * Producers declare an immutable source transformation, not a Git ancestry to merge.
 * The source base and resulting tree bind the delivery scope; provenance remains evidence.
 * Receiving composes that transformation against current main, derives workspace inputs,
 * admits independently, publishes, and records a verdict. No candidate history enters main.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  commitTreeSync, derivedCommit, entryAt, git, gitSync, gitText, gitTextSync, isAncestor, replaceInTree, replaceInTreeSync, treeOf, treeOfSync, writeBlob, writeBlobSync,
} from "./git-objects.mjs";
import { LOCKFILE, qualifyWorkspaceLockfile } from "./workspace-lockfile.mjs";
import { releaseClaim } from "./claims.mjs";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-address-engineering-services-section/semantic-content-identity";

export const QUEUE_REF = "refs/queue/";
export const ORIGIN_QUEUE_REF = "refs/remotes/origin/queue/";
export const ORIGIN_QUEUE_REFSPEC = "+refs/heads/queue/*:refs/remotes/origin/queue/*";
const NAME = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/u;

export const candidateNameOk = (name) => NAME.test(name) && !name.includes("..") && !name.endsWith(".lock");
export const verdictsOf = (queueRoot) => join(queueRoot, "verdicts");
const verdictKey = (name, commit) => `${name.replaceAll("/", "~")}@${commit}`;

/** Every verdict the queue has given, by candidate name and commit. */
export function readVerdicts(queueRoot) {
  const directory = verdictsOf(queueRoot);
  const verdicts = new Map();
  for (const file of existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".json")).sort() : []) {
    try {
      const verdict = JSON.parse(readFileSync(join(directory, file), "utf8"));
      verdicts.set(verdictKey(verdict.candidate.name, verdict.candidate.commit), verdict);
    } catch {}
  }
  return verdicts;
}

/** When the queue last integrated a batch (its newest `integrated` verdict), or 0: the queue's own
 *  progress, which main's patience is measured against. Verdict files are named by their time, so
 *  the newest are read first and the scan stops at the first integration. */
export function lastIntegrationAt(queueRoot) {
  const directory = verdictsOf(queueRoot);
  const names = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".json")).sort().reverse() : [];
  for (const name of names) {
    try {
      const verdict = JSON.parse(readFileSync(join(directory, name), "utf8"));
      if (verdict.verdict === "integrated") return Date.parse(verdict.recordedAt) || 0;
    } catch {}
  }
  return 0;
}

export function verdictOf(queueRoot, name, commit) {
  return readVerdicts(queueRoot).get(verdictKey(name, commit));
}

function writeVerdict(queueRoot, verdict) {
  const directory = verdictsOf(queueRoot);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${verdict.recordedAt.replaceAll(":", "-")}-${verdictKey(verdict.candidate.name, verdict.candidate.commit)}.json`);
  writeFileSync(`${file}.partial`, `${JSON.stringify(verdict, null, 2)}\n`);
  renameSync(`${file}.partial`, file);
  return verdict;
}

/**
 * The candidates no verdict has answered, oldest first. A local ref and an origin branch of the same
 * name are one candidate; the local one is the newer naming when they differ.
 */
export async function pendingCandidates({ repository, queueRoot }) {
  const listed = await gitText(repository, ["for-each-ref", "--format=%(refname)%00%(objecttype)%00%(objectname)%00%(*objectname)%00%(committerdate:unix)%00%(taggerdate:unix)%00%(contents)%01", QUEUE_REF, ORIGIN_QUEUE_REF]);
  const verdicts = readVerdicts(queueRoot);
  const byName = new Map();
  for (const record of listed.split("\u0001").map((line) => line.replace(/^\n/u, "")).filter(Boolean)) {
    const [ref, type, object, peeled, committedAt, taggedAt, contents] = record.split("\0");
    const tagged = type === "tag";
    if (!tagged && type !== "commit") continue;
    const commit = tagged ? peeled : object;
    const at = tagged ? taggedAt : committedAt;
    const local = ref.startsWith(QUEUE_REF);
    const name = ref.slice((local ? QUEUE_REF : ORIGIN_QUEUE_REF).length);
    if (!candidateNameOk(name) || verdicts.has(verdictKey(name, commit))) continue;
    const prior = byName.get(name);
    if (prior && (prior.local || !local)) continue;
    byName.set(name, { name, ref, commit, at: Number(at), local, ...(tagged ? { tag: object, message: contents.trim() } : {}) });
  }
  return [...byName.values()].sort((left, right) => left.at - right.at || left.name.localeCompare(right.name));
}

const subjectOf = async (repository, commit) => gitText(repository, ["show", "-s", "--format=%s", commit]);
const SOURCE_TRAILER = "Source-Transformation: ";

function transformationIdentity(body) {
  return identifyJsonSemanticContent({ objectKind: "git.source-transformation", value: body, witnessRoot: EMPTY_WITNESS_ROOT }).id;
}

/** Scope must be declared by the producer, never inferred from the receiver's history. */
export function sourceTransformationSync({ repository, sourceBase, commit }) {
  if (typeof sourceBase !== "string" || sourceBase.length === 0) throw new TypeError("sourceBase is required: name the original base of the entire intended delivery");
  const before = gitTextSync(repository, ["rev-parse", "--verify", `${sourceBase}^{commit}`]);
  const sourceCommit = gitTextSync(repository, ["rev-parse", "--verify", `${commit}^{commit}`]);
  gitSync(repository, ["merge-base", "--is-ancestor", before, sourceCommit]);
  const body = { sourceBase: before, sourceCommit, beforeTree: treeOfSync(repository, before), afterTree: treeOfSync(repository, sourceCommit) };
  return { ...body, id: transformationIdentity(body) };
}

function readTransformation(repository, commit, message) {
  const lines = message.split("\n").filter((line) => line.startsWith(SOURCE_TRAILER));
  if (lines.length !== 1) throw new TypeError("candidate requires exactly one producer-declared Source-Transformation");
  const declared = JSON.parse(lines[0].slice(SOURCE_TRAILER.length));
  const actual = sourceTransformationSync({ repository, sourceBase: declared.sourceBase, commit: declared.sourceCommit });
  if (JSON.stringify(declared) !== JSON.stringify(actual)) throw new TypeError("source transformation does not match its immutable source objects and identity");
  if (treeOfSync(repository, commit) !== actual.afterTree) throw new TypeError("candidate tree differs from the declared source transformation");
  if (commit !== actual.sourceCommit) {
    const parents = gitTextSync(repository, ["show", "-s", "--format=%P", commit]);
    if (parents !== actual.sourceCommit) throw new TypeError("transport envelope must have the declared source commit as its sole parent");
  }
  return actual;
}

/** Name a source transformation in an annotated Git object. Tagger attribution is not acceptance. */
export function nameCandidateSync({ repository, name, commit, sourceBase, message }) {
  if (!candidateNameOk(name)) throw new Error(`candidate name ${JSON.stringify(name)} must be <owner>/<slice> in lowercase letters, digits, '.', '_' and '-'`);
  const transformation = sourceTransformationSync({ repository, sourceBase, commit });
  const object = transformation.sourceCommit;
  const tagger = gitTextSync(repository, ["var", "GIT_COMMITTER_IDENT"]);
  const text = (message ?? "").trim() || gitTextSync(repository, ["show", "-s", "--format=%s", object]);
  if (text.split("\n").some((line) => line.startsWith(SOURCE_TRAILER))) throw new TypeError("source transformation is supplied as data, not a message trailer");
  const declaredMessage = `${text}\n\n${SOURCE_TRAILER}${JSON.stringify(transformation)}`;
  const tag = gitTextSync(repository, ["mktag"], { input: `object ${object}\ntype commit\ntag queue/${name}\ntagger ${tagger}\n\n${declaredMessage}\n` });
  gitSync(repository, ["update-ref", `${QUEUE_REF}${name}`, tag]);
  return { name, ref: `${QUEUE_REF}${name}`, commit: object, tag, local: true, message: declaredMessage, transformation };
}
export const nameCandidate = async (request) => nameCandidateSync(request);

/** Remote branches carry the same declaration in an envelope, preserving source provenance. */
export function candidateTransportSync({ repository, candidate }) {
  readTransformation(repository, candidate.commit, candidate.message);
  return commitTreeSync(repository, treeOfSync(repository, candidate.commit), [candidate.commit], `${candidate.message}\n`);
}

/**
 * A producer that writes files into the node's checkout (a channel checkpoint, a persona's turn, a
 * census) lands them as a candidate: main as origin last published it, with each named path set to
 * what the checkout holds there now -- a file's bytes and executable bit, a symlink, a submodule
 * checkout's HEAD as its gitlink, or nothing for a path that is gone. The checkout's own HEAD and
 * index are neither read nor moved, so a stale checkout lands nothing stale. The workspace lockfile is
 * never taken from a producer (the queue derives it). Returns the named candidate, or null when the
 * checkout already agrees with main on every named path.
 */
export function landPathsSync({ repository, name, paths, message, fetch = true }) {
  if (fetch) { try { gitSync(repository, ["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"]); } catch {} }
  const base = gitTextSync(repository, ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"]);
  const changes = {};
  for (const path of paths.filter((path) => path !== LOCKFILE)) {
    const absolute = join(repository, path);
    let stat;
    try { stat = lstatSync(absolute); } catch { changes[path] = null; continue; }
    if (stat.isSymbolicLink()) changes[path] = { mode: "120000", object: writeBlobSync(repository, readlinkSync(absolute)) };
    else if (stat.isFile()) changes[path] = { mode: stat.mode & 0o111 ? "100755" : "100644", object: gitTextSync(repository, ["hash-object", "-w", "--", path]) };
    else if (stat.isDirectory() && existsSync(join(absolute, ".git"))) changes[path] = { mode: "160000", object: gitTextSync(absolute, ["rev-parse", "--verify", "HEAD^{commit}"]) };
    else throw new Error(`landPaths: ${path} is neither a file, a symlink nor a submodule checkout`);
  }
  const before = treeOfSync(repository, base);
  const tree = replaceInTreeSync(repository, before, changes);
  if (tree === before) return null;
  const commit = commitTreeSync(repository, tree, [base], `${message.trim()}\n`);
  return nameCandidateSync({ repository, name, commit, sourceBase: base, message });
}

/** Compose only declared source transformations. Ancestry never establishes scope or acceptance. */
export async function composeCandidates({ repository, base, candidates, derived = [] }) {
  const derivedPaths = new Set(derived);
  let head = base;
  const composed = [];
  const conflicts = [];
  for (const candidate of candidates) {
    let transformation;
    try {
      transformation = readTransformation(repository, candidate.commit, candidate.message ?? await gitText(repository, ["show", "-s", "--format=%B", candidate.commit]));
    } catch (error) {
      conflicts.push({ candidate, paths: [], reason: `undeclared or invalid source transformation: ${error.message}` });
      continue;
    }
    let tree;
    let conflicted = [];
    try {
      tree = (await gitText(repository, ["merge-tree", "--write-tree", "--name-only", "--no-messages", `--merge-base=${transformation.sourceBase}`, head, transformation.sourceCommit])).split("\n")[0];
    } catch (error) {
      if (error.status !== 1) throw error;
      const [written, ...paths] = error.stdout.trim().split("\n");
      tree = written;
      conflicted = [...new Set(paths.filter(Boolean))];
    }
    const blocking = conflicted.filter((path) => !derivedPaths.has(path));
    if (blocking.length > 0) { conflicts.push({ candidate, paths: blocking, reason: "declared source transformation conflicts with receiving source outside derived paths" }); continue; }
    // Derived source always comes from the receiving side until independent derivation, even
    // when the producer's derived change would have merged cleanly.
    const changes = {};
    for (const path of derivedPaths) changes[path] = await entryAt(repository, head, path);
    if (derivedPaths.size > 0) tree = await replaceInTree(repository, tree, changes);
    const message = `Integrate ${candidate.name} into main\n\n${candidate.message || await subjectOf(repository, candidate.commit)}\n\nQueue-Candidate: ${candidate.name} ${candidate.commit}\nSource-Transformation-Identity: ${transformation.id}\n`;
    head = await derivedCommit(repository, tree, [head], message);
    composed.push(candidate);
  }
  return { head, composed, conflicts };
}

/** A path the workspace install reads: a manifest, the lockfile or the workspace's own files. */
const workspaceInput = (path) => path === LOCKFILE || path === "package.json" || path.endsWith("/package.json")
  || path === "pnpm-workspace.yaml" || path === ".npmrc" || path === ".gitmodules";

/**
 * Main moved while an integration was admitted, by a writer the queue does not order (a pull
 * request merged on GitHub). Deferring would throw the admitted work away for a commit main already
 * holds unadmitted, so a queue raced by such a writer never publishes. When main only moved forward,
 * by commits that share no path with the integration and change no workspace input (manifests,
 * lockfile, workspace files, gitlinks), the two changes are independent: their merge is published
 * as main, and the release that follows checks the union like any other main. Anything else
 * returns a reason, and the candidates compose again onto main as it stands.
 */
export async function absorbOutsideMain({ repository, base, now, commit }) {
  if (!(await isAncestor(repository, base, now))) return { reason: `main ${now} does not descend from ${base}` };
  const changed = async (from, to) => (await gitText(repository, ["diff", "--name-only", "--no-renames", from, to])).split("\n").filter(Boolean);
  const outside = await changed(base, now);
  const ours = new Set(await changed(base, commit));
  const shared = outside.filter((path) => ours.has(path));
  if (shared.length > 0) return { reason: `main's outside commits share ${shared.length} path(s) with the integration`, paths: shared };
  const gitlinks = (await gitText(repository, ["diff", "--raw", "--no-renames", base, now])).split("\n").some((line) => / 160000 |^:160000 /u.test(line));
  if (gitlinks || outside.some(workspaceInput)) return { reason: "main's outside commits changed the workspace's inputs" };
  let tree;
  try {
    tree = (await gitText(repository, ["merge-tree", "--write-tree", "--no-messages", now, commit])).split("\n")[0];
  } catch (error) {
    return { reason: `main's outside commits do not merge with the integration: ${error.message.split("\n")[0]}` };
  }
  const message = `Absorb main's outside commits into the admitted integration ${commit.slice(0, 12)}\n\n`
    + `Main moved from ${base} to ${now} while ${commit} was admitted; the ${outside.length} path(s) its outside commits\n`
    + "changed share none with the integration and include no workspace input.\n";
  return { commit: await derivedCommit(repository, tree, [now, commit], message), outside: outside.length };
}

/**
 * The commit `head` with its derived source derived: the same parents and message, the lockfile
 * replaced by the one its manifests derive. A head that is `base` itself (no candidate composed) gets
 * a commit of its own over base, and only when derivation changed something.
 */
export async function deriveIntegration({ repository, base, head, lockfile }) {
  if (!lockfile?.derive) return { commit: head, derived: [] };
  if (lockfile.path !== undefined && lockfile.path !== LOCKFILE) throw new TypeError("workspace lock qualification owns pnpm-lock.yaml only");
  const { lockfile: bytes, changed } = await qualifyWorkspaceLockfile({ repository, commit: head,
    derive: lockfile.derive, install: lockfile.install, stateDirectory: lockfile.stateDirectory, home: lockfile.home });
  if (!changed) return { commit: head, derived: [] };
  const path = lockfile.path ?? LOCKFILE;
  const tree = await replaceInTree(repository, await treeOf(repository, head), { [path]: { mode: "100644", object: await writeBlob(repository, bytes) } });
  if (head === base) {
    return { commit: await derivedCommit(repository, tree, [base], `Derive ${path} from the workspace manifests of ${base.slice(0, 12)}\n\nMain's committed ${path} did not satisfy its manifests; the queue derived it.\n`), derived: [path] };
  }
  const parents = (await gitText(repository, ["show", "-s", "--format=%P", head])).split(" ").filter(Boolean);
  const message = String(await git(repository, ["show", "-s", "--format=%B", head]));
  return { commit: await derivedCommit(repository, tree, parents, `${message.trimEnd()}\nQueue-Derived: ${path}\n`), derived: [path] };
}

/** Retires a candidate's naming once it has its verdict; a ref renamed since names a new candidate. */
async function retire(repository, candidate) {
  if (candidate.main) return;
  if (candidate.local) await git(repository, ["update-ref", "-d", candidate.ref, candidate.tag ?? candidate.commit]).catch(() => {});
  else await git(repository, ["push", "--quiet", "--no-verify", "origin", `--force-with-lease=refs/heads/queue/${candidate.name}:${candidate.commit}`, `:refs/heads/queue/${candidate.name}`]).catch(() => {});
}

/** Records one verdict per candidate and retires each answered naming. */
export async function answer({ repository, queueRoot, candidates, verdict, main, integration, reason, said, paths, batch, onStep = () => {} }) {
  const recordedAt = new Date().toISOString();
  for (const candidate of candidates) {
    // When the candidate was named and how long its answer took: the queue's own time to live.
    const namedAt = Number.isFinite(candidate.at) ? new Date(candidate.at * 1000).toISOString() : undefined;
    writeVerdict(queueRoot, {
      type: "NodeIntegrationVerdict", version: 1,
      candidate: { name: candidate.name, ref: candidate.ref, commit: candidate.commit, ...(namedAt ? { namedAt } : {}) },
      ...(namedAt ? { elapsedSeconds: Math.round((Date.parse(recordedAt) - candidate.at * 1000) / 1000) } : {}),
      verdict, main, ...(integration ? { integration } : {}), ...(batch ? { batch } : {}),
      ...(reason ? { reason } : {}), ...(said ? { said } : {}), ...(paths ? { paths: paths(candidate) } : {}),
      recordedAt,
    });
    onStep(`${verdict}: ${candidate.name} ${candidate.commit.slice(0, 12)}`);
    // An integrated slice has done the work it claimed: its claim is released.
    if (verdict === "integrated") releaseClaim(queueRoot, candidate.name);
    await retire(repository, candidate);
  }
}

/**
 * The queue's own reading of failed batches (suspect.json): `groups`, the candidate groups to admit
 * next, in order (a failed batch is split in halves, so a culprit among n candidates costs about
 * log2 n admissions, as Bors and Zuul bisect); and `waiting`, the candidates that failed only
 * because main itself could not be admitted: they are refused for nothing and wait, unanswered,
 * until main changes. A file written as `{ candidates }` reads as groups of one.
 */
const SUSPECT = "suspect.json";
function readSuspectFile(queueRoot) {
  try { return JSON.parse(readFileSync(join(queueRoot, SUSPECT), "utf8")) ?? {}; } catch { return {}; }
}
function writeSuspectFile(queueRoot, value) {
  mkdirSync(queueRoot, { recursive: true });
  const groups = (value.groups ?? []).filter((group) => group.length > 0);
  writeFileSync(join(queueRoot, SUSPECT), `${JSON.stringify({ groups, ...(value.waiting?.keys?.length ? { waiting: value.waiting } : {}) })}\n`);
}
export function suspectGroupsOf(queueRoot) {
  const file = readSuspectFile(queueRoot);
  if (Array.isArray(file.groups)) return file.groups.map((group) => [...group]);
  return Array.isArray(file.candidates) ? file.candidates.map((key) => [key]) : [];
}
export function setSuspectGroups(queueRoot, groups) {
  writeSuspectFile(queueRoot, { ...readSuspectFile(queueRoot), groups });
}
/** The candidates waiting on main `base`, or none once main has moved on from it. */
export function waitingOnMain(queueRoot, base) {
  const waiting = readSuspectFile(queueRoot).waiting;
  return waiting?.base === base ? new Set(waiting.keys) : new Set();
}
export function setWaitingOnMain(queueRoot, base, keys) {
  writeSuspectFile(queueRoot, { ...readSuspectFile(queueRoot), waiting: { base, keys: [...keys] } });
}
export function suspectsOf(queueRoot) {
  return new Set(suspectGroupsOf(queueRoot).flat());
}
export function setSuspects(queueRoot, keys) {
  setSuspectGroups(queueRoot, [...keys].map((key) => [key]));
}
/** A failed batch's two halves, in queue order. */
export const halves = (keys) => [keys.slice(0, Math.ceil(keys.length / 2)), keys.slice(Math.ceil(keys.length / 2))];
export const candidateKey = (candidate) => verdictKey(candidate.name, candidate.commit);

