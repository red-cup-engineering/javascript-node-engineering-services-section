import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readlinkSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { releaseDigest } from "../src/release-digest.mjs";
import { verifyReleaseDrift } from "../src/release-drift.mjs";
import { materializeNodeRuntimeRelease } from "../src/materialize-release.mjs";
import { IDENTITY_VERSION, releaseIdentity, stageFromPrevious } from "../src/release-source.mjs";
import { carryFiles } from "../src/tree-carry.mjs";

const git = (cwd, ...arguments_) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", ...arguments_], { cwd, encoding: "utf8" }).trim();
const ARCHIVES = [[".", ":(exclude,glob)**/data/state/**"]];
const DERIVED = ["gen/descriptors.mjs"];

async function put(repository, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(repository, path)), { recursive: true });
    if (content === null) await rm(join(repository, path), { force: true });
    else await writeFile(join(repository, path), content);
  }
  git(repository, "add", "-A");
  git(repository, "commit", "--quiet", "--allow-empty", "-m", "change");
  return git(repository, "rev-parse", "HEAD");
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "release-source-"));
  const repository = join(root, "repository");
  await mkdir(repository);
  git(repository, "init", "--quiet");
  const first = await put(repository, {
    "app/server.mjs": "export default 1;\n",
    "app/keep.mjs": "export default 'keep';\n",
    "app/doomed/gone.mjs": "export default 'gone';\n",
    "app/run.sh": "#!/bin/sh\n",
    "gen/descriptors.mjs": "export default 'committed';\n",
    "data/state/ledger.json": "{}\n",
  });
  execFileSync("chmod", ["+x", join(repository, "app/run.sh")]);
  git(repository, "add", "-A");
  git(repository, "commit", "--quiet", "--amend", "-m", "first");
  await mkdir(join(root, "releases"));
  return { root, repository, first: git(repository, "rev-parse", "HEAD"), releases: join(root, "releases") };
}

const archive = (repository, commit, stage) => {
  execFileSync("sh", ["-c", `mkdir -p '${stage}' && git archive --format=tar ${commit} -- . ':(exclude,glob)**/data/state/**' | tar -x -C '${stage}'`], { cwd: repository });
};

test("the identity is stable, follows tracked files under the pathspecs, and ignores derived and excluded paths", async () => {
  const f = await fixture();
  try {
    const identity = (commit, derived = DERIVED) => releaseIdentity({ repository: f.repository, commit, archives: ARCHIVES, derived });
    const base = identity(f.first);
    assert.equal(base.version, IDENTITY_VERSION);
    assert.match(base.digest, /^[0-9a-f]{64}$/u);
    assert.equal(identity(f.first).digest, base.digest);
    const derivedOnly = await put(f.repository, { "gen/descriptors.mjs": "export default 'regenerated';\n" });
    assert.equal(identity(derivedOnly).digest, base.digest, "a derived file's bytes are not identity");
    const excluded = await put(f.repository, { "data/state/ledger.json": '{"n":1}\n' });
    assert.equal(identity(excluded).digest, base.digest, "a path the pathspecs exclude is not identity");
    const unrelatedCommit = await put(f.repository, {});
    void unrelatedCommit;
    const changed = await put(f.repository, { "app/keep.mjs": "export default 'changed';\n" });
    assert.notEqual(identity(changed).digest, base.digest, "a tracked file under the pathspecs is identity");
    assert.notEqual(identity(changed, []).digest, identity(changed).digest, "which paths are derived is identity");
    const reverted = await put(f.repository, { "app/keep.mjs": "export default 'keep';\n" });
    assert.equal(identity(reverted).digest, base.digest, "the same blobs are the same release, whichever commit holds them");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("a release staged from the running one equals a full archive of the same commit, and never writes through a shared file", async () => {
  const f = await fixture();
  try {
    const identityOf = (commit) => releaseIdentity({ repository: f.repository, commit, archives: ARCHIVES, derived: DERIVED });
    // The running release, from a full archive.
    archive(f.repository, f.first, join(f.root, "stage-1"));
    const firstIdentity = identityOf(f.first);
    const running = await materializeNodeRuntimeRelease({ stagedRoot: join(f.root, "stage-1"), releaseRoot: f.releases, derived: DERIVED, identity: firstIdentity, source: { repository: "r", commit: f.first, archives: ARCHIVES } });
    assert.equal(running.artifactDigest, firstIdentity.digest);
    assert.equal(running.identityVersion, IDENTITY_VERSION);
    // A node_modules the install made, which the next release must not inherit by link.
    await mkdir(join(running.release, "node_modules/dep"), { recursive: true });
    await writeFile(join(running.release, "node_modules/dep/index.js"), "dep\n");
    execFileSync("sh", ["-c", `find "${running.release}" -name node_modules -prune -o -type f -exec chmod a-w {} +`]);

    const second = await put(f.repository, {
      "app/server.mjs": "export default 2;\n",
      "app/added/new.mjs": "export default 'new';\n",
      "app/doomed/gone.mjs": null,
      "gen/descriptors.mjs": "export default 'regenerated';\n",
      "data/state/ledger.json": '{"n":2}\n',
    });
    const before = { server: await readFile(join(running.release, "app/server.mjs"), "utf8"), keepInode: (await stat(join(running.release, "app/keep.mjs"))).ino };
    const applied = await stageFromPrevious({ repository: f.repository, previousCommit: f.first, commit: second, archives: ARCHIVES, derived: DERIVED, previousRelease: running.release, stage: join(f.root, "stage-2") });
    assert.deepEqual([applied.removed, applied.written >= 3], [1, true]);
    assert.equal(await readFile(join(f.root, "stage-2/app/server.mjs"), "utf8"), "export default 2;\n", "modified applied");
    assert.equal(await readFile(join(f.root, "stage-2/app/added/new.mjs"), "utf8"), "export default 'new';\n", "added applied");
    await assert.rejects(stat(join(f.root, "stage-2/app/doomed")), "deleted applied, and its emptied directory with it");
    await assert.rejects(stat(join(f.root, "stage-2/node_modules")), "node_modules is not carried");
    assert.equal(await readFile(join(running.release, "app/server.mjs"), "utf8"), before.server, "the running release is untouched");
    assert.equal((await stat(join(running.release, "app/doomed/gone.mjs"))).isFile(), true);
    assert.equal((await stat(join(f.root, "stage-2/app/keep.mjs"))).ino, before.keepInode, "an unchanged tracked file is carried, not copied");
    assert.equal((await stat(join(f.root, "stage-2/app/run.sh"))).mode & 0o111, 0o111, "the executable bit survives");

    archive(f.repository, second, join(f.root, "full-2"));
    const incremental = await releaseDigest(join(f.root, "stage-2"), { derived: DERIVED });
    assert.equal(incremental, await releaseDigest(join(f.root, "full-2"), { derived: DERIVED }), "byte-equal to a full archive");
    assert.equal(await readFile(join(f.root, "stage-2/gen/descriptors.mjs"), "utf8"), await readFile(join(f.root, "full-2/gen/descriptors.mjs"), "utf8"), "derived files are written as archived");

    // Retention: the running release can be pruned, and the staged tree stands whole without it.
    execFileSync("chmod", ["-R", "u+w", running.release]);
    await rm(running.release, { recursive: true, force: true });
    assert.equal(await releaseDigest(join(f.root, "stage-2"), { derived: DERIVED }), incremental, "the staged tree shares nothing with the pruned release");

    // The staged tree materializes under its git identity, and the drift check agrees with git.
    const next = await materializeNodeRuntimeRelease({ stagedRoot: join(f.root, "stage-2"), releaseRoot: f.releases, derived: DERIVED, identity: identityOf(second), source: { repository: "r", commit: second, archives: ARCHIVES } });
    assert.notEqual(next.artifactDigest, running.artifactDigest);
    assert.deepEqual(await verifyReleaseDrift({ release: next.release, repository: f.repository }), { ok: true, kind: "git-identity", drifted: [] });
    execFileSync("chmod", ["-R", "u+w", next.release]);
    await writeFile(join(next.release, "app/keep.mjs"), "edited in place\n");
    const drift = await verifyReleaseDrift({ release: next.release, repository: f.repository });
    assert.equal(drift.ok, false);
    assert.deepEqual(drift.drifted, [{ path: "app/keep.mjs", why: "bytes differ" }]);
  } finally {
    execFileSync("chmod", ["-R", "u+w", f.root]);
    await rm(f.root, { recursive: true, force: true });
  }
});

test("a file the tree marks export-ignore is neither archived nor listed", async () => {
  const f = await fixture();
  try {
    const commit = await put(f.repository, { ".gitattributes": "app/internal.mjs export-ignore\n", "app/internal.mjs": "export default 'private';\n" });
    const withIgnored = releaseIdentity({ repository: f.repository, commit, archives: ARCHIVES });
    const changed = await put(f.repository, { "app/internal.mjs": "export default 'private, edited';\n" });
    assert.equal(releaseIdentity({ repository: f.repository, commit: changed, archives: ARCHIVES }).digest, withIgnored.digest);
    archive(f.repository, changed, join(f.root, "full"));
    await assert.rejects(stat(join(f.root, "full/app/internal.mjs")));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("carryFiles clones a tree in parallel by link, by directory run, and never shares a directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "tree-carry-"));
  try {
    const entries = [];
    for (let directory = 0; directory < 12; directory += 1) for (let file = 0; file < 5; file += 1) {
      const path = `d${directory}/nested/f${file}.txt`;
      await mkdir(join(root, "from", dirname(path)), { recursive: true });
      await writeFile(join(root, "from", path), `${path}\n`);
      entries.push({ mode: "100644", path });
    }
    await symlink("nested/f0.txt", join(root, "from/d0/link"));
    entries.push({ mode: "120000", path: "d0/link" });
    entries.sort((left, right) => (left.path < right.path ? -1 : 1));
    assert.equal(await carryFiles({ from: join(root, "from"), to: join(root, "to"), entries, jobs: 4, grain: 3 }), 61);
    assert.equal(await readFile(join(root, "to/d11/nested/f4.txt"), "utf8"), "d11/nested/f4.txt\n");
    assert.equal(readlinkSync(join(root, "to/d0/link")), "nested/f0.txt");
    assert.equal((await stat(join(root, "to/d3/nested/f1.txt"))).ino, (await stat(join(root, "from/d3/nested/f1.txt"))).ino, "files are linked");
    assert.equal(lstatSync(join(root, "to/d3")).isSymbolicLink(), false, "directories are the new tree's own");
    await rm(join(root, "from"), { recursive: true, force: true });
    assert.equal(await readFile(join(root, "to/d5/nested/f2.txt"), "utf8"), "d5/nested/f2.txt\n", "the source can be pruned");
    await assert.rejects(carryFiles({ from: join(root, "gone"), to: join(root, "to2"), entries, jobs: 4, grain: 3 }), /ENOENT/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
