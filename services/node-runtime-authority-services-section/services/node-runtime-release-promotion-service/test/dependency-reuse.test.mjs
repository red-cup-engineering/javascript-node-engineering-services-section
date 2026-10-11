import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adoptDependencies, carryDependencies, cloneMethodOf, installKeyOf, pnpmCommandOf } from "../src/dependency-reuse.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const scratch = mkdtempSync(join(tmpdir(), "dependency-reuse-"));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function repository(files) {
  const root = mkdtempSync(join(scratch, "repo-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.org");
  git(root, "config", "user.name", "t");
  const commit = (changes, message) => {
    for (const [path, content] of Object.entries(changes)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), content); }
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", message);
    return git(root, "rev-parse", "HEAD");
  };
  return { root, gitDir: join(root, ".git"), commit, first: commit(files, "first") };
}
const versions = { pnpmVersion: "11.9.0", nodeVersion: "v24.0.0" };

test("the install key is stable and changes with a manifest, the lockfile, the configuration or the toolchain", () => {
  const repo = repository({
    "package.json": '{"name":"root"}', "pnpm-lock.yaml": "lockfileVersion: '9.0'\n", "pnpm-workspace.yaml": "packages:\n  - lib/**\n",
    "lib/a/package.json": '{"name":"a"}', "lib/b/package.json": '{"name":"b"}', "lib/a/src/index.mjs": "export {}\n", "README.md": "x",
  });
  const key = (commit) => installKeyOf({ gitDir: repo.gitDir, commit, ...versions });
  const base = key(repo.first);
  assert.match(base, /^[0-9a-f]{64}$/u);
  assert.equal(key(repo.first), base, "same commit, same key");
  // Source and documents are not dependency identity: a commit that touches only them keeps the key.
  assert.equal(key(repo.commit({ "lib/a/src/index.mjs": "export const a = 1;\n", "README.md": "y" }, "source only")), base);
  const lock = key(repo.commit({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n# resolved\n" }, "lockfile"));
  assert.notEqual(lock, base);
  const manifest = key(repo.commit({ "lib/b/package.json": '{"name":"b","dependencies":{"x":"1"}}' }, "manifest"));
  assert.notEqual(manifest, lock);
  const added = key(repo.commit({ "lib/c/package.json": '{"name":"c"}' }, "new project"));
  assert.notEqual(added, manifest);
  const npmrc = key(repo.commit({ ".npmrc": "auto-install-peers=true\n" }, "npmrc"));
  assert.notEqual(npmrc, added);
  assert.notEqual(installKeyOf({ gitDir: repo.gitDir, commit: "HEAD", ...versions, pnpmVersion: "11.10.0" }), npmrc);
  assert.notEqual(installKeyOf({ gitDir: repo.gitDir, commit: "HEAD", ...versions, nodeVersion: "v24.1.0" }), npmrc);
  assert.equal(key("HEAD"), npmrc);
  assert.throws(() => installKeyOf({ gitDir: repo.gitDir, commit: "HEAD", pnpmVersion: "11.9.0" }), /node versions/u);
});

test("pnpm is the dependency command's first word, or the key is not computed", () => {
  assert.equal(pnpmCommandOf("~/.local/bin/pnpm install --frozen-lockfile --offline"), "~/.local/bin/pnpm");
  assert.equal(pnpmCommandOf("pnpm install"), "pnpm");
  assert.equal(pnpmCommandOf("npm ci"), null);
  assert.equal(pnpmCommandOf(undefined), null);
});

// A miniature of pnpm's layout: a virtual store of real files, a root and a project farm of relative symlinks.
function installed(root) {
  const store = join(root, "node_modules", ".pnpm");
  for (const name of ["left-pad@1.0.0", "is-odd@3.0.0", "tiny@2.0.0"]) {
    const package_ = join(store, name, "node_modules", name.split("@")[0]);
    mkdirSync(package_, { recursive: true });
    writeFileSync(join(package_, "package.json"), JSON.stringify({ name: name.split("@")[0], type: "module", exports: "./index.mjs" }));
    writeFileSync(join(package_, "index.mjs"), `export default ${JSON.stringify(name)};\n`);
  }
  writeFileSync(join(root, "node_modules", ".modules.yaml"), "layoutVersion: 5\n");
  mkdirSync(join(root, "lib", "app", "node_modules"), { recursive: true });
  symlinkSync("../../../node_modules/.pnpm/left-pad@1.0.0/node_modules/left-pad", join(root, "lib", "app", "node_modules", "left-pad"));
  writeFileSync(join(root, "lib", "app", "package.json"), '{"name":"app","type":"module"}');
}

test("carried node_modules are the running release's, independent of it, and resolve", async () => {
  const running = join(scratch, "running");
  const next = join(scratch, "next");
  installed(running);
  mkdirSync(join(next, "lib", "app"), { recursive: true });
  mkdirSync(join(next, "lib", "gone-in-new-release"), { recursive: true });
  writeFileSync(join(next, "lib", "app", "package.json"), '{"name":"app","type":"module"}');
  assert.ok(["reflink", "hardlink"].includes(await cloneMethodOf(next)));
  // A batch of one cuts the virtual store into one job per entry.
  const result = await carryDependencies({ from: running, to: next, batch: 1, jobs: 3 });
  assert.equal(result.directories, 2);
  assert.ok(result.jobs >= 3, "the virtual store is carried in several jobs");
  assert.equal(readFileSync(join(next, "node_modules", ".modules.yaml"), "utf8"), "layoutVersion: 5\n");
  assert.ok(lstatSync(join(next, "lib", "app", "node_modules", "left-pad")).isSymbolicLink());
  const imported = execFileSync(process.execPath, ["--input-type=module", "-e", 'import v from "left-pad"; process.stdout.write(v);'], { cwd: join(next, "lib", "app") }).toString();
  assert.equal(imported, "left-pad@1.0.0");
  // The new tree stands alone: the running release can be removed.
  rmSync(running, { recursive: true, force: true });
  assert.equal(execFileSync(process.execPath, ["--input-type=module", "-e", 'import v from "left-pad"; process.stdout.write(v);'], { cwd: join(next, "lib", "app") }).toString(), "left-pad@1.0.0");
  assert.ok(!existsSync(join(next, "lib", "gone-in-new-release", "node_modules")));
});

test("a node_modules the new tree already has, or has no project for, is left alone", async () => {
  const running = join(scratch, "running-2");
  const next = join(scratch, "next-2");
  installed(running);
  mkdirSync(join(next, "lib", "app", "node_modules"), { recursive: true });
  writeFileSync(join(next, "lib", "app", "node_modules", "own"), "own");
  const result = await carryDependencies({ from: running, to: next });
  assert.equal(result.directories, 1, "only the root's: the project's farm exists already");
  assert.ok(!existsSync(join(next, "lib", "app", "node_modules", "left-pad")));
  assert.equal(readFileSync(join(next, "lib", "app", "node_modules", "own"), "utf8"), "own");
});

test("dependencies carried into a side directory while the tree is staged are adopted by rename", async () => {
  const running = join(scratch, "running-3");
  const side = join(scratch, "side-3");
  const next = join(scratch, "next-3");
  installed(running);
  const result = await carryDependencies({ from: running, to: side, projects: new Set([".", "lib/app"]), batch: 1, jobs: 3 });
  assert.equal(result.directories, 2);
  mkdirSync(join(next, "lib", "app"), { recursive: true });
  writeFileSync(join(next, "lib", "app", "package.json"), '{"name":"app","type":"module"}');
  assert.equal(adoptDependencies({ from: side, to: next }), 2);
  rmSync(running, { recursive: true, force: true });
  rmSync(side, { recursive: true, force: true });
  assert.equal(execFileSync(process.execPath, ["--input-type=module", "-e", 'import v from "left-pad"; process.stdout.write(v);'], { cwd: join(next, "lib", "app") }).toString(), "left-pad@1.0.0");
  // A project the release does not have is refused, for the caller to install from nothing.
  const other = join(scratch, "side-4");
  installed(join(scratch, "running-4"));
  await carryDependencies({ from: join(scratch, "running-4"), to: other, projects: new Set([".", "lib/app"]) });
  assert.throws(() => adoptDependencies({ from: other, to: join(scratch, "next-4-empty") }), /cannot adopt/u);
});
