import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const serviceRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function execute(file, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, arguments_, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function git(repository, ...arguments_) {
  const result = await execute("git", arguments_, {
    cwd: repository,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "release-test@example.invalid",
      GIT_AUTHOR_NAME: "Release Test",
      GIT_COMMITTER_EMAIL: "release-test@example.invalid",
      GIT_COMMITTER_NAME: "Release Test",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function fixture(specification) {
  const root = await mkdtemp(join(tmpdir(), "release-git-commit-"));
  const home = join(root, "home");
  const repository = join(root, "repository");
  await mkdir(join(repository, "app"), { recursive: true });
  await mkdir(join(home, "bin"), { recursive: true });
  const curl = join(home, "bin", "curl");
  await writeFile(curl, "#!/bin/sh\ntest -f \"$HOME/healthy\"\n");
  await chmod(curl, 0o755);
  await cp(serviceRoot, join(repository, "release-service"), { recursive: true });
  await writeFile(join(repository, "app", "server.mjs"), "export default 'first';\n");
  await writeFile(join(repository, "release.json"), `${JSON.stringify(specification, null, 2)}\n`);
  await git(repository, "init", "--quiet");
  await git(repository, "add", ".");
  await git(repository, "commit", "--quiet", "-m", "first release");
  return { root, home, repository };
}

async function release({ home, repository }, onStep = () => {}) {
  const script = join(repository, "release-service", "scripts", "release-git-commit.mjs");
  const { releaseGitCommit } = await import(pathToFileURL(script));
  try {
    const receipt = await releaseGitCommit({
      specPath: join(repository, "release.json"),
      localHome: home,
      environment: { ...process.env, HOME: home, PATH: `${join(home, "bin")}:${process.env.PATH}` },
      onStep,
    });
    return { status: 0, receipt };
  } catch (error) {
    return { status: 1, error };
  }
}

const baseSpec = (health) => ({
  host: "local",
  releaseRoot: ".local/releases",
  receiptRoot: ".local/receipts",
  archives: [["."]],
  install: "mkdir -p node_modules && printf installed > node_modules/install-witness",
  restart: "test -L .local/releases/current && printf restarted >> restart-witness",
  health,
  healthAttempts: 1,
  healthIntervalSeconds: 0,
});

test("a local-host commit materializes, installs, promotes, restarts, and becomes healthy", async (context) => {
  const work = await fixture(baseSpec("http://127.0.0.1:18807/healthz"));
  try {
    await writeFile(join(work.home, "healthy"), "ready\n");
    const result = await release(work);
    assert.equal(result.status, 0, result.error?.stack);
    const { receipt } = result;
    assert.equal(await readlink(join(work.home, ".local", "releases", "current")), receipt.materialized.artifactDigest);
    assert.equal(await readFile(join(work.home, ".local", "releases", receipt.materialized.artifactDigest, "node_modules", "install-witness"), "utf8"), "installed");
    assert.equal(await readFile(join(work.home, "restart-witness"), "utf8"), "restarted");
    context.diagnostic(`dry materialize/promote: ${receipt.materialized.artifactDigest} -> current; install=installed; restart=restarted; health=200`);
  } finally {
    await rm(work.root, { recursive: true, force: true });
  }
});

test("a failed local install stops before promotion", async (context) => {
  const work = await fixture({ ...baseSpec("http://127.0.0.1:1/healthz"), host: undefined, install: "exit 23" });
  try {
    const result = await release(work);
    assert.notEqual(result.status, 0);
    await assert.rejects(readlink(join(work.home, ".local", "releases", "current")), { code: "ENOENT" });
    await assert.rejects(readFile(join(work.home, "restart-witness")), { code: "ENOENT" });
    context.diagnostic("dry failed install: exit=23; current=absent; restart=not-run");
  } finally {
    await rm(work.root, { recursive: true, force: true });
  }
});

test("a receipted pre-promotion refusal retires only its unreferenced attempt artifacts", async (context) => {
  const work = await fixture({
    ...baseSpec("http://127.0.0.1:1/healthz"),
    host: undefined,
    install: `printf '%s' "$PWD" > "$HOME/failed-release-path"; exit 23`,
  });
  try {
    const releases = join(work.home, ".local", "releases");
    const current = "a".repeat(64);
    const previous = "b".repeat(64);
    await mkdir(join(releases, current), { recursive: true });
    await mkdir(join(releases, previous), { recursive: true });
    await writeFile(join(releases, current, "sentinel"), "current\n");
    await writeFile(join(releases, previous, "sentinel"), "previous\n");
    const { symlink } = await import("node:fs/promises");
    await symlink(current, join(releases, "current"));
    await symlink(previous, join(releases, "previous"));

    const result = await release(work);
    assert.notEqual(result.status, 0);
    const failedRelease = (await readFile(join(work.home, "failed-release-path"), "utf8")).trim();
    const failedDigest = failedRelease.split("/").at(-1);
    assert.match(failedDigest, /^[0-9a-f]{64}$/u);
    await assert.rejects(readFile(join(failedRelease, "app", "server.mjs")), { code: "ENOENT" });
    assert.equal(await readlink(join(releases, "current")), current);
    assert.equal(await readlink(join(releases, "previous")), previous);
    await assert.rejects(readFile(join(releases, `.staging-${await git(work.repository, "rev-parse", "HEAD")}`, "app", "server.mjs")), { code: "ENOENT" });
    assert.equal(await readFile(join(releases, current, "sentinel"), "utf8"), "current\n");
    assert.equal(await readFile(join(releases, previous, "sentinel"), "utf8"), "previous\n");
    const refusal = (await (await import("node:fs/promises")).readdir(join(work.home, ".local", "receipts")))[0];
    assert.match(refusal, /\.refusal\.json$/u);
    assert.equal(JSON.parse(await readFile(join(work.home, ".local", "receipts", refusal), "utf8")).type, "NodeRuntimeReleaseRefusalReceipt");
    context.diagnostic(`terminal refusal is durable; removed stage and unreferenced digest ${failedDigest}; preserved current=${current} and previous=${previous}`);
  } finally {
    await rm(work.root, { recursive: true, force: true });
  }
});

test("a failed promotion attempt keeps its stage and materialized release for recovery", async () => {
  const work = await fixture({ ...baseSpec("http://127.0.0.1:1/healthz"), host: undefined });
  try {
    const promoter = join(work.repository, "release-service", "scripts", "promote-node-runtime-release.mjs");
    await writeFile(promoter, "process.exit(19);\n");
    await git(work.repository, "add", "release-service/scripts/promote-node-runtime-release.mjs");
    await git(work.repository, "commit", "--quiet", "-m", "fail before promotion pointer write");
    const result = await release(work);
    assert.notEqual(result.status, 0);
    const releases = join(work.home, ".local", "releases");
    const entries = await (await import("node:fs/promises")).readdir(releases);
    const digest = entries.find((entry) => /^[0-9a-f]{64}$/u.test(entry));
    assert.ok(digest, "uncertain promotion's materialized release is retained");
    await assert.rejects(readlink(join(releases, "current")), { code: "ENOENT" });
  } finally {
    await rm(work.root, { recursive: true, force: true });
  }
});

test("a failed health check rolls current back to the preceding digest", async (context) => {
  const work = await fixture(baseSpec("http://127.0.0.1:18807/healthz"));
  try {
    await writeFile(join(work.home, "healthy"), "ready\n");
    const firstResult = await release(work);
    assert.equal(firstResult.status, 0, firstResult.error?.stack);
    const first = firstResult.receipt.materialized.artifactDigest;
    await rm(join(work.home, "healthy"));

    await writeFile(join(work.repository, "app", "server.mjs"), "export default 'second';\n");
    await git(work.repository, "add", "app/server.mjs");
    await git(work.repository, "commit", "--quiet", "-m", "second release");
    const failed = await release(work);
    assert.notEqual(failed.status, 0);
    assert.match(failed.error.message, new RegExp(`rolled back to ${first}`, "u"));
    assert.equal(await readlink(join(work.home, ".local", "releases", "current")), first);
    const rejected = await readlink(join(work.home, ".local", "releases", "previous"));
    assert.notEqual(rejected, first);
    assert.equal(await readFile(join(work.home, "restart-witness"), "utf8"), "restartedrestartedrestarted");
    context.diagnostic(`dry rollback: rejected=${rejected}; current=${first}; previous=${rejected}; restarts=3`);
  } finally {
    await rm(work.root, { recursive: true, force: true });
  }
});

test("a rollback reinstalls the unit the replaced release ran under, even after the unit file moved", async () => {
  const work = await fixture({ ...baseSpec("http://127.0.0.1:18807/healthz"), unit: { file: "deploy/app.service", name: "app.service" } });
  try {
    const systemctl = join(work.home, "bin", "systemctl");
    await writeFile(systemctl, "#!/bin/sh\nprintf reload >> \"$HOME/reload-witness\"\n");
    await chmod(systemctl, 0o755);
    await mkdir(join(work.repository, "deploy"), { recursive: true });
    await writeFile(join(work.repository, "deploy", "app.service"), "first unit\n");
    await git(work.repository, "add", "deploy");
    await git(work.repository, "commit", "--quiet", "-m", "first unit");
    await writeFile(join(work.home, "healthy"), "ready\n");
    const firstResult = await release(work);
    assert.equal(firstResult.status, 0, firstResult.error?.stack);
    const installed = join(work.home, ".config", "systemd", "user", "app.service");
    assert.equal(await readFile(installed, "utf8"), "first unit\n");
    await rm(join(work.home, "healthy"));

    await mkdir(join(work.repository, "deploy", "moved"), { recursive: true });
    await git(work.repository, "mv", "deploy/app.service", "deploy/moved/app.service");
    await writeFile(join(work.repository, "deploy", "moved", "app.service"), "second unit\n");
    await writeFile(join(work.repository, "release.json"), `${JSON.stringify({ ...baseSpec("http://127.0.0.1:18807/healthz"), unit: { file: "deploy/moved/app.service", name: "app.service" } }, null, 2)}\n`);
    await git(work.repository, "add", ".");
    await git(work.repository, "commit", "--quiet", "-m", "second release moves its unit");
    const failed = await release(work);
    assert.notEqual(failed.status, 0);
    assert.match(failed.error.message, new RegExp(`rolled back to ${firstResult.receipt.materialized.artifactDigest}`, "u"));
    assert.equal(await readFile(installed, "utf8"), "first unit\n");
  } finally {
    await rm(work.root, { recursive: true, force: true });
  }
});

test("a hand-placed current is the rollback target when the new release does not come up", async () => {
  const work = await fixture(baseSpec("http://127.0.0.1:18807/healthz"));
  try {
    const releases = join(work.home, ".local", "releases");
    await mkdir(join(releases, "hand-placed"), { recursive: true });
    const { symlink } = await import("node:fs/promises");
    await symlink("hand-placed", join(releases, "current"));
    const failed = await release(work);
    assert.notEqual(failed.status, 0);
    assert.match(failed.error.message, /rolled back to hand-placed/u);
    assert.equal(await readlink(join(releases, "current")), "hand-placed");
  } finally {
    await rm(work.root, { recursive: true, force: true });
  }
});

test("a release whose unit file is absent stops before promotion", async () => {
  const work = await fixture({ ...baseSpec("http://127.0.0.1:18807/healthz"), unit: { file: "deploy/absent.service", name: "app.service" } });
  try {
    await writeFile(join(work.home, "healthy"), "ready\n");
    const result = await release(work);
    assert.notEqual(result.status, 0);
    await assert.rejects(readlink(join(work.home, ".local", "releases", "current")), { code: "ENOENT" });
    await assert.rejects(readFile(join(work.home, "restart-witness")), { code: "ENOENT" });
  } finally {
    await rm(work.root, { recursive: true, force: true });
  }
});


test("state custody is snapshotted before promotion and a failed snapshot resumes the old release", async () => {
  const unit = { file: "deploy/app.service", name: "app.service" };
  const spec = { ...baseSpec("http://127.0.0.1:18807/healthz"), unit, restart: "systemctl --user restart app.service" };
  const work = await fixture(spec);
  try {
    await mkdir(join(work.repository, "deploy"), { recursive: true });
    await writeFile(join(work.repository, unit.file), "fixture unit\n");
    await git(work.repository, "add", "deploy");
    await git(work.repository, "commit", "--quiet", "-m", "managed fixture unit");
    await writeFile(join(work.home, "healthy"), "ready\n");
    const systemctl = join(work.home, "bin", "systemctl");
    await writeFile(systemctl, `#!/bin/sh
case "$2" in
  stop)
    readlink "$HOME/.local/releases/current" > "$HOME/stopped-pointer"
    printf 'drained\\n' >> "$HOME/state/journal"
    touch "$HOME/stopped"
    ;;
  show)
    test -f "$HOME/stopped" || exit 1
    case "$4" in
      --property=ActiveState) printf 'inactive\\n';;
      --property=MainPID) printf '0\\n';;
    esac
    ;;
  restart) rm -f "$HOME/stopped";;
esac
`);
    await chmod(systemctl, 0o755);
    const tar = join(work.home, "bin", "tar");
    await writeFile(tar, `#!/bin/sh
if [ "$1" = "-czf" ]; then
  test -f "$HOME/stopped" || exit 71
  test "$(readlink "$HOME/.local/releases/current")" = "$(cat "$HOME/stopped-pointer")" || exit 72
fi
exec /usr/bin/tar "$@"
`);
    await chmod(tar, 0o755);
    const first = await release(work);
    assert.equal(first.status, 0, first.error?.stack);

    await mkdir(join(work.home, "state"));
    await writeFile(join(work.home, "state", "journal"), "retained\n");
    const backup = { state: "state", root: "backups", keep: 2 };
    await writeFile(join(work.repository, "release.json"), JSON.stringify({ ...spec, backup }));
    await writeFile(join(work.repository, "app", "server.mjs"), "export default 'second';\n");
    await git(work.repository, "add", ".");
    await git(work.repository, "commit", "--quiet", "-m", "second release with state custody");
    const second = await release(work);
    assert.equal(second.status, 0, second.error?.stack);
    assert.notEqual(second.receipt.materialized.artifactDigest, first.receipt.materialized.artifactDigest);
    assert.equal((await readFile(join(work.home, "stopped-pointer"), "utf8")).trim(), first.receipt.materialized.artifactDigest);
    const { readdir } = await import("node:fs/promises");
    const archives = await readdir(join(work.home, "backups"));
    assert.equal(archives.length, 1);
    const retained = await execute("/usr/bin/tar", ["-xOzf", join(work.home, "backups", archives[0]), "./journal"]);
    assert.equal(retained.status, 0, retained.stderr);
    assert.equal(retained.stdout, "retained\ndrained\n");
    await assert.rejects(readFile(join(work.home, "stopped")), { code: "ENOENT" });

    await writeFile(join(work.repository, "release.json"), JSON.stringify({ ...spec, backup: { ...backup, state: "absent-state" } }));
    await git(work.repository, "add", "release.json");
    await git(work.repository, "commit", "--quiet", "-m", "fixture snapshot failure");
    const refused = await release(work);
    assert.equal(refused.status, 1);
    assert.match(refused.error.message, /retained .* and resumed its service, which is healthy/u);
    assert.equal(await readlink(join(work.home, ".local", "releases", "current")), second.receipt.materialized.artifactDigest);
    assert.deepEqual(await readdir(join(work.home, "backups")), archives);
    await assert.rejects(readFile(join(work.home, "stopped")), { code: "ENOENT" });
  } finally {
    await rm(work.root, { recursive: true, force: true });
  }
});

test("a failed restart rolls current back like a failed health check", async () => {
  const work = await fixture(baseSpec("http://127.0.0.1:18807/healthz"));
  try {
    await writeFile(join(work.home, "healthy"), "ready\n");
    const firstResult = await release(work);
    assert.equal(firstResult.status, 0, firstResult.error?.stack);
    const first = firstResult.receipt.materialized.artifactDigest;
    await writeFile(join(work.repository, "release.json"), `${JSON.stringify({ ...baseSpec("http://127.0.0.1:18807/healthz"), restart: "test \"$(readlink .local/releases/current)\" = " + first }, null, 2)}\n`);
    await git(work.repository, "add", "release.json");
    await git(work.repository, "commit", "--quiet", "-m", "second release cannot restart");
    const failed = await release(work);
    assert.notEqual(failed.status, 0);
    assert.match(failed.error.message, new RegExp(`rolled back to ${first}, which is healthy`, "u"));
    assert.equal(await readlink(join(work.home, ".local", "releases", "current")), first);
  } finally {
    await rm(work.root, { recursive: true, force: true });
  }
});


test("target-host release lease serializes concurrent materialization and stays reusable", async () => {
  const work = await fixture({ ...baseSpec(), install: 'mkdir "$HOME/install-active" && sleep 0.3 && rmdir "$HOME/install-active"' });
  try {
    let started;
    const firstStarted = new Promise((resolve) => { started = resolve; });
    const first = release(work, (message) => { if (message.startsWith("release ")) started(); });
    await firstStarted;
    const secondStarted = Date.now();
    const second = release(work);
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.map((result) => result.status), [0, 0], results.map((result) => result.error?.stack).join("\n"));
    assert.ok(Date.now() - secondStarted >= 300, "second release bypassed the live holder");
    const lease = join(work.home, ".local/releases/.release.lock/lease");
    assert.equal(await readFile(lease, "utf8"), "");
    assert.equal((await release(work)).status, 0, "released kernel lease was not reusable");
  } finally { await rm(work.root, { recursive: true, force: true }); }
});

test("an aged legacy release holder is refused rather than stolen", async () => {
  const work = await fixture({ ...baseSpec(), lockTimeoutSeconds: 0 });
  try {
    const lock = join(work.home, ".local/releases/.release.lock");
    await mkdir(lock, { recursive: true });
    const holder = JSON.stringify({ pid: 99999999, startedAt: "2000-01-01T00:00:00Z" });
    await writeFile(join(lock, "holder.json"), holder);
    await utimes(lock, 0, 0);
    const result = await release(work);
    assert.equal(result.status, 1);
    assert.match(result.error.message, /release lock.*not acquired/);
    assert.equal(await readFile(join(lock, "holder.json"), "utf8"), holder);
  } finally { await rm(work.root, { recursive: true, force: true }); }
});

test("a waiting release has a bounded refusal and the holder still completes", async () => {
  const work = await fixture({ ...baseSpec(), lockTimeoutSeconds: 0, install: "sleep 0.3" });
  try {
    let started;
    const firstStarted = new Promise((resolve) => { started = resolve; });
    const first = release(work, (message) => { if (message.startsWith("release ")) started(); });
    await firstStarted;
    const second = await release(work);
    assert.equal(second.status, 1);
    assert.match(second.error.message, /waited at most 0 seconds/);
    assert.equal((await first).status, 0);
    assert.equal((await release(work)).status, 0);
  } finally { await rm(work.root, { recursive: true, force: true }); }
});

test("a second commit is staged from the running release, named by its git identity, and a repeat of its blobs is reused", async () => {
  const work = await fixture({ ...baseSpec("http://127.0.0.1:18807/healthz"), repository: "test/repository" });
  try {
    await writeFile(join(work.home, "healthy"), "ready\n");
    const steps = [];
    const firstResult = await release(work, (line) => steps.push(line));
    assert.equal(firstResult.status, 0, firstResult.error?.stack);
    assert.ok(steps.some((line) => line.startsWith("archive took")), "no running release: the whole commit is archived");
    const first = firstResult.receipt.materialized;
    assert.equal(first.identityVersion, 1);

    await writeFile(join(work.repository, "app", "server.mjs"), "export default 'second';\n");
    await writeFile(join(work.repository, "app", "added.mjs"), "export default 'added';\n");
    await git(work.repository, "add", ".");
    await git(work.repository, "commit", "--quiet", "-m", "second release");
    steps.length = 0;
    const secondResult = await release(work, (line) => steps.push(line));
    assert.equal(secondResult.status, 0, secondResult.error?.stack);
    assert.ok(steps.some((line) => /^staged from [0-9a-f]{40}: 2 written, 0 removed/u.test(line)), steps.join("\n"));
    assert.ok(!steps.some((line) => line.startsWith("archive took")));
    const second = secondResult.receipt.materialized;
    assert.notEqual(second.artifactDigest, first.artifactDigest);
    const live = join(work.home, ".local", "releases", second.artifactDigest);
    assert.equal(await readFile(join(live, "app", "server.mjs"), "utf8"), "export default 'second';\n");
    assert.equal(await readFile(join(live, "node_modules", "install-witness"), "utf8"), "installed");
    assert.equal(await readFile(join(work.home, ".local", "releases", first.artifactDigest, "app", "server.mjs"), "utf8"), "export default 'first';\n", "the previous release is untouched");
    assert.equal(await readlink(join(work.home, ".local", "releases", "previous")), first.artifactDigest);

    // Another commit holding the very same blobs is the release already running.
    await git(work.repository, "commit", "--quiet", "--allow-empty", "-m", "no change in the archive");
    steps.length = 0;
    const third = await release(work, (line) => steps.push(line));
    assert.equal(third.status, 0, third.error?.stack);
    assert.equal(third.receipt.unchanged, true, steps.join("\n"));
  } finally {
    await rm(work.root, { recursive: true, force: true });
  }
});

test("a second commit with the same install key carries node_modules alongside the stage, and survives the running release's removal", async () => {
  const work = await fixture({ ...baseSpec("http://127.0.0.1:18807/healthz"), repository: "test/repository", install: undefined, dependencies: "pnpm install" });
  try {
    await writeFile(join(work.home, "healthy"), "ready\n");
    const pnpm = join(work.home, "bin", "pnpm");
    await writeFile(pnpm, '#!/bin/sh\ncase "$1" in --version) echo 9.0.0;; install) mkdir -p node_modules/.pnpm/dep && printf installed > node_modules/.pnpm/dep/witness;; esac\n');
    await chmod(pnpm, 0o755);
    await writeFile(join(work.repository, "package.json"), '{"name":"root"}\n');
    await git(work.repository, "add", ".");
    await git(work.repository, "commit", "--quiet", "-m", "package");
    const steps = [];
    const firstResult = await release(work, (line) => steps.push(line));
    assert.equal(firstResult.status, 0, firstResult.error?.stack);
    assert.ok(steps.some((line) => line.startsWith("install took")), "the first release installs");
    await writeFile(join(work.repository, "app", "server.mjs"), "export default 'second';\n");
    await git(work.repository, "add", ".");
    await git(work.repository, "commit", "--quiet", "-m", "second release");
    steps.length = 0;
    const secondResult = await release(work, (line) => steps.push(line));
    assert.equal(secondResult.status, 0, secondResult.error?.stack);
    assert.ok(steps.some((line) => /alongside the stage\), adopted 1/u.test(line)), steps.join("\n"));
    assert.ok(!steps.some((line) => line.startsWith("install took")), "the install is not run again");
    const releases = join(work.home, ".local", "releases");
    const first = firstResult.receipt.materialized.artifactDigest;
    const second = secondResult.receipt.materialized.artifactDigest;
    // Retention: the previous release is pruned, and the new one stands whole.
    await rm(join(releases, first), { recursive: true, force: true });
    assert.equal(await readFile(join(releases, second, "node_modules/.pnpm/dep/witness"), "utf8"), "installed");
    assert.equal(await readFile(join(releases, second, "app/server.mjs"), "utf8"), "export default 'second';\n");
    assert.deepEqual((await readdir(releases)).filter((name) => name.startsWith(".dependencies-")), [], "no side directory is left");
  } finally {
    await rm(work.root, { recursive: true, force: true });
  }
});

test('independent runtime source survives three unrelated platform promotions', async () => {
  const work = await fixture({ ...baseSpec('http://127.0.0.1:18807/healthz'), runtimes: [{ name: 'game.service', file: 'game.service', project: 'app', health: 'http://127.0.0.1:18807/healthz' }] });
  try {
    await writeFile(join(work.home, 'healthy'), 'ready');
    await writeFile(join(work.home, 'bin/systemctl'), '#!/bin/sh\nif [ "$2" = is-active ]; then echo active; fi\n');
    await chmod(join(work.home, 'bin/systemctl'), 0o755);
    await writeFile(join(work.repository, 'app/package.json'), '{"name":"game","type":"module"}');
    await writeFile(join(work.repository, 'game.service'), '[Service]\nWorkingDirectory=%h/.local/releases/runtimes/game.service/app\n');
    await git(work.repository, 'add', '.'); await git(work.repository, 'commit', '--quiet', '-m', 'independent game receiving');
    const first = await release(work);
    assert.equal(first.status, 0, first.error?.stack);
    const digest = first.receipt.materialized.artifactDigest;
    for (const publication of ['one', 'two', 'three']) {
      await writeFile(join(work.repository, 'publication.txt'), publication);
      await git(work.repository, 'add', '.'); await git(work.repository, 'commit', '--quiet', '-m', publication);
      const received = await release(work);
      assert.equal(received.status, 0, received.error?.stack);
    }
    const root = join(work.home, '.local/releases');
    assert.equal(await readlink(join(root, 'runtimes/game.service')), '../' + digest);
    assert.notEqual(await readlink(join(root, 'current')), digest);
    assert.notEqual(await readlink(join(root, 'previous')), digest);
    assert.equal(await readFile(join(root, 'runtimes/game.service/app/server.mjs'), 'utf8'), "export default 'first';\n");
    assert.ok((await stat(join(root, digest))).isDirectory());
  } finally { await rm(work.root, { recursive: true, force: true }); }
});
