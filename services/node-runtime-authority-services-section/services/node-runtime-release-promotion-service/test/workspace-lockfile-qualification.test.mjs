import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { frozenWorkspaceLockfileArguments, planWorkspaceLockfile, qualifyWorkspaceLockfile } from "../src/workspace-lockfile.mjs";

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=qualification", "-c", "user.email=qualification@example.invalid", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "workspace-qualification-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository"), stateDirectory = join(root, "state"), tool = join(root, "resolver.mjs");
  mkdirSync(repository);
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "qualification"); git(repository, "config", "user.email", "qualification@example.invalid");
  mkdirSync(join(repository, "packages", "library"), { recursive: true });
  writeFileSync(join(repository, "package.json"), JSON.stringify({ name: "root", private: true }));
  writeFileSync(join(repository, "packages/library/package.json"), JSON.stringify({ name: "library", dependencies: { added: "1.0.0" } }));
  writeFileSync(join(repository, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeFileSync(join(repository, "pnpm-lock.yaml"), "old lock\n");
  writeFileSync(join(repository, "not-a-manifest.mjs"), "throw new Error('source bodies are never executed');\n");
  git(repository, "add", "."); git(repository, "commit", "-qm", "source");
  const commit = git(repository, "rev-parse", "HEAD");
  writeFileSync(tool, `import {appendFileSync, readFileSync, writeFileSync, existsSync, symlinkSync, unlinkSync, mkdirSync} from 'node:fs';
const frozen=process.argv.includes('--frozen-lockfile');
appendFileSync(process.env.CALLS, (frozen?'receive':'derive')+'\\n');
const manifest=readFileSync('packages/library/package.json');
if(existsSync('not-a-manifest.mjs')) throw new Error('source body leaked');
if(frozen && existsSync('extra/package.json')) throw new Error('resolver contamination reached receiver');
if(frozen && process.env.PAUSE) { writeFileSync(process.env.PAUSE,'ready'); await new Promise(resolve => setTimeout(resolve,1000)); }
if(!frozen && process.env.EXTRA === '1') { mkdirSync('extra'); writeFileSync('extra/package.json','{}'); }
if(process.env.MUTATE === (frozen?'receive':'derive')) writeFileSync('package.json','{}');
if(process.env.REDIRECT === '1' && frozen) { unlinkSync('pnpm-lock.yaml');symlinkSync(process.env.OUTSIDE,'pnpm-lock.yaml'); }
if(process.env.REFUSE === (frozen?'receive':'derive')) process.exit(7);
if(frozen) { if(!readFileSync('pnpm-lock.yaml').equals(manifest)) process.exit(9); if(process.env.MUTATE_LOCK==='1') writeFileSync('pnpm-lock.yaml','different'); }
else writeFileSync('pnpm-lock.yaml',manifest);
`);
  const calls = join(root, "calls");
  const command = `${quote(process.execPath)} ${quote(tool)}`;
  return { root, repository, commit, stateDirectory, calls, command, request: { repository, commit, stateDirectory,
    derive: `${command} --lockfile-only --ignore-scripts`, install: `${command} --frozen-lockfile --ignore-scripts`, environment: { ...process.env, CALLS: calls } } };
}

test("plan is commit-bound, deterministic and leaves checkout/index unchanged without tooling", t => {
  const f = fixture(t), before = git(f.repository, "status", "--porcelain=v1");
  const a = planWorkspaceLockfile(f.request), b = planWorkspaceLockfile(f.request);
  assert.deepEqual(a, b);
  assert.deepEqual(a.inputs.map(row => row.path), ["package.json", "packages/library/package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);
  assert.equal(existsSync(f.stateDirectory), false);
  assert.equal(existsSync(f.calls), false);
  for (const arg of ["--", "--dir=/outside", "-C", "--lockfile-dir=/outside", "--config.lockfile-dir=/outside", "--workspace-root"])
    assert.throws(() => frozenWorkspaceLockfileArguments(`pnpm install --frozen-lockfile ${arg}`), /cannot replace the projected/u);
  assert.equal(git(f.repository, "status", "--porcelain=v1"), before);
  writeFileSync(join(f.repository, "package.json"), "{\"dirty\":true}");
  assert.deepEqual(planWorkspaceLockfile(f.request).inputs, a.inputs, "working files cannot replace committed demands");
});

test("derive and frozen receive execute against the same immutable manifest projection", async t => {
  const f = fixture(t);
  const result = await qualifyWorkspaceLockfile(f.request);
  assert.equal(result.received, true); assert.equal(result.changed, true); assert.equal(result.resumed, false);
  assert.deepEqual(result.lockfile, readFileSync(join(f.repository, "packages/library/package.json")));
  assert.equal(readFileSync(f.calls, "utf8"), "derive\nreceive\n");
  assert.equal(readFileSync(join(f.repository, "pnpm-lock.yaml"), "utf8"), "old lock\n");
  assert.equal(git(f.repository, "status", "--porcelain=v1"), "");
});

test("failed receiving retains only a candidate, and resumption always rechecks it", async t => {
  const f = fixture(t);
  await assert.rejects(qualifyWorkspaceLockfile({ ...f.request, environment: { ...f.request.environment, REFUSE: "receive" } }), /failed frozen receiving/u);
  const result = await qualifyWorkspaceLockfile(f.request);
  assert.equal(result.resumed, true); assert.equal(result.received, true);
  assert.equal(readFileSync(f.calls, "utf8"), "derive\nreceive\nreceive\n");
  await assert.rejects(qualifyWorkspaceLockfile({ ...f.request, environment: { ...f.request.environment, REFUSE: "receive" } }), /failed frozen receiving/u);
});

test("source or derived-lock mutation cannot become a received result", async t => {
  for (const change of [{ MUTATE: "derive" }, { MUTATE: "receive" }, { MUTATE_LOCK: "1" }]) {
    const f = fixture(t);
    await assert.rejects(qualifyWorkspaceLockfile({ ...f.request, environment: { ...f.request.environment, ...change } }), /input changed/u);
  }
});

test("failed derivation cannot be resumed as success", async t => {
  const f = fixture(t);
  await assert.rejects(qualifyWorkspaceLockfile({ ...f.request, environment: { ...f.request.environment, REFUSE: "derive" } }), /derivation refused/u);
  const result = await qualifyWorkspaceLockfile(f.request);
  assert.equal(result.resumed, false);
  assert.equal(readFileSync(f.calls, "utf8"), "derive\nderive\nreceive\n");
});

test("retained bytes, source inputs and commands cannot substitute one another", async t => {
  const f = fixture(t), first = await qualifyWorkspaceLockfile(f.request);
  const other = await qualifyWorkspaceLockfile({ ...f.request, derive: f.request.derive + " --different" });
  assert.equal(other.resumed, false); assert.notEqual(other.artifact, first.artifact);
  const retained = join(first.artifact, "derived-lock.json"); const record = JSON.parse(readFileSync(retained)); record.lockfile = Buffer.from("tampered").toString("base64"); writeFileSync(retained, JSON.stringify(record));
  await assert.rejects(qualifyWorkspaceLockfile(f.request), /retained workspace derivation bytes differ/u);
});

test("refuses absent or ambiguous frozen release contract before executing", async t => {
  const f = fixture(t);
  for (const install of [undefined, "pnpm install", "pnpm --frozen-lockfile && pnpm --frozen-lockfile", "pnpm --frozen-lockfile=false"])
    await assert.rejects(qualifyWorkspaceLockfile({ ...f.request, install }), /requires one release frozen|simple package-manager|unsupported shell/u);
  assert.equal(existsSync(f.calls), false);
  assert.deepEqual(frozenWorkspaceLockfileArguments("pnpm install --frozen-lockfile"), ["pnpm", "install", "--frozen-lockfile", "--frozen-lockfile", "--lockfile-only", "--ignore-scripts"]);
  for (const command of ["pnpm install --frozen-lockfile; echo done", "false --frozen-lockfile || true", "pnpm install --frozen-lockfile && true", 'pnpm "a && b" --frozen-lockfile']) {
    if (command.includes('"')) assert.deepEqual(frozenWorkspaceLockfileArguments(command).slice(0, 3), ["pnpm", "a && b", "--frozen-lockfile"]);
    else assert.throws(() => frozenWorkspaceLockfileArguments(command), /unsupported shell|require whitespace/u);
  }
});

test("refuses redirected state, input and output carriers", async t => {
  const f = fixture(t), target = join(f.root, "other"); mkdirSync(target);
  symlinkSync(target, f.stateDirectory);
  await assert.rejects(qualifyWorkspaceLockfile(f.request), /state is redirected/u);
  rmSync(f.stateDirectory);
  const outside = join(f.root, "outside-lock"); writeFileSync(outside, readFileSync(join(f.repository, "packages/library/package.json")));
  await assert.rejects(qualifyWorkspaceLockfile({ ...f.request, environment: { ...f.request.environment, REDIRECT: "1", OUTSIDE: outside } }), /input was redirected/u);
});

test("a live kernel lease blocks competing work and its release permits resumption", async t => {
  const f = fixture(t), first = await qualifyWorkspaceLockfile(f.request);
  const child = spawn("flock", ["--exclusive", join(first.artifact, "qualification.lease"), process.execPath, "-e", "process.stdout.write('held\\n');process.stdin.resume();"], { stdio: ["pipe", "pipe", "pipe"] });
  const exit = new Promise(resolve => child.once("close", resolve));
  await new Promise(resolve => child.stdout.once("data", resolve));
  await assert.rejects(qualifyWorkspaceLockfile(f.request), error => error.interrupted === true && /lease is busy/u.test(error.message));
  child.stdin.end(); await exit;
  const next = await qualifyWorkspaceLockfile(f.request);
  assert.equal(next.resumed, true);
  assert.equal(readFileSync(f.calls, "utf8"), "derive\nreceive\nreceive\n");
});

test("no-state qualification leaves no retained candidate and returns the actual bytes", async t => {
  const f = fixture(t);
  const result = await qualifyWorkspaceLockfile({ ...f.request, stateDirectory: undefined });
  assert.equal(result.received, true); assert.equal(result.artifact, undefined);
  assert.equal(existsSync(f.stateDirectory), false);
});

test("receiving reconstructs source and cannot consume resolver-created workspace inputs", async t => {
  const f = fixture(t);
  const result = await qualifyWorkspaceLockfile({ ...f.request, environment: { ...f.request.environment, EXTRA: "1" } });
  assert.equal(result.received, true);
  assert.equal((await qualifyWorkspaceLockfile(f.request)).resumed, true);
});

test("explicit rederivation and changed actual tool bytes recover retained candidates", async t => {
  const f = fixture(t), first = await qualifyWorkspaceLockfile(f.request);
  const retry = await qualifyWorkspaceLockfile({ ...f.request, rederive: true });
  assert.equal(retry.resumed, false); assert.equal(retry.artifact, first.artifact);
  const script = join(f.root, "resolver.mjs"); writeFileSync(script, readFileSync(script, "utf8") + "\n// repaired resolver\n");
  const repaired = await qualifyWorkspaceLockfile(f.request);
  assert.equal(repaired.resumed, false); assert.notEqual(repaired.artifact, first.artifact);
});

test("absolute missing tools are interruption rather than source refusal", async t => {
  const f = fixture(t);
  await assert.rejects(qualifyWorkspaceLockfile({ ...f.request, derive: "/missing/pnpm install --lockfile-only" }), error => error.interrupted === true);
  assert.equal(existsSync(f.calls), false);
});

test("SIGKILL releases the kernel lease and resumes atomically retained derivation", async t => {
  const f = fixture(t), ready = join(f.root, "ready"), worker = join(f.root, "worker.mjs");
  const module = new URL("../src/workspace-lockfile.mjs", import.meta.url).href;
  writeFileSync(worker, `import {qualifyWorkspaceLockfile} from ${JSON.stringify(module)}; await qualifyWorkspaceLockfile(${JSON.stringify({ ...f.request, environment: { ...f.request.environment, PAUSE: ready } })});`);
  const child = spawn(process.execPath, [worker], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const deadline = Date.now() + 10000;
  while (!existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(existsSync(ready), true);
  child.kill("SIGKILL");
  assert.equal((await exited).signal, "SIGKILL");
  // The invocation child finishes its bounded fixture work before the retry.
  await new Promise(resolve => setTimeout(resolve, 1100));
  const result = await qualifyWorkspaceLockfile(f.request);
  assert.equal(result.resumed, true); assert.equal(result.received, true);
  assert.equal(readFileSync(f.calls, "utf8"), "derive\nreceive\nreceive\n");
});

test("plans nested sources at recorded Gitlinks, never their changed checkout", t => {
  const f = fixture(t), child = join(f.root, "child"); mkdirSync(child);
  git(child, "init", "-q"); writeFileSync(join(child, "package.json"), '{"name":"mounted"}');
  git(child, "add", "."); git(child, "commit", "-qm", "mount");
  const original = git(child, "rev-parse", "HEAD:package.json");
  git(f.repository, "-c", "protocol.file.allow=always", "submodule", "add", "-q", child, "mounted");
  git(f.repository, "commit", "-qm", "selected source");
  const commit = git(f.repository, "rev-parse", "HEAD");
  writeFileSync(join(f.repository, "mounted/package.json"), '{"name":"unreceived"}');
  const plan = planWorkspaceLockfile({ repository: f.repository, commit });
  assert.equal(plan.inputs.find(row => row.path === "mounted/package.json").object, original);
  rmSync(join(f.repository, ".git/modules/mounted"), { recursive: true });
  assert.throws(() => planWorkspaceLockfile({ repository: f.repository, commit }), /source is not locally available/u);
});

test("manifest-only qualification refuses omitted hooks and symbolic source inputs", t => {
  const f = fixture(t);
  writeFileSync(join(f.repository, ".pnpmfile.cjs"), "module.exports={};");
  git(f.repository, "add", "."); git(f.repository, "commit", "-qm", "hook");
  assert.throws(() => planWorkspaceLockfile({ repository: f.repository }), /cannot omit source hook/u);
  git(f.repository, "rm", ".pnpmfile.cjs");
  rmSync(join(f.repository, "packages/library/package.json"));
  symlinkSync("../../package.json", join(f.repository, "packages/library/package.json"));
  git(f.repository, "add", "."); git(f.repository, "commit", "-qm", "redirected manifest");
  assert.throws(() => planWorkspaceLockfile({ repository: f.repository }), /not a regular source file/u);
});

test("actual integration writes received lock bytes, and refuses before creating source on failure", async t => {
  const { deriveIntegration } = await import("../src/integrate.mjs");
  const f = fixture(t);
  // The actual receiver API inherits the process environment, like its queue.
  const previous = process.env.CALLS; process.env.CALLS = f.calls;
  t.after(() => { if (previous === undefined) delete process.env.CALLS; else process.env.CALLS = previous; });
  const lockfile = { derive: f.request.derive, install: f.request.install, stateDirectory: f.stateDirectory };
  const result = await deriveIntegration({ repository: f.repository, base: f.commit, head: f.commit, lockfile });
  assert.deepEqual(result.derived, ["pnpm-lock.yaml"]);
  assert.equal(git(f.repository, "show", `${result.commit}:pnpm-lock.yaml`), readFileSync(join(f.repository, "packages/library/package.json"), "utf8"));
  assert.equal(git(f.repository, "rev-parse", "HEAD"), f.commit, "source refs do not move during proposal");
  const objects = git(f.repository, "count-objects", "-v");
  const previousRefuse = process.env.REFUSE; process.env.REFUSE = "receive";
  try { await assert.rejects(deriveIntegration({ repository: f.repository, base: f.commit, head: f.commit, lockfile }), /failed frozen receiving/u); }
  finally { if (previousRefuse === undefined) delete process.env.REFUSE; else process.env.REFUSE = previousRefuse; }
  assert.equal(git(f.repository, "count-objects", "-v"), objects, "refusal does not create a derived source object");
  assert.equal(git(f.repository, "rev-parse", "HEAD"), f.commit);
});

test("unchanged integration lock is still freshly received", async t => {
  const { deriveIntegration } = await import("../src/integrate.mjs");
  const f = fixture(t), previous = process.env.CALLS; process.env.CALLS = f.calls;
  t.after(() => { if (previous === undefined) delete process.env.CALLS; else process.env.CALLS = previous; });
  writeFileSync(join(f.repository, "pnpm-lock.yaml"), readFileSync(join(f.repository, "packages/library/package.json")));
  git(f.repository, "add", "."); git(f.repository, "commit", "-qm", "already resolved");
  const head = git(f.repository, "rev-parse", "HEAD");
  const result = await deriveIntegration({ repository: f.repository, base: head, head,
    lockfile: { derive: f.request.derive, install: f.request.install, stateDirectory: f.stateDirectory } });
  assert.deepEqual(result, { commit: head, derived: [] });
  assert.equal(readFileSync(f.calls, "utf8"), "derive\nreceive\n");
});
