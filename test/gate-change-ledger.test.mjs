import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectMoves, detectTranslations, diffSuites, gateChangeLedger, newFindings, partitionByAttribution, writeBaseline } from "../scripts/gate-change-ledger.mjs";

test("newFindings keeps only records absent from the baseline, by exact identity", () => {
  const a = { importer: "x", specifier: "y" };
  const b = { importer: "x", specifier: "z" };
  assert.deepEqual(newFindings([a, b], [a]), [b]);
  assert.deepEqual(newFindings([a, b], []), [a, b]);
  assert.deepEqual(newFindings([], [a]), []);
});

test("diffSuites reports new failures and fixed failures per package present in the current run", () => {
  const baseline = [
    { package: "pkg", pass: 1, fail: 1, skipped: 0, failures: [{ file: "pkg/test/a.test.mjs", cause: "assertion", detail: "d" }] },
  ];
  const current = [
    { package: "pkg", pass: 1, fail: 1, skipped: 0, failures: [{ file: "pkg/test/b.test.mjs", cause: "assertion", detail: "d2" }] },
  ];
  const { newFailures, fixed } = diffSuites(current, baseline);
  assert.deepEqual(newFailures, [{ package: "pkg", file: "pkg/test/b.test.mjs", cause: "assertion", detail: "d2" }]);
  assert.deepEqual(fixed, [{ package: "pkg", file: "pkg/test/a.test.mjs", cause: "assertion", detail: "d" }]);
});

test("diffSuites treats a package absent from the baseline as entirely new failures", () => {
  const current = [{ package: "new-pkg", pass: 0, fail: 1, skipped: 0, failures: [{ file: "new-pkg/test/a.test.mjs", cause: "other", detail: "d" }] }];
  assert.deepEqual(diffSuites(current, []).newFailures, [{ package: "new-pkg", file: "new-pkg/test/a.test.mjs", cause: "other", detail: "d" }]);
});

test("diffSuites reports a failure present on both sides as unchanged, not new", () => {
  const shared = { file: "pkg/test/a.test.mjs", cause: "assertion", detail: "d" };
  const baseline = [{ package: "pkg", pass: 0, fail: 1, skipped: 0, failures: [shared] }];
  const current = [{ package: "pkg", pass: 0, fail: 1, skipped: 0, failures: [shared] }];
  const { newFailures, fixed, unchanged } = diffSuites(current, baseline);
  assert.deepEqual(newFailures, []);
  assert.deepEqual(fixed, []);
  assert.deepEqual(unchanged, [{ package: "pkg", ...shared }]);
});

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "gate-ledger-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/x/pkg/package.json", JSON.stringify({}));
  mk("lib/x/pkg/src/a.mjs", "export const a = 1;\n");
  mk("lib/x/pkg/test/one.test.mjs", "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"one\", () => { assert.equal(1, 1); });\n");
  mk("lib/x/other/package.json", JSON.stringify({}));
  // A package with a failure already committed at HEAD: the point of computing the suite baseline
  // from history is that this package needs no entry in any baseline directory for its pre-existing
  // failure to be recognized as pre-existing rather than new.
  mk("lib/x/broken/package.json", JSON.stringify({}));
  mk("lib/x/broken/src/b.mjs", "export const b = 1;\n");
  mk("lib/x/broken/test/fails.test.mjs", "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"already broken\", () => { assert.equal(1, 2); });\n");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");

  const layers = {
    root: "lib/x",
    layers: [
      { name: "substrate", imports: [], directories: ["pkg", "broken"] },
      { name: "other-layer", imports: [], directories: ["other"] },
    ],
  };
  const map = { packages: { "@red-cup-engineering/pkg": "lib/x/pkg", "@red-cup-engineering/other": "lib/x/other", "@red-cup-engineering/broken": "lib/x/broken" } };
  const heldAreas = { areas: [], reachInSections: [] };
  return { root, git, layers, map, heldAreas };
}

test("writeBaseline captures only the clean tree's layer audit and phantom audit; it no longer runs any suite", () => {
  const { root, layers, map } = makeRepo();
  const baselineDir = join(root, "baseline");
  const receipt = writeBaseline({ root, layers, map, dir: baselineDir });
  assert.equal(receipt.layerFindings, 0);
  assert.equal(receipt.phantomFindings, 0);
  assert.deepEqual(Object.keys(receipt).sort(), ["dir", "layerFindings", "phantomFindings"]);
  const layerAudit = JSON.parse(readFileSync(join(baselineDir, "layer-audit.json"), "utf8"));
  assert.deepEqual(layerAudit.findings, []);
  assert.ok(JSON.parse(readFileSync(join(baselineDir, "phantom-imports.json"), "utf8")));
});

test("gateChangeLedger computes the suite baseline itself from the ledger's packages exported at --ref (HEAD by default), so a package with a pre-existing, already-committed failure is not new just because no baseline directory ever recorded it", () => {
  const { root, layers, map, heldAreas } = makeRepo();
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/pkg/src/a.mjs\nlib/x/broken/src/b.mjs\n");
  const baselineDir = join(root, "baseline");
  writeBaseline({ root, layers, map, dir: baselineDir }); // never mentions lib/x/broken's suite at all

  writeFileSync(join(root, "lib/x/pkg/src/a.mjs"), "export const a = 2;\n"); // a harmless, real change
  writeFileSync(join(root, "lib/x/broken/src/b.mjs"), "export const b = 2;\n"); // touched, but the test failure is untouched and pre-existing

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir });
  assert.equal(verdict.ok, true, "the pre-existing broken/test/fails.test.mjs failure must not fail the gate");
  assert.deepEqual(verdict.suites.newFailures, []);
  assert.equal(verdict.suites.unchanged.length, 1);
  assert.equal(verdict.suites.unchanged[0].file, "lib/x/broken/test/fails.test.mjs");
  assert.equal(verdict.suites.unchanged[0].cause, "assertion");
});

test("gateChangeLedger is not ok when the ledger introduces a forbidden layer import, a new external import, a TypeScript file, and a new test failure, all reported by name", () => {
  const { root, layers, map, heldAreas } = makeRepo();
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/pkg/src/a.mjs\nlib/x/pkg/test/one.test.mjs\nlib/x/pkg/src/extra.mts\n");
  const baselineDir = join(root, "baseline");
  writeBaseline({ root, layers, map, heldAreas, ledgerFile, dir: baselineDir });

  writeFileSync(join(root, "lib/x/pkg/src/a.mjs"), "import { z } from \"zod\";\nimport { o } from \"@red-cup-engineering/other\";\nexport const a = 1;\n");
  writeFileSync(join(root, "lib/x/pkg/test/one.test.mjs"), "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"one\", () => { assert.equal(1, 2); });\n");
  writeFileSync(join(root, "lib/x/pkg/src/extra.mts"), "export const extra: number = 1;\n");

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.verify.ok, true);
  assert.equal(verdict.screen.kept, 3);
  assert.equal(verdict.newLayerFindings.length, 1);
  assert.equal(verdict.newLayerFindings[0].specifier, "@red-cup-engineering/other");
  assert.deepEqual(verdict.newPhantoms, []);
  assert.equal(verdict.newExternals.length, 1);
  assert.equal(verdict.newExternals[0].specifier, "zod");
  assert.deepEqual(verdict.typescriptFiles, ["lib/x/pkg/src/extra.mts"]);
  assert.equal(verdict.suites.newFailures.length, 1);
  assert.equal(verdict.suites.newFailures[0].file, "lib/x/pkg/test/one.test.mjs");
  assert.deepEqual(verdict.suites.fixed, []);
});

test("gateChangeLedger is ok when nothing regresses against the baseline", () => {
  const { root, layers, map, heldAreas } = makeRepo();
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/pkg/src/a.mjs\n");
  const baselineDir = join(root, "baseline");
  writeBaseline({ root, layers, map, heldAreas, ledgerFile, dir: baselineDir });
  writeFileSync(join(root, "lib/x/pkg/src/a.mjs"), "export const a = 2;\n");
  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir });
  assert.equal(verdict.ok, true);
});

test("partitionByAttribution: an importer that is a kept path, or lies under an owning package, is attributed; anything else is elsewhere", () => {
  const attributed1 = { importer: "lib/x/pkg/src/a.mjs" }; // a kept path itself
  const attributed2 = { importer: "lib/x/pkg/src/other.mjs" }; // not kept, but under an owning package
  const outside = { importer: "lib/x/elsewhere/src/z.mjs" }; // neither kept nor under an owning package
  // root is only consulted for the nested-package check (see the dedicated test below); a root with
  // nothing on disk under it is equivalent to "no nested package in the way" for this fixture.
  const result = partitionByAttribution([attributed1, attributed2, outside], { kept: ["lib/x/pkg/src/a.mjs"], packageDirs: ["lib/x/pkg"], root: "/nonexistent-root-for-partition-test" });
  assert.deepEqual(result.attributed, [attributed1, attributed2]);
  assert.deepEqual(result.elsewhere, [outside]);
});

test("partitionByAttribution: a finding whose specifier resolves into a path the ledger deletes or renames is attributed even though its importer sits outside the ledger's own packages", () => {
  const finding = { importer: "lib/x/other/src/z.mjs", specifier: "./gone.mjs" };
  const resolveTarget = () => "lib/x/other/gone.mjs";
  const attributedByDelete = partitionByAttribution([finding], { kept: [], packageDirs: ["lib/x/pkg"], renamedOrDeleted: new Set(["lib/x/other/gone.mjs"]), resolveTarget });
  assert.deepEqual(attributedByDelete.attributed, [finding]);
  assert.deepEqual(attributedByDelete.elsewhere, []);
  const unattributed = partitionByAttribution([finding], { kept: [], packageDirs: ["lib/x/pkg"], renamedOrDeleted: new Set(), resolveTarget });
  assert.deepEqual(unattributed.elsewhere, [finding]);
});

test("partitionByAttribution: a path under a nested package (its own package.json) inside an owning package directory is elsewhere, not attributed by directory prefix alone -- unless that nested package is itself one of packageDirs", () => {
  const root = mkdtempSync(join(tmpdir(), "partition-nested-package-"));
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/x/pkg/package.json", JSON.stringify({}));
  mk("lib/x/pkg/nested-held/package.json", JSON.stringify({})); // a section of its own, another hand's
  const nested = { importer: "lib/x/pkg/nested-held/src/z.mjs" };
  const ownFile = { importer: "lib/x/pkg/src/a.mjs" };

  const excluded = partitionByAttribution([nested, ownFile], { kept: [], packageDirs: ["lib/x/pkg"], root });
  assert.deepEqual(excluded.attributed, [ownFile], "the nested package's own file shares a directory prefix, but it is not this ledger's package");
  assert.deepEqual(excluded.elsewhere, [nested]);

  const included = partitionByAttribution([nested, ownFile], { kept: [], packageDirs: ["lib/x/pkg", "lib/x/pkg/nested-held"], root });
  assert.deepEqual(included.attributed, [nested, ownFile], "once the nested package is itself one of the ledger's owning packages, its file is attributed too");
});

test("gate-change-ledger attribution: a new phantom introduced by a file outside the ledger's own packages counts under elsewhere, not against ok, while the ledger's own kept file stays clean", () => {
  const { root, layers, map, heldAreas } = makeRepo();
  const baselineDir = join(root, "baseline");
  writeBaseline({ root, layers, map, dir: baselineDir });
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/pkg/src/a.mjs\n");
  writeFileSync(join(root, "lib/x/pkg/src/a.mjs"), "export const a = 2;\n"); // a clean, real edit
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  // Another hand's in-flight file, outside every package this ledger owns, carrying a brand-new
  // phantom import the baseline (captured before this file existed) never had.
  mk("lib/x/other/src/uses-ghost.mjs", "import { ghost } from \"@red-cup-engineering/does-not-exist-phantom\";\nexport const g = 1;\n");

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir });
  assert.equal(verdict.ok, true, "a file outside this ledger's own packages must not fail its gate");
  assert.deepEqual(verdict.newPhantoms, [], "the phantom is not attributed to this ledger");
  assert.equal(verdict.elsewhere.summary.phantoms, 1, "but it is still counted, under elsewhere, so the drift is visible");
  assert.equal(verdict.elsewhere.phantoms[0].importer, "lib/x/other/src/uses-ghost.mjs");
});

test("gate-change-ledger attribution: the converse — a new phantom whose importer is the ledger's own kept path is attributed, failing the gate, with nothing left under elsewhere", () => {
  const { root, layers, map, heldAreas } = makeRepo();
  const baselineDir = join(root, "baseline");
  writeBaseline({ root, layers, map, dir: baselineDir });
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/pkg/src/a.mjs\n");
  writeFileSync(join(root, "lib/x/pkg/src/a.mjs"), "import { ghost } from \"@red-cup-engineering/does-not-exist-phantom\";\nexport const a = 2;\n");

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir });
  assert.equal(verdict.ok, false, "the ledger's own kept file introduced the phantom, so its gate must fail");
  assert.equal(verdict.newPhantoms.length, 1);
  assert.equal(verdict.newPhantoms[0].importer, "lib/x/pkg/src/a.mjs");
  assert.equal(verdict.elsewhere.summary.phantoms, 0);
  assert.deepEqual(verdict.elsewhere.phantoms, []);
});

test("gate-change-ledger attribution: a new phantom inside a nested package (its own package.json, held by another hand) that merely sits under the ledger's owning package directory is elsewhere, not attributed by directory prefix alone", () => {
  const { root, git, layers, map } = makeRepo();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  // A section of its own, nested inside lib/x/pkg but owning its own package.json, matching a held
  // area this ledger never touches -- the same shape as, in the real house tree, a
  // jsnode-workspace-analysis-services-section held by another hand nested under this JN package.
  mk("lib/x/pkg/nested-held/package.json", JSON.stringify({}));
  git("add", "-A");
  git("commit", "-q", "-m", "add the nested, held section (empty, so far)");
  const heldAreas = { areas: [{ pattern: "nested-held" }], reachInSections: [] };

  const baselineDir = join(root, "baseline");
  writeBaseline({ root, layers, map, dir: baselineDir });
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/pkg/src/a.mjs\n");
  writeFileSync(join(root, "lib/x/pkg/src/a.mjs"), "export const a = 2;\n"); // this ledger's own, clean edit
  // The other hand's own in-flight, untracked file inside its nested, held section.
  mk("lib/x/pkg/nested-held/src/uses-ghost.mjs", "import { ghost } from \"@red-cup-engineering/does-not-exist-phantom\";\nexport const g = 1;\n");

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir });
  assert.equal(verdict.ok, true, "the nested, held section's phantom is not this ledger's business merely because it shares a directory prefix");
  assert.deepEqual(verdict.newPhantoms, []);
  assert.equal(verdict.elsewhere.summary.phantoms, 1);
  assert.equal(verdict.elsewhere.phantoms[0].importer, "lib/x/pkg/nested-held/src/uses-ghost.mjs");
});

test("gate-change-ledger attribution: a suite failure in a package this ledger only historically named -- every one of its own entries already byte-identical to HEAD, so nothing is currently kept there -- is elsewhere, not attributed", () => {
  const { root, layers, map, heldAreas } = makeRepo();
  const baselineDir = join(root, "baseline");
  writeBaseline({ root, layers, map, dir: baselineDir });
  const ledgerFile = join(root, "ledger.txt");
  // Names a path in lib/x/pkg but never actually changes it: this ledger, re-run today, has nothing
  // currently kept in lib/x/pkg at all -- the same shape as a ledger already committed earlier.
  writeFileSync(ledgerFile, "lib/x/pkg/src/a.mjs\n");
  // Another hand's own, unrelated, concurrent edit inside that same package, never named on the
  // ledger at all, breaks a test that passed at HEAD.
  writeFileSync(join(root, "lib/x/pkg/test/one.test.mjs"), "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"one\", () => { assert.equal(1, 2); });\n");

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir });
  assert.equal(verdict.screen.kept, 0, "the ledger's own named path never actually changed");
  assert.deepEqual(verdict.suites.newFailures, [], "nothing is currently kept in this package, so the new failure is not attributed to this ledger");
  const elsewhereFailure = verdict.elsewhere.suiteFailures.find((failure) => failure.file === "lib/x/pkg/test/one.test.mjs");
  assert.ok(elsewhereFailure, "the drift is still reported, under elsewhere");
  assert.equal(verdict.ok, true, "a ledger with nothing currently kept must not fail its own gate over another hand's concurrent, unrelated edit inside a package it only historically named");
});

test("gateChangeLedger: a package whose test script is broken the same way at HEAD and now is an unchanged suite failure, not a new one, and does not fail the gate by itself", () => {
  const root = mkdtempSync(join(tmpdir(), "gate-ledger-test-script-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/x/scripted/package.json", JSON.stringify({ scripts: { test: "jest" } })); // an external runner: broken from the start
  mk("lib/x/scripted/src/c.mjs", "export const c = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture with an already-broken test script, committed this way");

  const layers = { root: "lib/x", layers: [{ name: "substrate", imports: [], directories: ["scripted"] }] };
  const map = { packages: { "@red-cup-engineering/scripted": "lib/x/scripted" } };
  const heldAreas = { areas: [], reachInSections: [] };

  writeFileSync(join(root, "lib/x/scripted/src/c.mjs"), "export const c = 2;\n"); // a harmless real edit; the broken script itself is untouched
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/scripted/src/c.mjs\n");

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile }); // no --baseline: the live ref (default HEAD) baseline
  const scriptFailures = verdict.suites.unchanged.filter((failure) => failure.cause.startsWith("test-script:"));
  assert.equal(scriptFailures.length, 1, "the identically-broken test script is unchanged, not new");
  assert.equal(verdict.suites.newFailures.some((failure) => failure.cause.startsWith("test-script:")), false);
  assert.equal(verdict.ok, true, "a pre-existing, identically-broken test script must not fail the gate");
});

test("without --baseline, everything currently found counts as new", () => {
  const { root, layers, map, heldAreas } = makeRepo();
  writeFileSync(join(root, "lib/x/pkg/src/a.mjs"), "import { z } from \"zod\";\nexport const a = 1;\n");
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/pkg/src/a.mjs\n");
  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir: undefined });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.newExternals.length, 1);
});

test("without --baseline, the gate computes the layer/phantom baseline itself from --ref (default HEAD): a forbidden layer import already committed there is pre-existing, not new", () => {
  const root = mkdtempSync(join(tmpdir(), "gate-ledger-ref-baseline-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  // The ref export only ever covers lib/emsenn/services/561-group, so the fixture has to live there
  // for this test to exercise the real git-archive path rather than the "ref has nothing" shortcut.
  mk("lib/emsenn/services/561-group/x/pkg/package.json", JSON.stringify({}));
  mk("lib/emsenn/services/561-group/x/pkg/src/a.mjs", "import { serve } from \"@red-cup-engineering/web-server/serve\";\nexport const a = 1;\n");
  mk("lib/emsenn/services/561-group/x/apps/web-server/package.json", JSON.stringify({}));
  mk("lib/emsenn/services/561-group/x/apps/web-server/src/serve.mjs", "export const serve = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture with a pre-existing forbidden import already at HEAD");

  const layers = {
    root: "lib/emsenn/services/561-group/x",
    layers: [
      { name: "substrate", imports: [], directories: ["pkg"] },
      { name: "web-server", imports: [], directories: ["apps/web-server"] },
    ],
  };
  const map = { packages: { "@red-cup-engineering/pkg": "lib/emsenn/services/561-group/x/pkg", "@red-cup-engineering/web-server": "lib/emsenn/services/561-group/x/apps/web-server" } };
  const heldAreas = { areas: [], reachInSections: [] };

  // A harmless further edit that still carries the same pre-existing forbidden import.
  writeFileSync(join(root, "lib/emsenn/services/561-group/x/pkg/src/a.mjs"), "import { serve } from \"@red-cup-engineering/web-server/serve\";\nexport const a = 2;\n");
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/emsenn/services/561-group/x/pkg/src/a.mjs\n");

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile }); // no baselineDir, no explicit ref: defaults to HEAD
  assert.deepEqual(verdict.newLayerFindings, [], "the forbidden import already existed at HEAD; with no --baseline directory the gate computes that itself instead of treating it as new");
  assert.equal(verdict.ok, true);
});

test("the CLI --write-baseline mode writes the layer and phantom audit files and exits 0, and --baseline mode exits 1 on a bad verdict", () => {
  const { root } = makeRepo();
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/pkg/src/a.mjs\n");
  const scriptPath = fileURLToPath(new URL("../scripts/gate-change-ledger.mjs", import.meta.url));
  // The CLI reads its own house records by default; exercise it against the real house records
  // rather than the fixture's, since --layers is not part of this script's CLI surface.
  const baselineDir = join(root, "baseline");
  const write = spawnSync(process.execPath, [scriptPath, "--ledger", ledgerFile, "--root", root, "--write-baseline", baselineDir], { encoding: "utf8" });
  assert.equal(write.status, 0, write.stderr);
  const receipt = JSON.parse(write.stdout);
  assert.equal(receipt.dir, baselineDir);

  writeFileSync(join(root, "lib/x/pkg/src/a.mjs"), "import { z } from \"zod\";\nexport const a = 1;\n");
  const gated = spawnSync(process.execPath, [scriptPath, "--ledger", ledgerFile, "--root", root, "--baseline", baselineDir], { encoding: "utf8" });
  assert.equal(gated.status, 1);
  const verdict = JSON.parse(gated.stdout);
  assert.equal(verdict.ok, false);
});

test("gateChangeLedger is not ok when the ledger omits an untracked file that a tracked file under the same package already names by basename (a package.json scripts entry pointing at a file nobody `git add`ed)", () => {
  const { root, layers, map, heldAreas } = makeRepo();
  // A real, uncommitted edit to the already-tracked package.json: still tracked at HEAD (as `{}`),
  // now different on disk — a genuine "changed" ledger entry, not a no-op one.
  writeFileSync(join(root, "lib/x/pkg/package.json"), JSON.stringify({ scripts: { build: "node helper.mjs" } }));
  const baselineDir = join(root, "baseline");
  writeBaseline({ root, layers, map, dir: baselineDir });

  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/pkg/package.json\n"); // records the package.json edit but omits helper.mjs itself
  writeFileSync(join(root, "lib/x/pkg/helper.mjs"), "export const helper = 1;\n"); // left untracked

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir });
  assert.equal(verdict.ok, false);
  const entry = verdict.omittedUntracked.find((item) => item.path === "lib/x/pkg/helper.mjs");
  assert.ok(entry, "the untracked, ledger-omitted helper.mjs is reported");
  assert.deepEqual(entry.importedBy, ["lib/x/pkg/package.json"]);
});

test("gateChangeLedger still reports an omitted untracked file with no importer, but does not fail the gate over it alone", () => {
  const { root, layers, map, heldAreas } = makeRepo();
  const baselineDir = join(root, "baseline");
  writeBaseline({ root, layers, map, dir: baselineDir });
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/pkg/src/a.mjs\n");
  writeFileSync(join(root, "lib/x/pkg/src/a.mjs"), "export const a = 2;\n");
  writeFileSync(join(root, "lib/x/pkg/src/orphan.mjs"), "export const orphan = 1;\n"); // untracked, unreferenced, left off the ledger

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir });
  const entry = verdict.omittedUntracked.find((item) => item.path === "lib/x/pkg/src/orphan.mjs");
  assert.deepEqual(entry, { package: "lib/x/pkg", path: "lib/x/pkg/src/orphan.mjs", importedBy: [] });
  assert.equal(verdict.ok, true, "nothing tracked reaches for it, so it is a warning, not a failure");
});

test("detectMoves matches a kept path with no HEAD blob at its own name to a HEAD blob at another path, by content hash, either under the ledger's own packages or at a path the ledger deletes", () => {
  const { root, git } = makeRepo();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  // Committed under a directory whose manifest discovery does not identify a package, so it can only be
  // found through the "paths the ledger deletes" side of the blob map, not the packages side.
  mk("lib/x/loose/vendor.mjs", "import { z } from \"zod\";\nexport const v = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "add a loose, unmapped file that already imports zod");

  rmSync(join(root, "lib/x/loose/vendor.mjs"));
  mk("lib/x/pkg/src/vendor-tool.mjs", "import { z } from \"zod\";\nexport const v = 1;\n"); // byte-identical, moved into pkg

  const moves = detectMoves({
    root,
    kept: ["lib/x/loose/vendor.mjs", "lib/x/pkg/src/vendor-tool.mjs"],
    packageDirs: ["lib/x/pkg"],
    deletedPaths: ["lib/x/loose/vendor.mjs"],
  });
  assert.deepEqual([...moves], [["lib/x/pkg/src/vendor-tool.mjs", "lib/x/loose/vendor.mjs"]]);
});

test("gateChangeLedger does not count a moved-not-edited file's pre-existing external import as newly introduced, and reports the move by name", () => {
  const { root, git, layers, map, heldAreas } = makeRepo();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/x/loose/vendor.mjs", "import { z } from \"zod\";\nexport const v = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "add a loose file that already imports zod");
  const baselineDir = join(root, "baseline");
  writeBaseline({ root, layers, map, dir: baselineDir });

  rmSync(join(root, "lib/x/loose/vendor.mjs"));
  mk("lib/x/pkg/src/vendor-tool.mjs", "import { z } from \"zod\";\nexport const v = 1;\n"); // moved, not edited
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/loose/vendor.mjs\nlib/x/pkg/src/vendor-tool.mjs\n");

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir });
  assert.deepEqual(verdict.moved, [{ from: "lib/x/loose/vendor.mjs", to: "lib/x/pkg/src/vendor-tool.mjs" }]);
  assert.deepEqual(verdict.newExternals, [], "zod was already imported at the origin path; the move alone must not look like a new external import");
});

test("gateChangeLedger counts only TypeScript paths that still exist in the working tree: a ledger's deleted .mts path is not counted", () => {
  const { root, git, layers, map, heldAreas } = makeRepo();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/x/pkg/src/legacy.mts", "export const legacy: number = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "add a tracked .mts file");
  const baselineDir = join(root, "baseline");
  writeBaseline({ root, layers, map, dir: baselineDir });

  rmSync(join(root, "lib/x/pkg/src/legacy.mts"));
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/pkg/src/legacy.mts\n");

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir });
  assert.deepEqual(verdict.typescriptFiles, [], "the .mts path no longer exists in the working tree, so it does not count as TypeScript");
  assert.equal(verdict.ok, true);
});

test("detectTranslations matches a kept, brand-new .mjs path to a same-directory .mts/.cts/.ts origin that was tracked at HEAD, and ignores an already-tracked or origin-less .mjs path", () => {
  const { root, git } = makeRepo();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/x/pkg/src/legacy.mts", "export const legacy: number = 1;\n");
  mk("lib/x/pkg/src/other.cts", "export const other: number = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "two tracked TypeScript origins");

  mk("lib/x/pkg/src/legacy.mjs", "export const legacy = 1;\n"); // translation of legacy.mts
  mk("lib/x/pkg/src/other.mjs", "export const other = 1;\n"); // translation of other.cts
  mk("lib/x/pkg/src/fresh.mjs", "export const fresh = 1;\n"); // no TypeScript origin: not a translation

  const translations = detectTranslations({
    root,
    kept: ["lib/x/pkg/src/legacy.mjs", "lib/x/pkg/src/other.mjs", "lib/x/pkg/src/fresh.mjs", "lib/x/pkg/src/a.mjs"],
  });
  assert.deepEqual([...translations].sort(), [
    ["lib/x/pkg/src/legacy.mjs", "lib/x/pkg/src/legacy.mts"],
    ["lib/x/pkg/src/other.mjs", "lib/x/pkg/src/other.cts"],
  ]);
});

test("gateChangeLedger detects a kept .mjs translation of a same-directory TypeScript origin tracked at HEAD, compares its externals against that origin instead of treating them as new, and reports it under translated (not typescriptFiles, since .mjs is not TypeScript)", () => {
  const { root, git, layers, map, heldAreas } = makeRepo();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/x/pkg/src/legacy.mts", "import { z } from \"zod\";\nexport const legacy: number = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "add a tracked .mts file that already imports zod");
  const baselineDir = join(root, "baseline");
  writeBaseline({ root, layers, map, dir: baselineDir });

  rmSync(join(root, "lib/x/pkg/src/legacy.mts"));
  mk("lib/x/pkg/src/legacy.mjs", "import { z } from \"zod\";\nexport const legacy = 1;\n");
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/pkg/src/legacy.mts\nlib/x/pkg/src/legacy.mjs\n");

  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir });
  assert.deepEqual(verdict.translated, [{ from: "lib/x/pkg/src/legacy.mts", to: "lib/x/pkg/src/legacy.mjs" }]);
  assert.deepEqual(verdict.newExternals, [], "zod was already imported at the .mts origin; the translation alone must not look like a new external import");
  assert.deepEqual(verdict.typescriptFiles, [], "the .mts origin is gone and the .mjs translation is not itself TypeScript");
  assert.equal(verdict.ok, true);
});
