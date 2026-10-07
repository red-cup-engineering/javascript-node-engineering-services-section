import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditPhantomImports, classifySpecifier, exportsSubpath, resolvesThroughServedProjection, resolvesToFile } from "../scripts/audit-phantom-imports.mjs";
import { HOUSE_TREE_DIRECTORY } from "../scripts/export-house-tree-at-ref.mjs";

test("exportsSubpath matches an exact key and a single-star pattern, and refuses everything else", () => {
  assert.equal(exportsSubpath({ "./operation": "./src/operation.mjs" }, "operation"), true);
  assert.equal(exportsSubpath({ "./operation": "./src/operation.mjs" }, "missing"), false);
  assert.equal(exportsSubpath({ "./services/*": "./src/services/*.mjs" }, "services/a/b"), true);
  assert.equal(exportsSubpath({ "./services/*": "./src/services/*.mjs" }, "other/a"), false);
});

function makeTree() {
  const root = mkdtempSync(join(tmpdir(), "audit-phantom-"));
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/a/pkg-with-exports/package.json", JSON.stringify({ exports: { "./thing": "./src/thing.mjs" } }));
  mk("lib/a/pkg-with-exports/src/thing.mjs", "export const thing = 1;\n");
  mk("lib/a/pkg-no-exports/package.json", JSON.stringify({}));
  mk("lib/a/pkg-no-exports/src/real.mjs", "export const real = 1;\n");
  mk(
    "lib/a/importer/src/a.mjs",
    [
      "import { thing } from \"@red-cup-engineering/pkg-with-exports/thing\";",
      "import { ghost } from \"@red-cup-engineering/pkg-with-exports/ghost\";",
      "import { real } from \"@red-cup-engineering/pkg-no-exports/src/real\";",
      "import { real2 } from \"@red-cup-engineering/pkg-no-exports/src/real.mjs\";",
      "import { gone } from \"@red-cup-engineering/pkg-no-exports/src/gone\";",
      "import { nothing } from \"@red-cup-engineering/does-not-exist/anything\";",
      "import { plain } from \"@red-cup-engineering/does-not-exist\";",
      "import { sibling } from \"../../pkg-no-exports/src/real.mjs\";",
      "import { missing } from \"./missing.mjs\";",
      "import { z } from \"zod\";",
      "import fs from \"node:fs\";",
      "",
    ].join("\n"),
  );
  const map = { packages: { "@red-cup-engineering/pkg-with-exports": "lib/a/pkg-with-exports", "@red-cup-engineering/pkg-no-exports": "lib/a/pkg-no-exports", "@red-cup-engineering/importer": "lib/a/importer" } };
  return { root, map };
}

test("classifySpecifier: house package missing from the map is no-package", () => {
  const { root, map } = makeTree();
  assert.deepEqual(classifySpecifier("@red-cup-engineering/does-not-exist/anything", "lib/a/importer/src/a.mjs", root, map), { specifier: "@red-cup-engineering/does-not-exist/anything", cause: "no-package" });
  assert.equal(classifySpecifier("@red-cup-engineering/does-not-exist", "lib/a/importer/src/a.mjs", root, map).cause, "no-package");
});

test("classifySpecifier: an unexported subpath on a package with exports is no-export, an exported one passes", () => {
  const { root, map } = makeTree();
  assert.deepEqual(classifySpecifier("@red-cup-engineering/pkg-with-exports/ghost", "lib/a/importer/src/a.mjs", root, map), { specifier: "@red-cup-engineering/pkg-with-exports/ghost", cause: "no-export", package: "@red-cup-engineering/pkg-with-exports" });
  assert.equal(classifySpecifier("@red-cup-engineering/pkg-with-exports/thing", "lib/a/importer/src/a.mjs", root, map), undefined);
});

test("classifySpecifier: a package with no exports field falls back to checking the file, with and without a suffix", () => {
  const { root, map } = makeTree();
  assert.equal(classifySpecifier("@red-cup-engineering/pkg-no-exports/src/real", "lib/a/importer/src/a.mjs", root, map), undefined, "resolves via the .mjs suffix");
  assert.equal(classifySpecifier("@red-cup-engineering/pkg-no-exports/src/real.mjs", "lib/a/importer/src/a.mjs", root, map), undefined, "resolves as given");
  assert.deepEqual(classifySpecifier("@red-cup-engineering/pkg-no-exports/src/gone", "lib/a/importer/src/a.mjs", root, map), { specifier: "@red-cup-engineering/pkg-no-exports/src/gone", cause: "no-file", package: "@red-cup-engineering/pkg-no-exports" });
});

test("classifySpecifier: a relative specifier resolves against the importer's directory, and an external or node: specifier is ignored", () => {
  const { root, map } = makeTree();
  assert.equal(classifySpecifier("../../pkg-no-exports/src/real.mjs", "lib/a/importer/src/a.mjs", root, map), undefined);
  assert.deepEqual(classifySpecifier("./missing.mjs", "lib/a/importer/src/a.mjs", root, map), { specifier: "./missing.mjs", cause: "no-file" });
  assert.equal(classifySpecifier("zod", "lib/a/importer/src/a.mjs", root, map), undefined);
  assert.equal(classifySpecifier("node:fs", "lib/a/importer/src/a.mjs", root, map), undefined);
});

test("classifySpecifier: a no-file relative specifier is held-untracked (not no-file) when its resolved target lies in a held area, and unchanged when neither importer nor target does", () => {
  const { root, map } = makeTree();
  const heldAreas = { areas: [{ pattern: "held-area" }] };
  assert.deepEqual(
    classifySpecifier("./missing.mjs", "lib/a/importer/src/a.mjs", root, map, undefined, heldAreas),
    { specifier: "./missing.mjs", cause: "no-file" },
    "neither the importer nor the resolved target lies in a held area",
  );
  assert.deepEqual(
    classifySpecifier("../held-area/ghost.mjs", "lib/a/importer/src/a.mjs", root, map, undefined, heldAreas),
    { specifier: "../held-area/ghost.mjs", cause: "held-untracked" },
    "the resolved target lies in the held area",
  );
  assert.deepEqual(
    classifySpecifier("./missing.mjs", "lib/a/held-area/src/a.mjs", root, map, undefined, heldAreas),
    { specifier: "./missing.mjs", cause: "held-untracked" },
    "the importer itself lies in the held area, even though the target's own path does not",
  );
});

test("classifySpecifier: a no-file house-scoped subpath is held-untracked when the importer or the resolved package-relative target lies in a held area", () => {
  const { root, map } = makeTree();
  const heldAreas = { areas: [{ pattern: "^lib/a/importer" }] };
  assert.deepEqual(
    classifySpecifier("@red-cup-engineering/pkg-no-exports/src/gone", "lib/a/importer/src/a.mjs", root, map, undefined, heldAreas),
    { specifier: "@red-cup-engineering/pkg-no-exports/src/gone", cause: "held-untracked", package: "@red-cup-engineering/pkg-no-exports" },
  );
  assert.deepEqual(
    classifySpecifier("@red-cup-engineering/pkg-no-exports/src/gone", "lib/a/importer/src/a.mjs", root, map),
    { specifier: "@red-cup-engineering/pkg-no-exports/src/gone", cause: "no-file", package: "@red-cup-engineering/pkg-no-exports" },
    "without heldAreas, behaviour is unchanged",
  );
});

test("auditPhantomImports walks lib and dev, finds every phantom import once, and censuses by cause and by importing package", () => {
  const { root, map } = makeTree();
  const report = auditPhantomImports({ root, map });
  assert.equal(report.findings.length, 5, "ghost export, gone file, two no-package specifiers, and the missing relative file");
  const causes = report.findings.map((finding) => finding.cause).sort();
  assert.deepEqual(causes, ["no-export", "no-file", "no-file", "no-package", "no-package"]);
  assert.deepEqual(report.census.byCause, { "no-export": 1, "no-package": 2, "no-file": 2 });
  assert.deepEqual(report.census.byPackage, { "@red-cup-engineering/importer": 5 });
  const goneFinding = report.findings.find((finding) => finding.specifier.endsWith("/gone"));
  assert.deepEqual(goneFinding, { importer: "lib/a/importer/src/a.mjs", specifier: "@red-cup-engineering/pkg-no-exports/src/gone", cause: "no-file", package: "@red-cup-engineering/pkg-no-exports" });
});

test("auditPhantomImports does not count a phantom-looking specifier written into a JSDoc type reference, a comment, or a template literal -- only a real import is a finding", () => {
  const root = mkdtempSync(join(tmpdir(), "audit-phantom-comments-"));
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk(
    "lib/a/importer/src/a.mjs",
    [
      '/** @param {import("@red-cup-engineering/does-not-exist/anything").Thing} value */',
      '/*',
      'import { ghost } from "@red-cup-engineering/does-not-exist/anything";',
      '*/',
      'const doc = `import { ghost } from "@red-cup-engineering/does-not-exist/anything"`;',
      '// import { ghost } from "@red-cup-engineering/does-not-exist/anything"',
      'import { real } from "@red-cup-engineering/does-not-exist/anything";',
      '',
    ].join("\n"),
  );
  const map = { packages: {} };
  const report = auditPhantomImports({ root, map, walkRoots: ["lib"] });
  assert.equal(report.findings.length, 1, "the JSDoc reference, block comment, template literal, and line comment each contributed nothing; only the real import is a finding");
  assert.equal(report.findings[0].cause, "no-package");
});

test("auditPhantomImports honours --package by scoping the walk to one directory", () => {
  const { root, map } = makeTree();
  const scoped = auditPhantomImports({ root, map, walkRoots: ["lib/a/pkg-with-exports"] });
  assert.equal(scoped.findings.length, 0, "the exports-holding package itself has no phantom imports");
});

test("auditPhantomImports skips a *.test.* file and anything under a test/ directory by default, and --include-tests scans them", () => {
  const { root, map } = makeTree();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/a/importer/importer.test.mjs", "import { ghost } from \"@red-cup-engineering/does-not-exist-either\";\n");
  mk("lib/a/importer/test/fixtures/lattice.mjs", "import { ghost } from \"@red-cup-engineering/also-fixture-only\";\n");
  const excluded = auditPhantomImports({ root, map });
  assert.equal(excluded.findings.length, 5, "the two test-only files contribute nothing by default");
  assert.ok(!excluded.findings.some((finding) => finding.specifier.includes("fixture-only") || finding.specifier.includes("does-not-exist-either")));

  const included = auditPhantomImports({ root, map, includeTests: true });
  assert.equal(included.findings.length, 7, "with --include-tests, both fixture files are scanned too");
});

test("the CLI prints JSON and --summary collapses to counts", () => {
  const { root, map } = makeTree();
  const scriptPath = fileURLToPath(new URL("../scripts/audit-phantom-imports.mjs", import.meta.url));
  const mapPath = join(root, "map.json");
  writeFileSync(mapPath, JSON.stringify(map));
  const full = spawnSync(process.execPath, [scriptPath, "--root", root, "--map", mapPath], { encoding: "utf8" });
  assert.equal(full.status, 0, full.stderr);
  const fullReport = JSON.parse(full.stdout);
  assert.equal(fullReport.findings.length, 5);

  const summary = spawnSync(process.execPath, [scriptPath, "--root", root, "--map", mapPath, "--summary"], { encoding: "utf8" });
  assert.equal(summary.status, 0, summary.stderr);
  assert.deepEqual(JSON.parse(summary.stdout), { findings: 5, census: fullReport.census });
});

test("auditPhantomImports --ref audits a git-archived export of lib/emsenn/services/561-group at that ref instead of the working tree, resolving the map's directories under the export's temp root", () => {
  const root = mkdtempSync(join(tmpdir(), "audit-phantom-ref-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk(`${HOUSE_TREE_DIRECTORY}/pkg/package.json`, JSON.stringify({}));
  mk(`${HOUSE_TREE_DIRECTORY}/pkg/src/real.mjs`, "export const real = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "clean tree");
  const cleanRef = git("rev-parse", "HEAD").trim();

  // Dirty the working tree only, with a phantom import the committed ref never had.
  writeFileSync(join(root, `${HOUSE_TREE_DIRECTORY}/pkg/src/real.mjs`), "import { ghost } from \"@red-cup-engineering/does-not-exist\";\nexport const real = 1;\n");
  const map = { packages: { "@red-cup-engineering/pkg": `${HOUSE_TREE_DIRECTORY}/pkg` } };

  const workingTree = auditPhantomImports({ root, map, walkRoots: ["lib"] });
  assert.equal(workingTree.findings.length, 1, "the working tree has the phantom import");

  const atRef = auditPhantomImports({ root, map, walkRoots: ["lib"], ref: cleanRef });
  assert.equal(atRef.findings.length, 0, "the ref export reflects the committed, clean tree, not the dirty working tree");
});

test("auditPhantomImports --ref reports held-untracked (not no-file) for a relative import whose target lies in a held area — the target being untracked and absent at the ref, exactly like another hand's own in-flight file", () => {
  const root = mkdtempSync(join(tmpdir(), "audit-phantom-ref-held-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk(`${HOUSE_TREE_DIRECTORY}/pkg/package.json`, JSON.stringify({}));
  // The importer is committed; the file it reaches for, inside a held area, never was — the target
  // is untracked in the working tree (it simply does not exist anywhere in this fixture) and, since
  // only committed content is archived, absent at the ref too.
  mk(`${HOUSE_TREE_DIRECTORY}/pkg/src/uses-held.mjs`, "import { held } from \"../../hive-something/src/held.mjs\";\nexport const uses = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "importer committed; the held target it reaches for was never tracked at all");
  const ref = git("rev-parse", "HEAD").trim();

  const map = { packages: { "@red-cup-engineering/pkg": `${HOUSE_TREE_DIRECTORY}/pkg` } };
  const heldAreas = { areas: [{ pattern: "(^|/)hive-" }] };

  const withoutHeldAreas = auditPhantomImports({ root, map, walkRoots: ["lib"], ref });
  assert.equal(withoutHeldAreas.findings.length, 1);
  assert.equal(withoutHeldAreas.findings[0].cause, "no-file", "without heldAreas, the missing target reads as an ordinary broken import");

  const withHeldAreas = auditPhantomImports({ root, map, walkRoots: ["lib"], ref, heldAreas });
  assert.equal(withHeldAreas.findings.length, 1);
  assert.equal(withHeldAreas.findings[0].cause, "held-untracked", "with heldAreas, the same finding is separated out as another hand's untracked work, not a real break");
  assert.equal(withHeldAreas.findings[0].specifier, "../../hive-something/src/held.mjs");
  assert.deepEqual(withHeldAreas.census.byCause, { "held-untracked": 1 });
});

test("auditPhantomImports --ref reports no findings (not an error) when the ref does not exist", () => {
  const root = mkdtempSync(join(tmpdir(), "audit-phantom-ref-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const map = { packages: {} };
  const report = auditPhantomImports({ root, map, ref: "0000000000000000000000000000000000000000" });
  assert.deepEqual(report, { findings: [], census: { byCause: {}, byPackage: {} } });
});

function makeServedProjectionTree(servedProjections) {
  const root = mkdtempSync(join(tmpdir(), "audit-phantom-served-"));
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/a/pkg/package.json", JSON.stringify({ name: "@red-cup-engineering/pkg", servedProjections }));
  mk("lib/a/pkg/src/checker.mjs", "export function check() { return true; }\n");
  return { root, map: { packages: { "@red-cup-engineering/pkg": "lib/a/pkg" } } };
}

test("resolvesThroughServedProjection: a directory projection resolves a served specifier through its source, extension-agnostic", () => {
  const { root } = makeServedProjectionTree([{ from: "src", to: "web/js/vendor/src" }]);
  const target = join(root, "lib/a/pkg/web/js/vendor/src/checker.js");
  assert.equal(resolvesThroughServedProjection(root, "lib/a/pkg", target), true);
});

test("resolvesThroughServedProjection: a file-to-file projection resolves an exact served path", () => {
  const { root } = makeServedProjectionTree([{ from: "src/checker.mjs", to: "public/js/checker.js" }]);
  const target = join(root, "lib/a/pkg/public/js/checker.js");
  assert.equal(resolvesThroughServedProjection(root, "lib/a/pkg", target), true);
});

test("resolvesThroughServedProjection: false when no projection's `to` prefix matches the target", () => {
  const { root } = makeServedProjectionTree([{ from: "src", to: "web/js/vendor/src" }]);
  const target = join(root, "lib/a/pkg/somewhere/else/checker.js");
  assert.equal(resolvesThroughServedProjection(root, "lib/a/pkg", target), false);
});

test("resolvesThroughServedProjection: false when the projected-from source still does not exist on disk", () => {
  const { root } = makeServedProjectionTree([{ from: "src", to: "web/js/vendor/src" }]);
  const target = join(root, "lib/a/pkg/web/js/vendor/src/absent.js");
  assert.equal(resolvesThroughServedProjection(root, "lib/a/pkg", target), false);
});

test("resolvesThroughServedProjection: false with no servedProjections declared, and false for a target outside the package", () => {
  const { root } = makeServedProjectionTree(undefined);
  assert.equal(resolvesThroughServedProjection(root, "lib/a/pkg", join(root, "lib/a/pkg/web/js/vendor/src/checker.js")), false);
  const { root: projectedRoot } = makeServedProjectionTree([{ from: "src", to: "web/js/vendor/src" }]);
  assert.equal(resolvesThroughServedProjection(projectedRoot, "lib/a/pkg", join(projectedRoot, "lib/b/other/checker.js")), false);
});

test("classifySpecifier: a relative specifier that fails to resolve directly resolves through the owning package's servedProjections when given its directory", () => {
  const { root, map } = makeServedProjectionTree([{ from: "src", to: "web/js/vendor/src" }]);
  assert.equal(classifySpecifier("./vendor/src/checker.js", "lib/a/pkg/web/js/app.js", root, map, "lib/a/pkg"), undefined);
  assert.deepEqual(
    classifySpecifier("./vendor/src/absent.js", "lib/a/pkg/web/js/app.js", root, map, "lib/a/pkg"),
    { specifier: "./vendor/src/absent.js", cause: "no-file" },
    "still phantom when even the projected source is missing",
  );
  assert.deepEqual(
    classifySpecifier("./vendor/src/checker.js", "lib/a/pkg/web/js/app.js", root, map),
    { specifier: "./vendor/src/checker.js", cause: "no-file" },
    "without a packageDirectory, servedProjections is never consulted (unchanged prior behaviour)",
  );
});

test("auditPhantomImports resolves a served-directory relative import through the owning package's declared servedProjections", () => {
  const root = mkdtempSync(join(tmpdir(), "audit-phantom-served-tree-"));
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/a/pkg/package.json", JSON.stringify({ name: "@red-cup-engineering/pkg", servedProjections: [{ from: "src", to: "web/js/vendor/src" }] }));
  mk("lib/a/pkg/src/checker.mjs", "export function check() { return true; }\n");
  mk("lib/a/pkg/web/js/app.js", "import { check } from './vendor/src/checker.js';\nimport { gone } from './vendor/src/gone.js';\n");
  const map = { packages: { "@red-cup-engineering/pkg": "lib/a/pkg" } };
  const report = auditPhantomImports({ root, map, walkRoots: ["lib"] });
  assert.equal(report.findings.length, 1, "checker.js resolves through the projection; gone.js does not exist even projected, and stays phantom");
  assert.equal(report.findings[0].specifier, "./vendor/src/gone.js");
});
