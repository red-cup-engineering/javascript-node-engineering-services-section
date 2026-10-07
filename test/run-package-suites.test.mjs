import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyErrorLine, EXPORT_ANCESTOR_CAP, exportPackageAtRef, extractYamlField, findPackageTestFiles, packageExportAncestor,
  packagesForLedger, parseNodeTestFailures, parseNodeTestSummary, resolveTestScriptArgs, runPackageSuite, runPackageSuites,
} from "../scripts/run-package-suites.mjs";

function makeFixturePackage(root) {
  const packageDir = join(root, "pkg");
  const mk = (path, text) => { mkdirSync(join(packageDir, path, ".."), { recursive: true }); writeFileSync(join(packageDir, path), text); };
  mk("test/good.test.mjs", "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"passes\", () => { assert.equal(1, 1); });\n");
  mk("test/bad-assert.test.mjs", "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"fails assertion\", () => { assert.equal(1, 2); });\n");
  mk("test/bad-external.test.mjs", "import { test } from \"node:test\";\nimport { z } from \"zod-nonexistent-pkg\";\ntest(\"never runs\", () => {});\n");
  mk("test/bad-phantom.test.mjs", "import { test } from \"node:test\";\nimport { t } from \"@red-cup-engineering/nonexistent-thing/sub\";\ntest(\"never runs\", () => {});\n");
  mk("test/bad-relative.test.mjs", "import { test } from \"node:test\";\nimport { t } from \"../src/does-not-exist.mjs\";\ntest(\"never runs\", () => {});\n");
  mk("test/bad-held.test.mjs", "import { test } from \"node:test\";\nimport { t } from \"../../held-area/ghost.mjs\";\ntest(\"never runs\", () => {});\n");
  mk("test/bad-subtest-import.test.mjs", "import { test } from \"node:test\";\ntest(\"import fails inside the test body, not at load time\", async () => { await import(\"@red-cup-engineering/also-nonexistent/sub\"); });\n");
  // The bad import here is written in a helper module the test file loads, not in the test file
  // itself, so a load-time crash's diagnostic block still says only "error: 'test failed'" and the
  // crash dump's own "imported from" names the helper, not this file: classification has to pair
  // the crash to the right failing test by stream position, not by matching file paths.
  mk("src/helper-with-a-phantom-import.mjs", "import { g } from \"@red-cup-engineering/phantom-via-helper/sub\";\nexport const use = () => g;\n");
  mk("test/bad-toplevel-via-helper.test.mjs", "import { test } from \"node:test\";\nimport { use } from \"../src/helper-with-a-phantom-import.mjs\";\ntest(\"never runs\", () => { use(); });\n");
  // A mismatched named export is a load-time SyntaxError, not a module-resolution error: Node
  // prints a bare "SyntaxError: ..." crash dump with no "Cannot find ..." shape, and the failing
  // block's own diagnostics say only "error: 'test failed'" — classification has to recognize the
  // SyntaxError crash dump itself, not just the module-not-found ones.
  mk("src/named-exports.mjs", "export const bar = 1;\n");
  mk("test/bad-named-export.test.mjs", "import { test } from \"node:test\";\nimport { nope } from \"../src/named-exports.mjs\";\ntest(\"never runs\", () => { nope; });\n");
  return packageDir;
}

const heldAreas = { areas: [{ pattern: "held-area", holder: "codex", reason: "test", since: "2026-09-21" }], reachInSections: [] };

test("classifyErrorLine names an external dependency, a phantom house specifier, a held relative path, a missing relative file, a SyntaxError, and an assertion", () => {
  const root = "/repo";
  assert.equal(classifyErrorLine("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod' imported from x", { root, heldAreas }), "external:zod");
  assert.equal(classifyErrorLine("Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@red-cup-engineering/ghost' imported from x", { root, heldAreas }), "phantom:@red-cup-engineering/ghost");
  assert.equal(classifyErrorLine("Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/repo/held-area/ghost.mjs' imported from x", { root, heldAreas }), "held:held-area");
  assert.equal(classifyErrorLine("Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/repo/src/gone.mjs' imported from x", { root, heldAreas }), "missing-file:src/gone.mjs");
  assert.equal(classifyErrorLine("SyntaxError: The requested module './foo.mjs' does not provide an export named 'bar'", { root, heldAreas }), "syntax:The requested module './foo.mjs' does not provide an export named 'bar'");
  assert.equal(classifyErrorLine("AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:", { root, heldAreas }), "assertion");
  assert.equal(classifyErrorLine("TypeError: something else broke", { root, heldAreas }), "other");
});

test("findPackageTestFiles walks test/ recursively and falls back to a package.json test-script glob", () => {
  const root = mkdtempSync(join(tmpdir(), "run-suites-"));
  const packageDir = makeFixturePackage(root);
  const testFiles = findPackageTestFiles(packageDir);
  assert.equal(testFiles.length, 9);
  assert.ok(testFiles.every((file) => file.endsWith(".test.mjs")));

  const scriptOnly = join(root, "scripted");
  mkdirSync(join(scriptOnly, "alt"), { recursive: true });
  writeFileSync(join(scriptOnly, "alt", "one.test.mjs"), "import { test } from \"node:test\";\ntest(\"x\", () => {});\n");
  writeFileSync(join(scriptOnly, "package.json"), JSON.stringify({ scripts: { test: "node --test alt/*.test.mjs" } }));
  assert.deepEqual(findPackageTestFiles(scriptOnly), [join(scriptOnly, "alt", "one.test.mjs")]);

  const empty = join(root, "empty");
  mkdirSync(empty, { recursive: true });
  writeFileSync(join(empty, "package.json"), JSON.stringify({}));
  assert.deepEqual(findPackageTestFiles(empty), []);
});

test("parseNodeTestSummary reads the aggregate counters from either the legacy or the TAP reporter's prefix", () => {
  const legacy = "ℹ tests 5\nℹ suites 0\nℹ pass 1\nℹ fail 4\nℹ cancelled 0\nℹ skipped 2\nℹ todo 0\n";
  assert.deepEqual(parseNodeTestSummary(legacy), { tests: 5, pass: 1, fail: 4, skipped: 2 });
  const tap = "1..5\n# tests 5\n# suites 0\n# pass 1\n# fail 4\n# cancelled 0\n# skipped 2\n# todo 0\n";
  assert.deepEqual(parseNodeTestSummary(tap), { tests: 5, pass: 1, fail: 4, skipped: 2 });
});

test("extractYamlField reads a quoted scalar, a block scalar, and a bare value out of a TAP diagnostic block", () => {
  const yaml = "  duration_ms: 1.2\n  name: 'AssertionError'\n  error: |-\n    line one\n    \n    line two\n  code: 'ERR_ASSERTION'\n";
  assert.equal(extractYamlField(yaml, "name"), "AssertionError");
  assert.equal(extractYamlField(yaml, "error"), "line one\n\nline two");
  assert.equal(extractYamlField(yaml, "code"), "ERR_ASSERTION");
  assert.equal(extractYamlField(yaml, "missing"), undefined);
});

test("runPackageSuite classifies every kind of failure from a real node --test run, including an import that fails inside a subtest rather than at load time", () => {
  const root = mkdtempSync(join(tmpdir(), "run-suites-"));
  const packageDir = makeFixturePackage(root);
  const report = runPackageSuite(packageDir, { root, heldAreas });
  assert.equal(report.package, "pkg");
  assert.equal(report.pass, 1);
  assert.equal(report.fail, 8);
  assert.equal(report.skipped, 0);
  const byFile = Object.fromEntries(report.failures.map((failure) => [failure.file, failure]));
  assert.equal(byFile["pkg/test/bad-assert.test.mjs"].cause, "assertion");
  assert.equal(byFile["pkg/test/bad-external.test.mjs"].cause, "external:zod-nonexistent-pkg");
  assert.equal(byFile["pkg/test/bad-phantom.test.mjs"].cause, "phantom:@red-cup-engineering/nonexistent-thing");
  assert.equal(byFile["pkg/test/bad-relative.test.mjs"].cause, "missing-file:pkg/src/does-not-exist.mjs");
  assert.equal(byFile["pkg/test/bad-held.test.mjs"].cause, "held:held-area");
  const subtestFailure = byFile["pkg/test/bad-subtest-import.test.mjs"];
  assert.equal(subtestFailure.cause, "phantom:@red-cup-engineering/also-nonexistent", "an import error raised inside the running test, not at file load, still names the phantom specifier instead of falling back to 'test failed'");
  assert.notEqual(subtestFailure.detail, "test failed");
  const viaHelper = byFile["pkg/test/bad-toplevel-via-helper.test.mjs"];
  assert.equal(viaHelper.cause, "phantom:@red-cup-engineering/phantom-via-helper", "the crashed file's own diagnostic block only says 'test failed'; the real cause comes from the transitive dependency's crash dump, paired by position rather than by file path");
  assert.notEqual(viaHelper.detail, "test failed");
  assert.ok(subtestFailure.detail.includes("also-nonexistent"));
  const namedExportFailure = byFile["pkg/test/bad-named-export.test.mjs"];
  assert.equal(namedExportFailure.cause, "syntax:The requested module '../src/named-exports.mjs' does not provide an export named 'nope'", "a mismatched named export is a load-time SyntaxError, not 'other' with detail 'test failed'");
  assert.notEqual(namedExportFailure.detail, "test failed");
  assert.ok(namedExportFailure.detail.includes("does not provide an export named 'nope'"));
});

test("runPackageSuite reports an empty suite for a package with no test files", () => {
  const root = mkdtempSync(join(tmpdir(), "run-suites-"));
  const packageDir = join(root, "empty-pkg");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({}));
  assert.deepEqual(runPackageSuite(packageDir, { root, heldAreas }), { package: "empty-pkg", pass: 0, fail: 0, skipped: 0, failures: [], script: "absent" });
});

test("resolveTestScriptArgs runs a plain `node --test ...` script's own file arguments, resolving a glob itself; it refuses shell composition, an external runner, an unresolvable glob, and a bare directory argument", () => {
  const root = mkdtempSync(join(tmpdir(), "run-suites-script-"));
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "test", "a.test.mjs"), "import { test } from \"node:test\";\ntest(\"x\", () => {});\n");
  writeFileSync(join(root, "test", "b.test.mjs"), "import { test } from \"node:test\";\ntest(\"x\", () => {});\n");

  const glob = resolveTestScriptArgs(root, "node --test test/*.test.mjs");
  assert.equal(glob.ok, true);
  assert.deepEqual(glob.files.sort(), [join(root, "test", "a.test.mjs"), join(root, "test", "b.test.mjs")]);

  const singleFile = resolveTestScriptArgs(root, "node --test test/a.test.mjs");
  assert.deepEqual(singleFile, { ok: true, files: [join(root, "test", "a.test.mjs")] });

  const shellComposed = resolveTestScriptArgs(root, "node --test test/*.test.mjs && echo done");
  assert.equal(shellComposed.ok, false);
  assert.ok(shellComposed.detail.includes("shell-composed"));

  const externalRunner = resolveTestScriptArgs(root, "npx vitest run");
  assert.equal(externalRunner.ok, false);
  assert.ok(externalRunner.detail.includes("external test runner"));

  const unresolvableGlob = resolveTestScriptArgs(root, "node --test test/*.spec.mjs");
  assert.equal(unresolvableGlob.ok, false);
  assert.ok(unresolvableGlob.detail.includes("unresolvable glob"));

  const directoryArgument = resolveTestScriptArgs(root, "node --test test/");
  assert.equal(directoryArgument.ok, false);
  assert.ok(directoryArgument.detail.includes("directory argument"));
});

test("resolveTestScriptArgs strips a script author's quoting around a glob and resolves a \"**\" recursive segment, the two real forms a gate run over the house's own manifest-norms ledger found this script's first version missed", () => {
  const root = mkdtempSync(join(tmpdir(), "run-suites-script-glob-"));
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("src/nested/deep/a.test.mjs", "import { test } from \"node:test\";\ntest(\"x\", () => {});\n");
  mk("src/b.test.mjs", "import { test } from \"node:test\";\ntest(\"x\", () => {});\n");

  const doubleQuoted = resolveTestScriptArgs(root, 'node --test "src/**/*.test.mjs"');
  assert.equal(doubleQuoted.ok, true, "the surrounding double quotes are stripped before the pattern is resolved");
  assert.deepEqual(doubleQuoted.files.sort(), [join(root, "src", "b.test.mjs"), join(root, "src", "nested", "deep", "a.test.mjs")]);

  const singleQuoted = resolveTestScriptArgs(root, "node --test 'src/**/*.test.mjs'");
  assert.equal(singleQuoted.ok, true, "single quotes are stripped the same way");
  assert.deepEqual(singleQuoted.files.sort(), doubleQuoted.files.sort());

  const unquotedDoubleStar = resolveTestScriptArgs(root, "node --test src/**/*.test.mjs");
  assert.equal(unquotedDoubleStar.ok, true, "\"**\" resolves the same way whether or not the script author quoted it");
  assert.deepEqual(unquotedDoubleStar.files.sort(), doubleQuoted.files.sort());

  const noMatch = resolveTestScriptArgs(root, 'node --test "src/**/*.spec.mjs"');
  assert.equal(noMatch.ok, false, "a genuinely unmatched \"**\" pattern is still an unresolvable glob, not silently empty");
  assert.ok(noMatch.detail.includes("unresolvable glob"));
});

test("runPackageSuite runs a package's own standard glob test script directly (not by walking test/ itself) and reports script: \"used\"", () => {
  const root = mkdtempSync(join(tmpdir(), "run-suites-script-"));
  const packageDir = join(root, "standard-script-pkg");
  const mk = (path, text) => { mkdirSync(join(packageDir, path, ".."), { recursive: true }); writeFileSync(join(packageDir, path), text); };
  mk("test/one.test.mjs", "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"one\", () => { assert.equal(1, 1); });\n");
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ scripts: { test: "node --test test/*.test.mjs" } }));

  const report = runPackageSuite(packageDir, { root, heldAreas });
  assert.equal(report.script, "used");
  assert.equal(report.pass, 1);
  assert.equal(report.fail, 0);
  assert.deepEqual(report.failures, []);
});

test("runPackageSuite catches a package.json test script written as node 24's refused bare-directory form (`node --test test/`, ERR_UNSUPPORTED_DIR_IMPORT) as a test-script suite failure, while still walking test/ itself so the real tests are counted", () => {
  const root = mkdtempSync(join(tmpdir(), "run-suites-script-"));
  const packageDir = join(root, "bare-directory-script-pkg");
  const mk = (path, text) => { mkdirSync(join(packageDir, path, ".."), { recursive: true }); writeFileSync(join(packageDir, path), text); };
  mk("test/one.test.mjs", "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"one\", () => { assert.equal(1, 1); });\n");
  // The broken form this fixes: `findPackageTestFiles` would have walked test/ and run it fine,
  // never noticing that the package's own declared script (`npm test`) cannot start at all.
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ scripts: { test: "node --test test/" } }));

  const report = runPackageSuite(packageDir, { root, heldAreas });
  assert.equal(report.script, "used");
  assert.equal(report.pass, 1, "the real test file, found by walking test/, still ran and passed");
  assert.equal(report.fail, 1, "the broken test script itself counts as one failure");
  const scriptFailure = report.failures.find((failure) => failure.cause.startsWith("test-script:"));
  assert.ok(scriptFailure, "the broken script is reported as a suite failure");
  assert.ok(scriptFailure.cause.includes("directory argument"));
  assert.equal(scriptFailure.file, "bare-directory-script-pkg");
});

test("runPackageSuite reports a test-script failure for a package.json test script naming an external runner, while still walking and counting test/", () => {
  const root = mkdtempSync(join(tmpdir(), "run-suites-script-"));
  const packageDir = join(root, "external-runner-script-pkg");
  const mk = (path, text) => { mkdirSync(join(packageDir, path, ".."), { recursive: true }); writeFileSync(join(packageDir, path), text); };
  mk("test/one.test.mjs", "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"one\", () => { assert.equal(1, 1); });\n");
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));

  const report = runPackageSuite(packageDir, { root, heldAreas });
  assert.equal(report.script, "used");
  assert.equal(report.pass, 1);
  assert.equal(report.fail, 1);
  const scriptFailure = report.failures.find((failure) => failure.cause.startsWith("test-script:"));
  assert.ok(scriptFailure.cause.includes("external test runner"));
});

function makeGitRepo() {
  const root = mkdtempSync(join(tmpdir(), "run-suites-ref-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  writeFileSync(join(root, "README"), "empty repo, no package yet\n");
  git("add", "-A");
  git("commit", "-q", "-m", "before the package existed");
  const beforePackage = git("rev-parse", "HEAD").trim();
  return { root, git, beforePackage };
}

test("exportPackageAtRef exports a tracked directory read-only via git archive, and reports undefined for a ref where it does not exist", () => {
  const { root, git, beforePackage } = makeGitRepo();
  mkdirSync(join(root, "lib/x/pkg/test"), { recursive: true });
  writeFileSync(join(root, "lib/x/pkg/test/one.test.mjs"), "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"one\", () => { assert.equal(1, 1); });\n");
  git("add", "-A");
  git("commit", "-q", "-m", "add pkg");

  const exported = exportPackageAtRef(root, "lib/x/pkg", "HEAD");
  assert.ok(exported, "the directory exists at HEAD");
  const exportedText = execFileSync("cat", [join(exported.dir, "test/one.test.mjs")], { encoding: "utf8" });
  assert.ok(exportedText.includes("assert.equal(1, 1)"));
  exported.cleanup();

  assert.equal(exportPackageAtRef(root, "lib/x/pkg", beforePackage), undefined, "the package did not exist at that earlier ref");
});

test("runPackageSuite with --ref runs the package as it was recorded at that ref, unaffected by later working-tree edits", () => {
  const { root, git, beforePackage } = makeGitRepo();
  mkdirSync(join(root, "lib/x/pkg/test"), { recursive: true });
  writeFileSync(join(root, "lib/x/pkg/test/one.test.mjs"), "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"one\", () => { assert.equal(1, 1); });\n");
  git("add", "-A");
  git("commit", "-q", "-m", "add a passing pkg");
  const cleanRef = git("rev-parse", "HEAD").trim();

  writeFileSync(join(root, "lib/x/pkg/test/one.test.mjs"), "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"one\", () => { assert.equal(1, 2); });\n");

  const packageDir = join(root, "lib/x/pkg");
  const now = runPackageSuite(packageDir, { root, heldAreas });
  assert.equal(now.pass, 0);
  assert.equal(now.fail, 1);

  const atRef = runPackageSuite(packageDir, { root, heldAreas, ref: cleanRef });
  assert.equal(atRef.package, "lib/x/pkg");
  assert.equal(atRef.pass, 1, "the ref export ran the committed, still-passing version, not the dirty working tree");
  assert.equal(atRef.fail, 0);

  const atRootRef = runPackageSuite(packageDir, { root, heldAreas, ref: beforePackage });
  assert.deepEqual(atRootRef, { package: "lib/x/pkg", pass: 0, fail: 0, skipped: 0, failures: [], script: "absent" }, "a package absent at the ref reports an empty baseline");
});

test("packageExportAncestor is the package itself with no relative import leaving it, widens to the common ancestor with a sibling a relative import does reach, and clamps at EXPORT_ANCESTOR_CAP rather than rising above it", () => {
  const { root, git } = makeGitRepo();
  mkdirSync(join(root, "lib/x/pkg/test"), { recursive: true });
  writeFileSync(join(root, "lib/x/pkg/test/self.test.mjs"), "import { test } from \"node:test\";\ntest(\"x\", () => {});\n");
  git("add", "-A");
  git("commit", "-q", "-m", "self-contained pkg");
  assert.equal(packageExportAncestor(root, "lib/x/pkg", "HEAD"), "lib/x/pkg", "no relative import leaves the package, so no wider export is needed");

  mkdirSync(join(root, "lib/x/sibling"), { recursive: true });
  writeFileSync(join(root, "lib/x/sibling/fixture.mjs"), "export const fixture = 1;\n");
  writeFileSync(join(root, "lib/x/pkg/test/self.test.mjs"), "import { test } from \"node:test\";\nimport { fixture } from \"../../sibling/fixture.mjs\";\ntest(\"x\", () => { fixture; });\n");
  git("add", "-A");
  git("commit", "-q", "-m", "pkg's test now reaches a sibling section");
  assert.equal(packageExportAncestor(root, "lib/x/pkg", "HEAD"), "lib/x", "widened to the common ancestor of pkg and the sibling its test reaches");

  // A package living under the real cap, reaching (via enough ".." segments) above it: the export
  // ancestor must not rise past EXPORT_ANCESTOR_CAP even though the raw common ancestor would.
  const cappedPackage = `${EXPORT_ANCESTOR_CAP}/services/engineering-services-section/services/some-section`;
  mkdirSync(join(root, cappedPackage, "test"), { recursive: true });
  writeFileSync(join(root, cappedPackage, "test/reach.test.mjs"), "import { test } from \"node:test\";\nimport { outside } from \"../../../../../../outside-the-cap/thing.mjs\";\ntest(\"x\", () => { outside; });\n");
  git("add", "-A");
  git("commit", "-q", "-m", "a package reaching above the cap");
  assert.equal(packageExportAncestor(root, cappedPackage, "HEAD"), EXPORT_ANCESTOR_CAP);
});

test("packageExportAncestor masks a comment holding an import-shaped line before scanning, so only the real import beside it widens the ancestor", () => {
  const { root, git } = makeGitRepo();
  mkdirSync(join(root, "lib/x/pkg/test"), { recursive: true });
  mkdirSync(join(root, "lib/x/sibling"), { recursive: true });
  writeFileSync(join(root, "lib/x/sibling/fixture.mjs"), "export const fixture = 1;\n");
  // The dynamic-import alternative in SPECIFIER is unanchored, so it reads inside a "//" comment
  // too when the text is not masked first: a raw scan would see the far-reaching import() here as
  // a real edge and widen the ancestor all the way to "lib", not just to "lib/x".
  writeFileSync(
    join(root, "lib/x/pkg/test/self.test.mjs"),
    "import { test } from \"node:test\";\n"
    + "// import(\"../../../different-branch/ghost.mjs\") -- documentation only, not real code\n"
    + "import { fixture } from \"../../sibling/fixture.mjs\";\n"
    + "test(\"x\", () => { fixture; });\n",
  );
  git("add", "-A");
  git("commit", "-q", "-m", "pkg's test has a commented-out reach beside a real one");
  assert.equal(
    packageExportAncestor(root, "lib/x/pkg", "HEAD"),
    "lib/x",
    "the commented-out import() is masked out; only the real import to the sibling widens the ancestor",
  );
});

test("run-package-suites at --ref no longer strands a package whose test files reach a sibling section by a relative import: the sibling resolves inside the wider export instead of 404ing", () => {
  const { root, git } = makeGitRepo();
  mkdirSync(join(root, "lib/x/pkg/test"), { recursive: true });
  mkdirSync(join(root, "lib/x/sibling"), { recursive: true });
  writeFileSync(join(root, "lib/x/sibling/fixture.mjs"), "export const fixture = 41;\n");
  writeFileSync(
    join(root, "lib/x/pkg/test/reach.test.mjs"),
    "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { fixture } from \"../../sibling/fixture.mjs\";\ntest(\"reaches the sibling\", () => { assert.equal(fixture + 1, 42); });\n",
  );
  git("add", "-A");
  git("commit", "-q", "-m", "pkg's test reaches a sibling section");
  const ref = git("rev-parse", "HEAD").trim();

  const packageDir = join(root, "lib/x/pkg");
  const atRef = runPackageSuite(packageDir, { root, heldAreas, ref });
  assert.equal(atRef.fail, 0, "exporting only lib/x/pkg would 404 on ../../sibling/fixture.mjs and report this test as failing/fixed, not run");
  assert.equal(atRef.pass, 1);

  // Exercised through runPackageSuites too, where a shared ref-export cache serves this package and
  // a second one whose test reaches the very same sibling, so both need the very same (ref,
  // ancestor) export rather than each re-archiving "lib/x" for itself.
  mkdirSync(join(root, "lib/x/other-pkg/test"), { recursive: true });
  writeFileSync(
    join(root, "lib/x/other-pkg/test/reach.test.mjs"),
    "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { fixture } from \"../../sibling/fixture.mjs\";\ntest(\"also reaches the sibling\", () => { assert.equal(fixture, 41); });\n",
  );
  git("add", "-A");
  git("commit", "-q", "-m", "a second package that reaches the same sibling");
  const secondRef = git("rev-parse", "HEAD").trim();
  const [first, second] = runPackageSuites({ packages: [packageDir, join(root, "lib/x/other-pkg")], root, heldAreas, ref: secondRef });
  assert.equal(first.fail, 0);
  assert.equal(first.pass, 1);
  assert.equal(second.fail, 0);
  assert.equal(second.pass, 1);
});

test("packagesForLedger reuses owningPackage over the ledger's normalized paths", () => {
  const root = mkdtempSync(join(tmpdir(), "run-suites-"));
  mkdirSync(join(root, "lib/x/one/src"), { recursive: true });
  mkdirSync(join(root, "lib/x/two/src"), { recursive: true });
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "lib/x/one/src/a.mjs\nlib/x/one/src/b.mjs\nlib/x/two/src/c.mjs\n");
  const map = { packages: { "@x/one": "lib/x/one", "@x/two": "lib/x/two" } };
  assert.deepEqual(packagesForLedger(ledgerFile, root, map).sort(), ["lib/x/one", "lib/x/two"]);
});

test("parseNodeTestFailures returns [] when the output has no failing-tests section", () => {
  assert.deepEqual(parseNodeTestFailures("ℹ tests 1\nℹ pass 1\nℹ fail 0\n", { root: "/repo", packageDir: "/repo/pkg", heldAreas }), []);
});
