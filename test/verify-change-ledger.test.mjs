import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyChangeLedger } from "../scripts/verify-change-ledger.mjs";

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "verify-ledger-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("changed.mjs", "old\n");
  mk("unchanged.mjs", "same\n");
  mk("deleted.mjs", "gone\n");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  writeFileSync(join(root, "changed.mjs"), "new\n");
  rmSync(join(root, "deleted.mjs"));
  mk("new.mjs", "brand new\n");
  return { root, git };
}

test("verifyChangeLedger passes a changed, a new, and a deleted path", () => {
  const { root } = makeRepo();
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "changed.mjs\nnew.mjs\ndeleted.mjs\n");
  const { ok, offenders, summary } = verifyChangeLedger({ ledgerFile, root });
  assert.equal(ok, true);
  assert.deepEqual(offenders, []);
  assert.deepEqual(summary, { input: 3, expanded: 3, verified: 3, offenders: 0 });
});

test("verifyChangeLedger offends on an unchanged path and on a path absent at both HEAD and now", () => {
  const { root } = makeRepo();
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "changed.mjs\nunchanged.mjs\ndoes/not/exist.mjs\n");
  const { ok, offenders, summary } = verifyChangeLedger({ ledgerFile, root });
  assert.equal(ok, false);
  assert.deepEqual(offenders.sort((a, b) => a.path.localeCompare(b.path)), [
    { path: "does/not/exist.mjs", reason: "absent-both" },
    { path: "unchanged.mjs", reason: "unchanged" },
  ]);
  assert.equal(summary.offenders, 2);
  assert.equal(summary.verified, 1);
});

test("verifyChangeLedger expands a directory entry the same way the screen does", () => {
  const { root } = makeRepo();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("pkg/a.mjs", "a\n");
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "pkg"], { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  rmSync(join(root, "pkg"), { recursive: true });
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "pkg\n");
  const { ok, summary } = verifyChangeLedger({ ledgerFile, root });
  assert.equal(ok, true, "the whole package directory having been deleted counts as a real change");
  assert.equal(summary.expanded, 1);
});

test("the CLI exits 0 with a clean ledger and 1 with an offending one, printing offenders to stderr and a summary to stdout", () => {
  const { root } = makeRepo();
  const scriptPath = fileURLToPath(new URL("../scripts/verify-change-ledger.mjs", import.meta.url));
  const goodLedger = join(root, "good.txt");
  writeFileSync(goodLedger, "changed.mjs\n");
  const good = spawnSync(process.execPath, [scriptPath, "--ledger", goodLedger, "--root", root], { encoding: "utf8" });
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(JSON.parse(good.stdout), { input: 1, expanded: 1, verified: 1, offenders: 0 });

  const badLedger = join(root, "bad.txt");
  writeFileSync(badLedger, "unchanged.mjs\n");
  const bad = spawnSync(process.execPath, [scriptPath, "--ledger", badLedger, "--root", root], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.equal(bad.stderr.trim(), "unchanged: unchanged.mjs");
});

test("the CLI's --held-areas excludes a held untracked path from the omitted-untracked warning (and defaults to the house's own record)", () => {
  const { root, git } = makeRepo();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("pkg/package.json", JSON.stringify({}));
  git("add", "-A");
  git("commit", "-q", "-m", "add pkg");
  mk("pkg/package.json", JSON.stringify({ scripts: { build: "node held-helper.mjs" } }));
  mk("pkg/held-helper.mjs", "export const held = 1;\n");

  const mapFile = join(root, "map.json");
  writeFileSync(mapFile, JSON.stringify({ packages: { "@x/pkg": "pkg" } }));
  const heldAreasFile = join(root, "held-areas.json");
  writeFileSync(heldAreasFile, JSON.stringify({ areas: [{ pattern: "pkg/held-", holder: "codex", reason: "test", since: "2026-09-21" }] }));

  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "pkg/package.json\n");
  const scriptPath = fileURLToPath(new URL("../scripts/verify-change-ledger.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, "--ledger", ledgerFile, "--root", root, "--map", mapFile, "--held-areas", heldAreasFile], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), "", "the held path produces no omitted-untracked warning");
});

test("verifyChangeLedger reports an omitted untracked file as a warning, in omittedUntracked, without turning ok false", () => {
  const { root, git } = makeRepo();
  const map = { packages: { "@x/pkg": "pkg" } };
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("pkg/package.json", JSON.stringify({}));
  git("add", "-A");
  git("commit", "-q", "-m", "add pkg");
  // A real, uncommitted edit to the already-tracked package.json — still tracked at HEAD (as `{}`),
  // now different on disk, so it is a genuine "changed" ledger entry and still a scanned tracked file.
  mk("pkg/package.json", JSON.stringify({ scripts: { build: "node helper.mjs" } }));
  mk("pkg/helper.mjs", "export const helper = 1;\n"); // untracked, never listed on the ledger

  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "pkg/package.json\n");
  const { ok, omittedUntracked } = verifyChangeLedger({ ledgerFile, root, map });
  assert.equal(ok, true, "verify's own pass/fail is unaffected; this is a warning, not an offense");
  assert.deepEqual(omittedUntracked, [{ package: "pkg", path: "pkg/helper.mjs", importedBy: ["pkg/package.json"] }]);
});

test("verifyChangeLedger passes heldAreas through to the omittedUntracked scan, excluding a held path from the warning", () => {
  const { root, git } = makeRepo();
  const map = { packages: { "@x/pkg": "pkg" } };
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("pkg/package.json", JSON.stringify({}));
  git("add", "-A");
  git("commit", "-q", "-m", "add pkg");
  mk("pkg/package.json", JSON.stringify({ scripts: { build: "node held-helper.mjs" } }));
  mk("pkg/held-helper.mjs", "export const held = 1;\n"); // untracked, in a held area, never listed on the ledger

  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "pkg/package.json\n");
  const heldAreas = { areas: [{ pattern: "pkg/held-", holder: "codex", reason: "test", since: "2026-09-21" }] };
  const { omittedUntracked } = verifyChangeLedger({ ledgerFile, root, map, heldAreas });
  assert.deepEqual(omittedUntracked, [], "the held path is excluded rather than reported as omitted");
});
