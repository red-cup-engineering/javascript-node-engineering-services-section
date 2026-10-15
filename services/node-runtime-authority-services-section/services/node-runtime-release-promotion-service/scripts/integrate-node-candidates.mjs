#!/usr/bin/env node
// One integration of the node's merge queue (src/integrate.mjs), run by the reconciler in the
// release's transient unit, so it outlives the restart its promotion performs:
//   node integrate-node-candidates.mjs --repository <checkout> --spec-in-commit <release.json path>
//     [--batch 8] [--heal]
// It composes the pending candidates onto origin/main, derives the composed tree's derived source,
// admits the integration commit as a release, publishes it as main just before promotion, and
// answers every candidate it took. With no candidate and --heal it integrates main alone, which
// re-derives a main whose own release was refused.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { git, gitText } from "../src/git-objects.mjs";
import {
  ORIGIN_QUEUE_REFSPEC, absorbOutsideMain, answer, candidateKey, composeCandidates, deriveIntegration, halves, pendingCandidates, setSuspectGroups,
  setWaitingOnMain, suspectGroupsOf, waitingOnMain,
} from "../src/integrate.mjs";
import { releaseGitCommit } from "./release-git-commit.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
}

const onStep = (message) => process.stderr.write(`${message}\n`);
// The tail of what a failing step said: a refusal's reason leads with the condition.
const tailOf = (text) => String(text ?? "").split("\n").slice(-30).join("\n").slice(-6000);

/**
 * Whether main `base` can be admitted by itself: the node runs it, or (read once per commit and kept
 * in the queue's main-health.json) its own manifests derive their lockfile. A batch that fails on a
 * main that cannot be admitted fails for main's reason, not its candidates'.
 */
async function mainAdmissible({ repository, base, lockfile, queueRoot, home, releaseRoot }) {
  try {
    if (JSON.parse(readFileSync(resolve(home, releaseRoot, "current", "release-receipt.json"), "utf8"))?.source?.commit === base) return true;
  } catch { /* no running release to read */ }
  const memoPath = resolve(queueRoot, "main-health.json");
  try {
    const memo = JSON.parse(readFileSync(memoPath, "utf8"));
    if (memo.base === base) return memo.admissible;
  } catch { /* not yet read for any main */ }
  let admissible = true;
  try { await deriveIntegration({ repository, base, head: base, lockfile }); }
  catch (error) { if (error.interrupted) throw error; admissible = false; }
  mkdirSync(queueRoot, { recursive: true });
  writeFileSync(memoPath, `${JSON.stringify({ base, admissible, at: new Date().toISOString() })}\n`);
  return admissible;
}

export async function integrateNodeCandidates({ repository, specInCommit, batchSize = 8, heal = false, home = homedir() }) {
  repository = resolve(repository);
  await git(repository, ["fetch", "--quiet", "--prune", "origin", "+refs/heads/main:refs/remotes/origin/main", ORIGIN_QUEUE_REFSPEC]);
  const base = await gitText(repository, ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"]);
  const spec = JSON.parse(await gitText(repository, ["show", `${base}:${specInCommit}`]));
  const queueRoot = resolve(home, spec.releaseRoot, "queue");
  // Derivation and receiving use the same release declaration. The retained
  // output only avoids repeated resolution; it is frozen-received on every use.
  const lockfileOf = sourceSpec => sourceSpec.lockfile && { ...sourceSpec.lockfile, install: sourceSpec.dependencies ?? sourceSpec.install,
    stateDirectory: resolve(queueRoot, "workspace-lockfiles"), home };
  const baseLockfile = lockfileOf(spec);
  batchSize = spec.queue?.batch ?? batchSize;
  const named = await pendingCandidates({ repository, queueRoot });
  // Every declared delivery receives its own judgment; ancestry proves no fulfillment.
  const pending = named;
  // Candidates waiting on this main are not admitted again until main changes.
  const waiting = waitingOnMain(queueRoot, base);
  const active = pending.filter((candidate) => !waiting.has(candidateKey(candidate)));
  const activeKeys = new Set(active.map(candidateKey));
  // After a failed batch its halves are admitted in turn, each a batch of its own.
  const groups = suspectGroupsOf(queueRoot).map((group) => group.filter((key) => activeKeys.has(key))).filter((group) => group.length > 0);
  const group = groups[0];
  const laterGroups = group ? groups.slice(1) : groups;
  const batch = group ? active.filter((candidate) => group.includes(candidateKey(candidate))) : active.slice(0, batchSize);
  if (batch.length === 0 && !heal) return { base, outcome: "idle" };
  onStep(`integrate onto ${base}: ${batch.map((candidate) => candidate.name).join(", ") || "(main alone)"}`);

  const derived = [...(spec.derived ?? []), ...(spec.lockfile ? [spec.lockfile.path ?? "pnpm-lock.yaml"] : [])];
  const { head, composed, conflicts } = await composeCandidates({ repository, base, candidates: batch, derived });
  const main = { before: base };
  for (const { candidate, paths, reason } of conflicts) {
    await answer({ repository, queueRoot, candidates: [candidate], verdict: "conflict", main,
      reason, paths: () => paths, onStep });
  }
  if (composed.length === 0 && !heal) return { base, outcome: "conflicts" };

  /**
   * A batch that did not pass is split in halves, each admitted in turn, so a culprit among n
   * candidates costs about log2 n admissions; on a main that cannot be admitted by itself the same
   * search finds the half that repairs it. A lone candidate is refused only on an admissible main: on
   * one that cannot be admitted, its failure is main's, and it waits, unanswered, until main changes.
   */
  const failed = async ({ reason, said, integration: integrationCommit }) => {
    const keys = composed.map(candidateKey);
    if (composed.length > 1) {
      setSuspectGroups(queueRoot, [...halves(keys), ...laterGroups]);
      onStep(`batch of ${composed.length} refused; its halves are admitted in turn`);
      return { base, outcome: "suspect" };
    }
    let baseAdmissible;
    try { baseAdmissible = await mainAdmissible({ repository, base, lockfile: baseLockfile, queueRoot, home, releaseRoot: spec.releaseRoot }); }
    catch (error) { if (error.interrupted) return { base, outcome: "interrupted", reason: error.message }; throw error; }
    if (!baseAdmissible) {
      setWaitingOnMain(queueRoot, base, [...waiting, ...keys]);
      setSuspectGroups(queueRoot, laterGroups);
      onStep(`${composed[0].name} waits on main: ${base} cannot be admitted by itself, so this failure is main's, not the candidate's`);
      return { base, outcome: "waiting-on-main" };
    }
    await answer({ repository, queueRoot, candidates: composed, verdict: "refused", main: { before: base }, ...(integrationCommit ? { integration: integrationCommit } : {}), reason, said, onStep });
    setSuspectGroups(queueRoot, laterGroups);
    return { base, outcome: "refused" };
  };

  let integration;
  try {
    // The release admits the composed commit's declaration, not the former
    // base's. Invalid/missing candidate declarations follow ordinary bisection
    // and refusal, rather than crashing the queue before its failure handler.
    const candidateSpec = JSON.parse(await gitText(repository, ["show", `${head}:${specInCommit}`]));
    const lockfile = lockfileOf(candidateSpec);
    // Derivation resolves online, and a registry that blinked is no fault of the batch: it is said
    // and tried once more before any candidate is suspected (a batch was bisected over one at 19:13Z).
    integration = await deriveIntegration({ repository, base, head, lockfile }).catch(async (error) => {
      if (error.interrupted) throw error;
      onStep(`lockfile derivation failed, trying once more: ${tailOf(error.said ?? error.message).split("\n").slice(-4).join(" | ")}`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 30_000));
      return deriveIntegration({ repository, base, head, lockfile });
    });
  } catch (error) {
    // An unavailable/lost lease or interrupted command says nothing about a
    // candidate's admissibility. Leave its queue entry pending for resumption.
    if (error.interrupted) return { base, outcome: "interrupted", reason: error.message };
    onStep(`lockfile derivation refused the batch: ${tailOf(error.said ?? error.message).split("\n").slice(-6).join(" | ")}`);
    if (composed.length > 0) return failed({ reason: "derivation refused: the composed manifests do not resolve", said: tailOf(error.said ?? error.message) });
    await answer({ repository, queueRoot, candidates: [{ name: "node/main", ref: "refs/remotes/origin/main", commit: base, local: true, main: true }],
      verdict: "refused", main, reason: "derivation refused: the composed manifests do not resolve", said: tailOf(error.said ?? error.message), onStep });
    return { base, outcome: "refused" };
  }
  const commit = integration.commit;
  const mainItself = { name: "node/main", ref: "refs/remotes/origin/main", commit: base, local: true, main: true };
  if (commit === base) {
    // Main alone, and its derived source already satisfies its manifests: its refusal is its source's,
    // which only a candidate can repair. The verdict keeps the reconciler from healing it again.
    await answer({ repository, queueRoot, candidates: [mainItself], verdict: "refused", main,
      reason: "main's own release was refused and its derived source already satisfies its manifests; a candidate must repair its source", onStep });
    return { base, outcome: "unchanged" };
  }
  // The integration commit is named before it is admitted, so its objects stay reachable whatever the
  // outcome, and a reader can find what the queue is admitting.
  await git(repository, ["update-ref", "refs/integration/current", commit]);
  const admittedRoot = resolve(queueRoot, "admitted");
  let published = false;
  let publishedAs = commit;

  try {
    const receipt = await releaseGitCommit({
      specInCommit, repository, commitRef: commit, releaseBase: base, onStep,
      beforePromotion: async ({ digest }) => {
        // The admission record is what lets this push through the repository's pre-push gate: main
        // takes only commits the node admitted.
        const admit = (admitted, extra = {}) => {
          mkdirSync(admittedRoot, { recursive: true });
          writeFileSync(resolve(admittedRoot, `${admitted}.json`), `${JSON.stringify({ type: "NodeIntegrationAdmission", version: 1, commit: admitted, digest, base, candidates: composed.map(({ name, commit: candidate }) => ({ name, commit: candidate })), derived: integration.derived, ...extra, admittedAt: new Date().toISOString() }, null, 2)}\n`);
        };
        admit(commit);
        let offered = commit;
        for (let attempt = 1; ; attempt += 1) {
          try {
            await git(repository, ["push", "--quiet", "origin", `${offered}:refs/heads/main`]);
            break;
          } catch (cause) {
            await git(repository, ["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"]).catch(() => {});
            const now = await gitText(repository, ["rev-parse", "refs/remotes/origin/main"]).catch(() => base);
            // A writer outside the queue moved main: absorb its commits when they are independent of
            // the integration (src/integrate.mjs absorbOutsideMain), else compose again.
            const absorbed = now === base || attempt > 3 ? { reason: now === base ? "main did not move" : "main kept moving" }
              : await absorbOutsideMain({ repository, base, now, commit }).catch((error) => ({ reason: error.message }));
            if (absorbed.commit) {
              admit(absorbed.commit, { absorbs: { integration: commit, main: now, outside: absorbed.outside } });
              offered = absorbed.commit;
              onStep(`main moved to ${now}; absorbing its ${absorbed.outside} outside path(s) as ${absorbed.commit}`);
              continue;
            }
            // What git said is the verdict's evidence: a push refused by the remote or by a hook reads
            // nothing like one main outran.
            const error = new Error(`${now === base ? `main is still ${base}, yet` : `main moved to ${now} (${absorbed.reason}), and`} publishing ${offered} failed: ${cause.message}`, { cause });
            if (now !== base) error.deferred = true;
            throw error;
          }
        }
        published = true;
        publishedAs = offered;
        onStep(`published ${offered} as main`);
      },
    });
    await answer({ repository, queueRoot, candidates: composed, verdict: "integrated", main: { before: base, after: publishedAs }, integration: commit,
      batch: composed.map(({ name }) => name), onStep });
    setSuspectGroups(queueRoot, laterGroups);
    return { base, outcome: "integrated", commit, receipt };
  } catch (error) {
    if (error.deferred) { onStep(error.message); return { base, outcome: "deferred" }; }
    // A published batch is in main already; bisecting it would re-admit what main holds.
    if (composed.length > 0 && !published) return failed({ reason: "the integration was refused at admission", said: tailOf(error.message), integration: commit });
    // A failure after publication (promotion, restart, health) rolled the node back, but main already
    // holds the commit: the verdict says so, and main's next integration answers for it.
    await answer({ repository, queueRoot, candidates: composed.length ? composed : [mainItself],
      verdict: "refused", main: published ? { before: base, after: commit } : main, integration: commit,
      reason: published ? "the integration was published as main but failed after promotion, and the node rolled back" : "the integration was refused at admission",
      said: tailOf(error.message), onStep });
    setSuspectGroups(queueRoot, laterGroups);
    return { base, outcome: "refused", commit };
  }
}

if (import.meta.main) {
  const specInCommit = option("--spec-in-commit");
  if (!specInCommit) throw new Error("usage: integrate-node-candidates.mjs --repository <checkout> --spec-in-commit <path> [--batch 8] [--heal]");
  const result = await integrateNodeCandidates({
    repository: option("--repository", process.cwd()), specInCommit,
    batchSize: Number(option("--batch", "8")), heal: process.argv.includes("--heal"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

