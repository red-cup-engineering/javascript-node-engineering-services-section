import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { reconcileNodeRelease } from "../src/reconcile-release.mjs";

const SPEC = "deploy/release.json";

// A remote, a checkout of it, and a host whose `current` release was built from `running`.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "node-release-reconcile-"));
  const git = (cwd, ...arguments_) => execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
  const origin = join(root, "origin.git");
  const author = join(root, "author");
  const checkout = join(root, "checkout");
  const home = join(root, "home");
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", origin]);
  execFileSync("git", ["clone", "--quiet", origin, author], { stdio: "ignore" });
  git(author, "config", "user.email", "test@example.invalid");
  git(author, "config", "user.name", "test");
  const commit = async (files, ageSeconds = 3600) => {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(author, path, ".."), { recursive: true });
      await writeFile(join(author, path), text);
    }
    git(author, "add", "-A");
    const date = new Date(Date.now() - ageSeconds * 1000).toISOString();
    execFileSync("git", ["commit", "--quiet", "-m", "change"], { cwd: author, env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
    git(author, "push", "--quiet", "origin", "main");
    return git(author, "rev-parse", "HEAD");
  };
  const spec = { host: "local", releaseRoot: "releases/app", receiptRoot: "releases/app/receipts", archives: [[".", ":(exclude,glob)**/data/state/**"]], unit: { name: "app.service", file: "app.service" } };
  const running = await commit({ [SPEC]: JSON.stringify(spec), "app/server.mjs": "export default 1;\n" });
  execFileSync("git", ["clone", "--quiet", origin, checkout], { stdio: "ignore" });
  const releases = join(home, spec.releaseRoot);
  const digest = "a".repeat(64);
  await mkdir(join(releases, digest), { recursive: true });
  await writeFile(join(releases, digest, "release-receipt.json"), JSON.stringify({ artifactDigest: digest, source: { commit: running } }));
  await symlink(digest, join(releases, "current"));
  const launched = [];
  const run = (file, arguments_, options = {}) => {
    if (file === "systemd-run") { launched.push(arguments_); return { code: 0, stdout: "", stderr: "" }; }
    if (file === "systemctl") return { code: 3, stdout: "", stderr: "" };
    return new Promise((resolve) => execFile(file, arguments_, options, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));
  };
  const reconcile = (options = {}) => reconcileNodeRelease({ repository: checkout, spec: SPEC, home, run, ...options });
  return { root, commit, running, releases, launched, reconcile };
}

test("a branch at the running commit, or moved only in data, is converged", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.reconcile()).basis, "same-commit");
    await f.commit({ "app/data/state/episode.json": "{}\n" });
    const readout = await f.reconcile();
    assert.deepEqual([readout.state, readout.basis], ["converged", "no-released-change"]);
    assert.equal(f.launched.length, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("a released change settles, then launches one release of the branch from the running tool", async () => {
  const f = await fixture();
  try {
    const desired = await f.commit({ "app/server.mjs": "export default 2;\n" }, 10);
    assert.equal((await f.reconcile({ settleSeconds: 120 })).state, "settling");
    const readout = await f.reconcile({ settleSeconds: 0 });
    assert.equal(readout.state, "launched");
    assert.equal(readout.target, desired);
    const [arguments_] = f.launched;
    assert.ok(arguments_.includes("--unit=app-release"));
    assert.deepEqual(arguments_.slice(-6), ["--repository", join(f.root, "checkout"), "--spec-in-commit", SPEC, "--commit", desired]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("a held release lock reads as releasing, and a refused commit is not retried", async () => {
  const f = await fixture();
  try {
    const desired = await f.commit({ "app/server.mjs": "export default 2;\n" });
    await mkdir(join(f.releases, ".release.lock"));
    assert.equal((await f.reconcile()).state, "releasing");
    await rm(join(f.releases, ".release.lock"), { recursive: true });
    await mkdir(join(f.releases, "receipts"), { recursive: true });
    await writeFile(join(f.releases, "receipts", `2026-09-29T00-00-00.000Z-${desired}.refusal.json`), JSON.stringify({ reason: "health did not answer" }));
    const readout = await f.reconcile();
    assert.deepEqual([readout.state, readout.reason], ["refused", "health did not answer"]);
    assert.equal(f.launched.length, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("each pass leaves its reading as the release root's status", async () => {
  const f = await fixture();
  try {
    const readout = await f.reconcile();
    const { readFile } = await import("node:fs/promises");
    assert.deepEqual(JSON.parse(await readFile(join(f.releases, "status.json"), "utf8")), readout);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
