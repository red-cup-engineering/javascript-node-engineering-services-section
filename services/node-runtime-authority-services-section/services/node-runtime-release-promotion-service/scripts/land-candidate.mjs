#!/usr/bin/env node
// Lands a commit through the node's merge queue (src/integrate.mjs): names it as a candidate and,
// with --wait, waits for its verdict. A writer never pushes main; the node composes the candidate
// onto main, derives the lockfile, admits, publishes and promotes it, and answers.
//   node land-candidate.mjs --name <owner>/<slice> --source-base <original-base> [--commit HEAD] [--message <text>] [--wait [seconds]]
//     [--repository <checkout>] [--spec <release.json path>] [--origin]
// In any worktree of the node's repository the candidate is a local ref (refs/queue/<name>), which
// every worktree shares; --origin pushes it as the branch queue/<name> instead, for a writer whose
// clone is not the node's. Naming a slice again with a new commit replaces the candidate; the old
// commit, if not yet taken, is simply never integrated. Exit status: 0 integrated, 1 refused or in
// conflict, 2 still waiting when the wait ended.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { git, gitText } from "../src/git-objects.mjs";
import { candidateNameOk, candidateTransportSync, nameCandidate, verdictOf } from "../src/integrate.mjs";

const DEFAULT_SPEC = "lib/emsenn/services/561-group/services/561-group-services-section/services/561-group-operations-services-section/services/bare-cedar-fog-services-section/data/records/machine-deployment-service-records/metroplat/deployments/bare-cedar-fog-host/deploy/release.json";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? true : value;
}

export async function landCandidate({ name, commitRef = "HEAD", sourceBase, message, repository = process.cwd(), spec = DEFAULT_SPEC, origin = false, waitSeconds = 0, home = homedir(), onStep = (line) => process.stderr.write(`${line}\n`) }) {
  if (!candidateNameOk(name)) throw new Error(`candidate name ${JSON.stringify(name)} must be <owner>/<slice> in lowercase letters, digits, '.', '_' and '-'`);
  const commit = await gitText(repository, ["rev-parse", "--verify", `${commitRef}^{commit}`]);
  const candidate = await nameCandidate({ repository, name, commit, sourceBase, message });
  const delivered = origin ? candidateTransportSync({ repository, candidate }) : commit;
  if (origin) {
    await git(repository, ["push", "--quiet", "--no-verify", "--force", "origin", `${delivered}:refs/heads/queue/${name}`]);
    await git(repository, ["update-ref", "-d", candidate.ref, candidate.tag]);
  }
  onStep(`named ${commit} as candidate ${name}`);
  const releaseSpec = JSON.parse(await gitText(repository, ["show", `refs/remotes/origin/main:${spec}`]).catch(() => readFileSync(resolve(repository, spec), "utf8")));
  const queueRoot = resolve(home, releaseSpec.releaseRoot, "queue");
  const statusFile = resolve(home, releaseSpec.releaseRoot, "status.json");
  const deadline = Date.now() + waitSeconds * 1000;
  let said = "";
  for (;;) {
    const verdict = verdictOf(queueRoot, name, delivered);
    if (verdict) return verdict;
    if (Date.now() >= deadline) return { verdict: "pending", candidate: { name, commit: delivered } };
    const status = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, "utf8")) : {};
    const now = `${status.state ?? "unknown"}${status.queue ? ` (queue: ${status.queue.pending.join(", ")})` : ""}`;
    if (now !== said) onStep(`node: ${(said = now)}`);
    await sleep(10_000);
  }
}

// import.meta.main, not a path comparison: run through the release's `current` link, argv names the
// link while the module's URL names the release, and a comparison made the command a silent no-op.
if (import.meta.main) {
  const name = option("--name");
  if (typeof name !== "string") throw new Error("usage: land-candidate.mjs --name <owner>/<slice> --source-base <original-base> [--commit HEAD] [--wait [seconds]] [--repository <checkout>] [--spec <release.json path>] [--origin]");
  const wait = option("--wait", false);
  const verdict = await landCandidate({
    name, sourceBase: option("--source-base"), commitRef: option("--commit", "HEAD"), message: typeof option("--message") === "string" ? option("--message") : undefined, repository: option("--repository", process.cwd()),
    spec: option("--spec", DEFAULT_SPEC), origin: option("--origin", false) === true,
    waitSeconds: wait === false ? 0 : wait === true ? 3600 : Number(wait),
  });
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  process.exitCode = verdict.verdict === "integrated" ? 0 : verdict.verdict === "pending" ? 2 : 1;
}
