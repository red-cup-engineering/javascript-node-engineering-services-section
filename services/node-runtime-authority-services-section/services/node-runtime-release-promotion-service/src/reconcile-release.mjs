// A host keeps itself released: each pass compares the commit a branch names with the commit the
// running release was built from, and when released bytes differ it starts one release of the
// branch in a transient unit of its own, so the release outlives the service it restarts.
// The pass is level-triggered and idempotent, so any number of passes converge on one release.
//
// States a pass reports:
//   converged  the running release is the branch's released bytes (or the branch is behind it)
//   healing    the running release had been edited in place; this pass started a release of its
//              own commit, which restores the committed bytes
//   releasing  a release holds the lock's lease or its unit is running
//   refused    the target commit's own release tool already refused it; its refusal receipt says
//              why (a refusal by another commit's tool is that tool's, and the target's own tool is
//              still owed its pass; a release another process ended leaves an interruption receipt
//              instead, and is retried)
//   settling   the first commit the running release lacks is younger than `settleSeconds`: a
//              burst of commits releases once, and no later than one window after it began, so a
//              branch that never goes quiet is still released (a debounce with a maximum wait)
//   launched   this pass started the release
//   integrating this pass started an integration of the merge queue (src/integrate.mjs): pending
//              candidates are composed onto the branch, admitted and published as it, then promoted;
//              they go before any settle window, since the integration releases the branch's own
//              unreleased commits with them. A branch whose own release its tool refused is
//              integrated alone once, which re-derives its derived source (a stale lockfile).
//
// A refusal stands until a release lands: every reading short of converged carries, as `refusal`,
// the newest refusal recorded since the running release was built, so a retry in flight never
// reads as a repair.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, readlink, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGIN_QUEUE_REFSPEC, lastIntegrationAt, pendingCandidates, verdictOf } from "./integrate.mjs";
import { readClaims } from "./claims.mjs";
import { RELEASE_RECEIPT } from "./release-digest.mjs";
import { verifyReleaseDrift } from "./release-drift.mjs";

const RELEASE_SCRIPT = "scripts/release-git-commit.mjs";
const INTEGRATE_SCRIPT = "scripts/integrate-node-candidates.mjs";
const releaseScript = fileURLToPath(new URL(`../${RELEASE_SCRIPT}`, import.meta.url));
// This service's path in the tree it ships in (a checkout, or a release carrying its receipt),
// which is its path in every commit that carries it, and the commit that tree was released from
// (none for a checkout's working tree).
const service = fileURLToPath(new URL("..", import.meta.url));
function shippedIn() {
  for (let candidate = service; ; candidate = dirname(candidate)) {
    if (existsSync(resolve(candidate, ".git"))) return { path: relative(candidate, service), commit: null };
    const receipt = resolve(candidate, RELEASE_RECEIPT);
    if (existsSync(receipt)) return { path: relative(candidate, service), commit: JSON.parse(readFileSync(receipt, "utf8")).source?.commit ?? null };
    if (dirname(candidate) === candidate) return { path: null, commit: null };
  }
}

function command(file, arguments_, options = {}) {
  return new Promise((resolvePromise) => {
    execFile(file, arguments_, { maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolvePromise({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

// Release and integration work yields to the node it releases: on a loaded host an install at equal
// weight stalled the node's event loop (a 51 s healthz on 2026-10-03), and carriers timed out their
// handshakes with it. The work still runs; it just runs behind the service.
const YIELDING = Object.freeze(["--nice=10", "--property=CPUWeight=20", "--property=IOWeight=20"]);

export function releaseUnitName(spec) {
  const base = spec.unit?.name?.replace(/\.service$/u, "") ?? basename(spec.releaseRoot).replaceAll(".", "-");
  return `${base}-release`;
}

// Each pass leaves its reading at <releaseRoot>/status.json, the host's release status for any reader.
export async function reconcileNodeRelease(options) {
  const { root, readout } = await reconcile(options);
  await mkdir(root, { recursive: true });
  const temporary = `${root}/.status.json.${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(readout, null, 2)}\n`);
  await rename(temporary, `${root}/status.json`);
  return readout;
}

async function reconcile({
  repository,
  spec: specPath,
  remote = "origin",
  branch = "main",
  settleSeconds = 120,
  verifyDrift = false,
  allowedRemoteHost,
  home = homedir(),
  environment = process.env,
  now = () => new Date(),
  run = command,
}) {
  if (!repository) throw new TypeError("node-release-reconcile: the repository is not configured");
  // The release unit runs outside the caller's working directory, so it is handed an absolute checkout.
  repository = resolve(repository);
  if (typeof specPath !== "string" || isAbsolute(specPath) || normalize(specPath).startsWith("..")) {
    throw new TypeError("node-release-reconcile: spec is a repository-relative release.json path");
  }
  const git = async (...arguments_) => {
    const result = await run("git", arguments_, { cwd: repository });
    if (result.code !== 0) throw new Error(`git ${arguments_.join(" ")}: exited ${result.code}: ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  const checkedAt = now().toISOString();
  await git("fetch", "--quiet", "--prune", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`, ORIGIN_QUEUE_REFSPEC);
  const desired = await git("rev-parse", "--verify", `refs/remotes/${remote}/${branch}^{commit}`);
  const spec = JSON.parse(await git("show", `${desired}:${specPath}`));
  const remoteHost = spec.host && spec.host !== "local" ? spec.host : null;
  if (remoteHost !== null && remoteHost !== allowedRemoteHost) throw new TypeError("node-release-reconcile: remote host is not authorized by this operation");
  if (remoteHost !== null && verifyDrift) throw new TypeError("node-release-reconcile: remote drift verification is not available");
  const root = resolve(home, spec.releaseRoot);
  const receipts = resolve(home, spec.receiptRoot);
  const unit = releaseUnitName(spec);
  const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  const remoteRun = async (script) => {
    const result = await run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", remoteHost, script]);
    if (result.code === 255) throw new Error(`node-release-reconcile: cannot reach ${remoteHost}: ${result.stderr.trim()}`);
    return result;
  };
  const remoteRead = async (script, { optional = false } = {}) => {
    const result = await remoteRun(script);
    if (result.code !== 0) {
      if (optional) return null;
      throw new Error(`node-release-reconcile: ${remoteHost} read failed: ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  };

  const runningDigest = remoteHost === null
    ? await readlink(resolve(root, "current")).catch(() => null)
    : await remoteRead(`readlink ${shellQuote(`${spec.releaseRoot}/current`)}`, { optional: true });
  const runningReceipt = runningDigest === null ? null
    : remoteHost === null
      ? await readFile(resolve(root, runningDigest, "release-receipt.json"), "utf8").then(JSON.parse, () => null)
      : JSON.parse(await remoteRead(`cat ${shellQuote(`${spec.releaseRoot}/${runningDigest}/release-receipt.json`)}`));
  const running = { commit: runningReceipt?.source?.commit ?? null, digest: runningDigest };
  const readout = (state, extra = {}) => ({ root, readout: Object.freeze({ kind: "node-release-reconciliation", checkedAt, spec: specPath, host: remoteHost ?? "local", unit, desired: { commit: desired }, running, state, ...extra }) });
  let refusalNames;
  const refusalsListed = async () => refusalNames ??= (remoteHost === null ? await readdir(receipts).catch(() => [])
    : (await remoteRead(`if test -d ${shellQuote(spec.receiptRoot)}; then ls -1 ${shellQuote(spec.receiptRoot)}; fi`)).split("\n"))
    .filter((name) => name.endsWith(".refusal.json"));
  const refusalOf = async (name) => {
    const receiptPath = remoteHost === null ? resolve(receipts, name) : `${spec.receiptRoot}/${name}`;
    const receipt = JSON.parse(remoteHost === null
      ? await readFile(receiptPath, "utf8")
      : await remoteRead(`cat ${shellQuote(receiptPath)}`));
    return { target: receipt.commit, tool: receipt.tool, reason: receipt.reason, receipt: remoteHost === null ? receiptPath : `${remoteHost}:${receiptPath}` };
  };
  // Receipt names lead with their recording time, colons spelled as dashes.
  const standingRefusal = async () => {
    const since = String(runningReceipt?.materializedAt ?? "").replaceAll(":", "-");
    const name = (await refusalsListed()).filter((candidate) => candidate > since).sort().at(-1);
    return name === undefined ? {} : { refusal: Object.freeze(await refusalOf(name)) };
  };
  // Receiving runs the installed service's complete dependency closure. Unreceived source
  // is input to admission, never a substitute executable receiver or a partial tool archive.
  const shipped = shippedIn();
  const toolCommitOf = async () => shipped.commit;
  const toolOf = async () => releaseScript;

  // The lock directory stays in place between releases; a release is in progress only while its
  // flock lease on `.release.lock/lease` is held. A legacy lock file or holder.json is held until its
  // owner reviews it, as the release script treats it. The probe runs from the host's home.
  const unitActive = (await run("systemctl", ["--user", "is-active", "--quiet", `${unit}.service`])).code === 0;
  const lockProbe = `lock=${shellQuote(`${spec.releaseRoot}/.release.lock`)}; `
    + `if [ -f "$lock" ] || [ -e "$lock/holder.json" ]; then exit 1; fi; `
    + `if [ ! -e "$lock/lease" ]; then exit 0; fi; flock --nonblock --shared "$lock/lease" true`;
  const locked = (remoteHost === null ? await run("sh", ["-c", lockProbe], { cwd: home }) : await remoteRun(lockProbe)).code !== 0;
  if (unitActive || locked) return readout("releasing", await standingRefusal());

  // Released bytes differ only where the spec's archives differ; anything else is data the host
  // does not run. A branch that is behind the running commit waits for the branch to catch up.
  let target = desired;
  const known = running.commit !== null && (await run("git", ["cat-file", "-e", `${running.commit}^{commit}`], { cwd: repository })).code === 0;
  let basis = running.commit === desired ? "same-commit" : null;
  if (basis === null && known) {
    const unchanged = [];
    for (const pathspecs of spec.archives) {
      unchanged.push((await run("git", ["diff", "--quiet", running.commit, desired, "--", ...pathspecs], { cwd: repository })).code === 0);
    }
    if (unchanged.every(Boolean)) basis = "no-released-change";
    else if ((await run("git", ["merge-base", "--is-ancestor", desired, running.commit], { cwd: repository })).code === 0) basis = "running-ahead";
  }
  // The merge queue goes first: pending candidates, or a refused branch owed its one healing
  // integration. The integrator and release tool are the installed receiver's.
  const queueRoot = resolve(root, "queue");
  const pending = remoteHost === null ? await pendingCandidates({ repository, queueRoot }) : [];
  const refusalOf_ = async (commit) => {
    const name = (await refusalsListed()).filter((candidate) => candidate.endsWith(`-${commit}.refusal.json`)).sort().at(-1);
    if (name === undefined) return null;
    const refusal = await refusalOf(name);
    return refusal.tool === await toolCommitOf(commit) ? refusal : null;
  };
  const healOwed = remoteHost === null && basis === null && known
    && (await refusalOf_(desired)) !== null && verdictOf(queueRoot, "node/main", desired) === undefined;
  const claims = remoteHost === null ? readClaims(queueRoot) : [];
  const queue = pending.length > 0 || claims.length > 0 ? { queue: {
    pending: pending.map(({ name, commit }) => `${name}@${commit.slice(0, 12)}`),
    claims: claims.map(({ name, paths, by, claimedAt }) => ({ name, paths, by, claimedAt })),
  } } : {};
  // Main never waits on the queue for longer than its patience: an integration carries main's own
  // unreleased commits, but one that cannot publish (refused, deferred, bisecting) would hold them
  // back indefinitely. Once main has waited `queue.mainPatienceSeconds` with no integration, and its
  // own release has not been refused, this pass releases main itself and the queue resumes on the next.
  const patience = (spec.queue?.mainPatienceSeconds ?? 1800) * 1000;
  const oldestLacked = basis === null && known
    ? Number((await git("rev-list", "--reverse", "--format=%ct", "--no-commit-header", `${running.commit}..${desired}`)).split("\n")[0] || 0) * 1000
    : 0;
  // A main refused since the running release (by any commit's own tool) is not released by patience:
  // a newer outside commit seldom repairs it, and each attempt costs a full release (21:20-21:45Z on
  // 2026-10-03, three attempts on a missing export). The queue, which can carry the repair, goes first.
  const mainRefusedSince = Object.keys(await standingRefusal()).length > 0;
  // Patience runs from when main last had a way out: the oldest commit it lacks, or the queue's last
  // integration, whichever is later. A queue that integrates every few minutes carries main's
  // outside commits with each batch, so a release of main alone would only delay it; on
  // 2026-10-03 at 17:56 an outside merge older than 30 minutes cost the queue a full release.
  const waitingSince = Math.max(oldestLacked, lastIntegrationAt(queueRoot));
  const mainOverdue = pending.length > 0 && oldestLacked > 0 && waitingSince + patience < now().getTime() && !mainRefusedSince && (await refusalOf_(desired)) === null;
  if ((pending.length > 0 && !mainOverdue) || healOwed) {
    const integrator = resolve(dirname(await toolOf(desired)), basename(INTEGRATE_SCRIPT));
    if (existsSync(integrator)) {
      const launched = await run("systemd-run", [
        "--user", `--unit=${unit}`, "--collect", "--quiet", ...YIELDING, `--description=Integrate ${pending.length} candidate(s) onto ${desired} of ${specPath}`,
        `--setenv=HOME=${home}`, `--setenv=PATH=${[dirname(process.execPath), environment.PATH ?? "/usr/bin:/bin"].join(delimiter)}`,
        process.execPath, integrator, "--repository", repository, "--spec-in-commit", specPath, ...(pending.length === 0 ? ["--heal"] : []),
      ]);
      if (launched.code !== 0) {
        if ((await run("systemctl", ["--user", "is-active", "--quiet", `${unit}.service`])).code === 0) return readout("releasing", { ...queue, ...await standingRefusal() });
        throw new Error(`systemd-run ${unit}: exited ${launched.code}: ${launched.stderr.trim()}`);
      }
      return readout("integrating", { ...queue, ...(pending.length === 0 ? { healing: desired } : {}), log: `journalctl --user -u ${unit}.service`, ...await standingRefusal() });
    }
  }
  if (basis !== null) {
    if (!verifyDrift || runningDigest === null) return readout("converged", { basis, ...queue });
    if (spec.guix) {
      const generation = await realpath(resolve(root, "current"));
      if (!generation.startsWith("/gnu/store/")) throw new Error("the deployment profile is outside the Guix store");
      return readout("converged", { basis, verified: "guix-store", ...queue });
    }
    if ((await verifyReleaseDrift({ release: await realpath(resolve(root, "current")), repository })).ok) return readout("converged", { basis, verified: true });
    target = running.commit;
  }

  // A refusal is the target's only when the tool that would release it now made it.
  const refused = (await refusalsListed()).filter((name) => name.endsWith(`-${target}.refusal.json`)).sort().at(-1);
  if (refused !== undefined) {
    const refusal = await refusalOf(refused);
    if (refusal.tool === await toolCommitOf(target)) return readout("refused", refusal);
  }
  if (target === desired) {
    // The window opens at the oldest commit the running release lacks, not the newest: under
    // concurrent pushes the newest is always young, and a window that restarts on each one never
    // closes. A running commit this checkout does not know opens the window at the target itself.
    const lacked = known ? (await git("rev-list", "--reverse", "--format=%ct", "--no-commit-header", `${running.commit}..${desired}`)).split("\n")[0] : "";
    const committedAt = Number(lacked || await git("show", "-s", "--format=%ct", desired)) * 1000;
    const settlesAt = committedAt + settleSeconds * 1000;
    if (settlesAt > now().getTime()) return readout("settling", { settlesAt: new Date(settlesAt).toISOString(), ...await standingRefusal() });
  }

  // The release runs the target commit's own copy of the tool, as a system generation activates
  // itself: a change to how releases are made lands through the first release that carries it, and
  // a tool broken in one commit is repaired by the next, never only by hand. The tool tree is the
  // target's archive of this service, marked as a release of it by its receipt; only the tree of
  // the release being launched is kept. A target that does not carry this service at its path is
  // released by the running tool. The release reads the spec the target carries, under this node's
  // own runtime, first on PATH for the spec's commands. Its log is the unit's journal. It stands
  // where the service it releases stands when memory runs out: a release ended halfway is a release
  // the service waits another pass for.
  const tool = await toolOf(target);
  const standing = spec.unit?.name === undefined ? ""
    : String((await run("systemctl", ["--user", "show", spec.unit.name, "--property=OOMScoreAdjust", "--value"])).stdout ?? "").trim();
  const launched = await run("systemd-run", [
    "--user", `--unit=${unit}`, "--collect", "--quiet", ...YIELDING, `--description=Release ${target} of ${specPath}`,
    ...(/^-?\d+$/u.test(standing) ? [`--property=OOMScoreAdjust=${standing}`] : []),
    `--setenv=HOME=${home}`, `--setenv=PATH=${[dirname(process.execPath), environment.PATH ?? "/usr/bin:/bin"].join(delimiter)}`,
    process.execPath, tool, "--repository", repository, "--spec-in-commit", specPath, "--commit", target,
  ]);
  if (launched.code !== 0) {
    if ((await run("systemctl", ["--user", "is-active", "--quiet", `${unit}.service`])).code === 0) return readout("releasing", await standingRefusal());
    throw new Error(`systemd-run ${unit}: exited ${launched.code}: ${launched.stderr.trim()}`);
  }
  return readout(target === desired ? "launched" : "healing", { target, log: `journalctl --user -u ${unit}.service`, ...await standingRefusal() });
}
