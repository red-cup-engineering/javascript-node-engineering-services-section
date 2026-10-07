import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import {
  foldOneFilePackage,
  inspectOneFilePackage,
  packageStem,
  withoutExtension,
  boringPackageName,
  resolveDestination,
  resolveRelativeSource,
  rewriteMovedSpecifiers,
  rewriteImporterSpecifiers,
  findSection,
  collectCompanionFiles,
  resolveCompanionDestination,
} from "../scripts/fold-one-file-package.mjs";

function posix(path) {
  return path.split("\\").join("/");
}

/**
 * A section with a pre-existing script (to force a collision), two one-file packages (widget-service
 * reads a data record and has a test; zeta-service collides on basename and carries an import that
 * will be left dangling), a kept-helper package that stays put as an external sibling, and a
 * consumer package that reaches both one-file packages once by bare specifier and once by relative
 * path.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "fold-one-file-"));
  const lib = join(root, "lib", "x");
  const section = join(lib, "section-services-section");
  const widget = join(section, "services", "widget-service");
  const zeta = join(section, "services", "zeta-service");
  const keptHelper = join(section, "services", "kept-helper");
  const consumer = join(lib, "consumer-app");

  mkdirSync(join(section, "scripts"), { recursive: true });
  writeFileSync(join(section, "package.json"), JSON.stringify({ name: "@x/section-services-section", version: "0.1.0", type: "module", exports: { ".": "./src/index.mjs" } }, null, 2));
  writeFileSync(join(section, "scripts", "shared.mjs"), "export const marker = \"pre-existing\";\n");

  mkdirSync(join(keptHelper, "src"), { recursive: true });
  writeFileSync(join(keptHelper, "package.json"), JSON.stringify({ name: "@x/kept-helper", version: "0.1.0", type: "module" }, null, 2));
  writeFileSync(join(keptHelper, "src", "help.mjs"), "export function help() { return 2; }\n");

  mkdirSync(join(widget, "src"), { recursive: true });
  mkdirSync(join(widget, "test"), { recursive: true });
  mkdirSync(join(widget, "data", "records"), { recursive: true });
  writeFileSync(join(widget, "package.json"), JSON.stringify({ name: "@x/widget-service", version: "0.1.0", type: "module" }, null, 2));
  writeFileSync(join(widget, "src", "widget.mjs"), [
    "import { readFileSync } from \"node:fs\";",
    "import { help } from \"../../kept-helper/src/help.mjs\";",
    "export function widget() {",
    "  const data = JSON.parse(readFileSync(new URL(\"../data/records/sample.json\", import.meta.url)));",
    "  return data.value + help();",
    "}",
    "",
  ].join("\n"));
  writeFileSync(join(widget, "test", "widget.test.mjs"), [
    "import { test } from \"node:test\";",
    "import assert from \"node:assert/strict\";",
    "import { widget } from \"../src/widget.mjs\";",
    "test(\"widget sums the record and the helper\", () => { assert.equal(widget(), 42); });",
    "",
  ].join("\n"));
  writeFileSync(join(widget, "data", "records", "sample.json"), JSON.stringify({ value: 40 }));

  mkdirSync(join(zeta, "src"), { recursive: true });
  writeFileSync(join(zeta, "package.json"), JSON.stringify({ name: "@x/zeta-service", version: "0.1.0", type: "module" }, null, 2));
  writeFileSync(join(zeta, "src", "shared.mjs"), [
    "import { ghost } from \"../../ghost-package/src/ghost.mjs\";",
    "export function zeta() { return \"zeta\" + ghost(); }",
    "",
  ].join("\n"));

  mkdirSync(join(consumer, "src"), { recursive: true });
  const zetaRelative = posix(relative(join(consumer, "src"), join(zeta, "src", "shared.mjs")));
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "@x/consumer-app", version: "0.1.0", type: "module", dependencies: { "@x/widget-service": "0.1.0", "@x/zeta-service": "0.1.0", "other-thing": "1.0.0" } }, null, 2));
  writeFileSync(join(consumer, "src", "index.mjs"), [
    "import { widget } from \"@x/widget-service\";",
    `import { zeta } from "${zetaRelative}";`,
    "export function run() { return widget() + zeta(); }",
    "",
  ].join("\n"));

  return { root, section, widget, zeta, keptHelper, consumer };
}

function check(...paths) {
  for (const path of paths) execFileSync(process.execPath, ["--check", path]);
}

test("packageStem strips a trailing -services-section or -service", () => {
  assert.equal(packageStem("zeta-service"), "zeta");
  assert.equal(packageStem("npm-registry-services-section"), "npm-registry");
  assert.equal(packageStem("plain-name"), "plain-name");
});

test("withoutExtension drops a .mjs or .cjs suffix only", () => {
  assert.equal(withoutExtension("widget.mjs"), "widget");
  assert.equal(withoutExtension("widget.cjs"), "widget");
  assert.equal(withoutExtension("widget.test.mjs"), "widget.test");
});

test("resolveDestination collides on an existing file and on an already-claimed destination", () => {
  const root = mkdtempSync(join(tmpdir(), "resolve-dest-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "shared.mjs"), "");
  const taken = new Set();
  assert.equal(resolveDestination(root, "scripts", "shared.mjs", "zeta", taken), join(root, "scripts", "zeta-shared.mjs"));
  assert.equal(resolveDestination(root, "scripts", "unique.mjs", "zeta", taken), join(root, "scripts", "unique.mjs"));
  assert.equal(resolveDestination(root, "scripts", "unique.mjs", "beta", taken), join(root, "scripts", "beta-unique.mjs"));
});

test("resolveRelativeSource finds exact files and applies the index/.mjs/.cjs conventions", () => {
  const root = mkdtempSync(join(tmpdir(), "resolve-src-"));
  mkdirSync(join(root, "a"), { recursive: true });
  writeFileSync(join(root, "a", "x.mjs"), "");
  assert.equal(resolveRelativeSource(root, "./a/x.mjs"), join(root, "a", "x.mjs"));
  assert.equal(resolveRelativeSource(root, "./a/x"), join(root, "a", "x.mjs"));
  assert.equal(resolveRelativeSource(root, "./a"), undefined);
  mkdirSync(join(root, "b"));
  writeFileSync(join(root, "b", "index.cjs"), "");
  assert.equal(resolveRelativeSource(root, "./b"), join(root, "b", "index.cjs"));
  assert.equal(resolveRelativeSource(root, "./missing"), undefined);
});

test("rewriteMovedSpecifiers re-relativizes a relocated sibling and a still-existing external one, and reports a vanished target", () => {
  const root = mkdtempSync(join(tmpdir(), "rewrite-moved-"));
  mkdirSync(join(root, "pkg", "src"), { recursive: true });
  mkdirSync(join(root, "sibling", "src"), { recursive: true });
  mkdirSync(join(root, "section", "scripts"), { recursive: true });
  mkdirSync(join(root, "section", "elsewhere"), { recursive: true });
  writeFileSync(join(root, "pkg", "src", "x.mjs"), "");
  writeFileSync(join(root, "sibling", "src", "y.mjs"), "");
  const pkgX = join(root, "pkg", "src", "x.mjs");
  const sectionX = join(root, "section", "elsewhere", "x.mjs");
  const relocations = new Map([[pkgX, sectionX]]);
  const text = "import { a } from './x.mjs';\nimport { b } from '../../sibling/src/y.mjs';\nimport { c } from '../gone.mjs';\n";
  const { text: rewritten, unresolved } = rewriteMovedSpecifiers(text, {
    oldDir: join(root, "pkg", "src"),
    newDir: join(root, "section", "scripts"),
    packageDir: join(root, "pkg"),
    relocations,
  });
  // './x.mjs' is relocated to a different directory, so it must be re-expressed; '../../sibling/src/y.mjs'
  // still exists in place, so only the traversal changes; '../gone.mjs' resolves to nothing and is reported.
  assert.match(rewritten, /from '\.\.\/elsewhere\/x\.mjs'/u);
  assert.match(rewritten, /from '\.\.\/\.\.\/sibling\/src\/y\.mjs'/u);
  assert.deepEqual(unresolved, ["../gone.mjs"]);
});

test("findSection locates the nearest ancestor package.json and stops at root", () => {
  const { root, section, widget } = fixture();
  const found = findSection(widget, root);
  assert.equal(found.dir, section);
  assert.equal(found.name, "@x/section-services-section");
  assert.equal(findSection(root, root), undefined);
});

test("findSection never accepts root's own manifest as a section, even when root has one", () => {
  const root = mkdtempSync(join(tmpdir(), "find-section-root-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "workspace-anchor", version: "0.0.0" }));
  const orphan = join(root, "lib", "x", "no-manifest-anywhere", "orphan-service");
  mkdirSync(join(orphan, "src"), { recursive: true });
  assert.equal(findSection(orphan, root), undefined);
});

test("a dry run plans without writing", () => {
  const { root, widget, section } = fixture();
  const report = foldOneFilePackage({ packageDir: widget, root, dryRun: true });
  assert.equal(report.refused, null);
  assert.equal(report.moved.length, 3, "source, test and data record");
  assert.ok(existsSync(join(widget, "src", "widget.mjs")));
  assert.ok(!existsSync(join(section, "scripts", "widget.mjs")));
});

test("a package with two sources is refused without changes", () => {
  const { root, section } = fixture();
  const twoSource = join(section, "services", "two-source-service");
  mkdirSync(join(twoSource, "src"), { recursive: true });
  writeFileSync(join(twoSource, "package.json"), JSON.stringify({ name: "@x/two-source-service", version: "0.1.0" }));
  writeFileSync(join(twoSource, "src", "a.mjs"), "export const a = 1;\n");
  writeFileSync(join(twoSource, "src", "b.mjs"), "export const b = 2;\n");
  const report = foldOneFilePackage({ packageDir: twoSource, root });
  assert.match(report.refused, /found 2/u);
  assert.ok(existsSync(join(twoSource, "src", "a.mjs")));
  assert.ok(existsSync(join(twoSource, "src", "b.mjs")));
});

test("a package with an embedded lakefile is refused without changes", () => {
  const { root, section } = fixture();
  const embedded = join(section, "services", "embedded-service");
  mkdirSync(join(embedded, "src"), { recursive: true });
  writeFileSync(join(embedded, "package.json"), JSON.stringify({ name: "@x/embedded-service", version: "0.1.0" }));
  writeFileSync(join(embedded, "src", "a.mjs"), "export const a = 1;\n");
  writeFileSync(join(embedded, "lakefile.toml"), "");
  const report = foldOneFilePackage({ packageDir: embedded, root });
  assert.match(report.refused, /embedded project/u);
  assert.ok(existsSync(join(embedded, "lakefile.toml")));
});

test("a package with no section below root is refused without touching root's own manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "fold-no-section-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "workspace-anchor", version: "0.0.0" }));
  const orphan = join(root, "lib", "x", "no-manifest-anywhere", "orphan-service");
  mkdirSync(join(orphan, "src"), { recursive: true });
  writeFileSync(join(orphan, "package.json"), JSON.stringify({ name: "@x/orphan-service", version: "0.1.0" }));
  writeFileSync(join(orphan, "src", "orphan.mjs"), "export const orphan = 1;\n");
  const report = foldOneFilePackage({ packageDir: orphan, root });
  assert.match(report.refused, /no ancestor package\.json/u);
  assert.ok(existsSync(join(orphan, "src", "orphan.mjs")), "the package is untouched");
  assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), { name: "workspace-anchor", version: "0.0.0" }, "root's own manifest is never written to");
  assert.ok(!existsSync(join(root, "scripts")), "nothing is created at root");
});

test("inspectOneFilePackage refuses TypeScript sources and a nested services directory", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-"));
  const tsPkg = join(root, "ts-pkg");
  mkdirSync(join(tsPkg, "src"), { recursive: true });
  writeFileSync(join(tsPkg, "src", "index.mts"), "export const a: number = 1;\n");
  assert.match(inspectOneFilePackage(tsPkg).reason, /TypeScript/u);

  const nestedPkg = join(root, "nested-pkg");
  mkdirSync(join(nestedPkg, "src"), { recursive: true });
  mkdirSync(join(nestedPkg, "services", "inner", "src"), { recursive: true });
  writeFileSync(join(nestedPkg, "src", "index.mjs"), "export const a = 1;\n");
  writeFileSync(join(nestedPkg, "services", "inner", "src", "index.mjs"), "export const b = 1;\n");
  assert.match(inspectOneFilePackage(nestedPkg).reason, /nested services/u);

  const goodPkg = join(root, "good-pkg");
  mkdirSync(join(goodPkg, "src"), { recursive: true });
  writeFileSync(join(goodPkg, "src", "index.mjs"), "export const a = 1;\n");
  assert.equal(inspectOneFilePackage(goodPkg).ok, true);
});

test("folding widget-service moves the source, test and data record, fixes its imports, rewrites the consumer, and keeps the section exports", () => {
  const { root, section, widget, consumer } = fixture();
  const report = foldOneFilePackage({ packageDir: widget, root });

  assert.equal(report.refused, null);
  assert.deepEqual(report.moved.sort((a, b) => a.from.localeCompare(b.from)), [
    { from: "lib/x/section-services-section/services/widget-service/data/records/sample.json", to: "lib/x/section-services-section/data/records/sample.json" },
    { from: "lib/x/section-services-section/services/widget-service/src/widget.mjs", to: "lib/x/section-services-section/scripts/widget.mjs" },
    { from: "lib/x/section-services-section/services/widget-service/test/widget.test.mjs", to: "lib/x/section-services-section/test/widget.test.mjs" },
  ].sort((a, b) => a.from.localeCompare(b.from)));
  assert.deepEqual(report.deleted, ["lib/x/section-services-section/services/widget-service"]);
  assert.equal(report.unresolvedImports.length, 0);
  assert.ok(!existsSync(widget));

  const movedSource = readFileSync(join(section, "scripts", "widget.mjs"), "utf8");
  assert.match(movedSource, /from "\.\.\/services\/kept-helper\/src\/help\.mjs"/u, "the still-existing sibling import is re-relativized");
  assert.match(movedSource, /new URL\("\.\.\/data\/records\/sample\.json"/u, "the data reference text is untouched and still resolves");
  const movedTest = readFileSync(join(section, "test", "widget.test.mjs"), "utf8");
  assert.match(movedTest, /from "\.\.\/scripts\/widget\.mjs"/u, "the test's import of its sibling source is re-relativized");
  assert.ok(existsSync(join(section, "data", "records", "sample.json")));

  const sectionManifest = JSON.parse(readFileSync(join(section, "package.json"), "utf8"));
  assert.deepEqual(sectionManifest.exports, { ".": "./src/index.mjs", "./widget": "./scripts/widget.mjs" });

  const consumerManifest = JSON.parse(readFileSync(join(consumer, "package.json"), "utf8"));
  assert.deepEqual(consumerManifest.dependencies, { "other-thing": "1.0.0", "@x/zeta-service": "0.1.0", "@x/section-services-section": "0.1.0" });
  const consumerSource = readFileSync(join(consumer, "src", "index.mjs"), "utf8");
  assert.match(consumerSource, /from "@x\/section-services-section\/widget"/u);
  assert.equal(report.rewrittenImporters.length, 1);
  assert.equal(report.rewrittenImporters[0].file, "lib/x/consumer-app/src/index.mjs");

  check(join(section, "scripts", "widget.mjs"), join(section, "test", "widget.test.mjs"), join(consumer, "src", "index.mjs"));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ["--test", "--test-reporter=tap", join(section, "test", "widget.test.mjs")], { encoding: "utf8", env });
  assert.match(output, /^# pass 1$/mu);
});

test("folding zeta-service resolves the collision with the package stem, reports the vanished import, and finishes rewriting the consumer", () => {
  const { root, section, widget, zeta, consumer } = fixture();
  foldOneFilePackage({ packageDir: widget, root });
  const report = foldOneFilePackage({ packageDir: zeta, root });

  assert.equal(report.refused, null);
  assert.deepEqual(report.moved, [{ from: "lib/x/section-services-section/services/zeta-service/src/shared.mjs", to: "lib/x/section-services-section/scripts/zeta-shared.mjs" }]);
  assert.ok(existsSync(join(section, "scripts", "shared.mjs")), "the pre-existing script is untouched");
  assert.equal(readFileSync(join(section, "scripts", "shared.mjs"), "utf8"), "export const marker = \"pre-existing\";\n");
  assert.deepEqual(report.unresolvedImports, [{ file: "lib/x/section-services-section/services/zeta-service/src/shared.mjs", specifier: "../../ghost-package/src/ghost.mjs" }]);
  const movedZeta = readFileSync(join(section, "scripts", "zeta-shared.mjs"), "utf8");
  assert.match(movedZeta, /from "\.\.\/\.\.\/ghost-package\/src\/ghost\.mjs"/u, "the vanished target is left unchanged, not guessed");

  const sectionManifest = JSON.parse(readFileSync(join(section, "package.json"), "utf8"));
  assert.deepEqual(sectionManifest.exports, { ".": "./src/index.mjs", "./widget": "./scripts/widget.mjs", "./zeta-shared": "./scripts/zeta-shared.mjs" });

  const consumerManifest = JSON.parse(readFileSync(join(consumer, "package.json"), "utf8"));
  assert.deepEqual(consumerManifest.dependencies, { "other-thing": "1.0.0", "@x/section-services-section": "0.1.0" }, "zeta leaves, the section was already present so it is not duplicated");
  const consumerSource = readFileSync(join(consumer, "src", "index.mjs"), "utf8");
  assert.match(consumerSource, /from "\.\.\/\.\.\/section-services-section\/scripts\/zeta-shared\.mjs"/u);

  check(join(section, "scripts", "zeta-shared.mjs"), join(consumer, "src", "index.mjs"));
});

test("boringPackageName strips the npm scope and a trailing -services-section or -service", () => {
  assert.equal(boringPackageName("@red-cup-engineering/foo-bar-service"), "foo-bar");
  assert.equal(boringPackageName("@red-cup-engineering/foo-bar-services-section"), "foo-bar");
  assert.equal(boringPackageName("plain-name"), "plain-name");
});

test("folding a package whose only source is index.mjs takes the package's own boring name, not index", () => {
  const root = mkdtempSync(join(tmpdir(), "fold-index-"));
  const lib = join(root, "lib", "x");
  const section = join(lib, "section-services-section");
  const pkg = join(section, "services", "gizmo-service");

  mkdirSync(join(section, "scripts"), { recursive: true });
  writeFileSync(join(section, "package.json"), JSON.stringify({ name: "@x/section-services-section", version: "0.1.0", type: "module" }, null, 2));

  mkdirSync(join(pkg, "src"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@x/gizmo-service", version: "0.1.0", type: "module" }, null, 2));
  writeFileSync(join(pkg, "src", "index.mjs"), "export function gizmo() { return \"gizmo\"; }\n");

  const report = foldOneFilePackage({ packageDir: pkg, root });

  assert.equal(report.refused, null);
  assert.deepEqual(report.moved, [{ from: "lib/x/section-services-section/services/gizmo-service/src/index.mjs", to: "lib/x/section-services-section/scripts/gizmo.mjs" }]);
  assert.ok(existsSync(join(section, "scripts", "gizmo.mjs")), "the source lands under its boring name, not scripts/index.mjs");
  assert.ok(!existsSync(join(section, "scripts", "index.mjs")));

  const sectionManifest = JSON.parse(readFileSync(join(section, "package.json"), "utf8"));
  assert.deepEqual(sectionManifest.exports, { "./gizmo": "./scripts/gizmo.mjs" });
  assert.equal(sectionManifest.exports["./index"], undefined);

  check(join(section, "scripts", "gizmo.mjs"));
});

test("collectCompanionFiles finds a same-directory sibling and a nested test fixture, and excludes data/ and bookkeeping files", () => {
  const root = mkdtempSync(join(tmpdir(), "companions-"));
  const pkg = join(root, "pkg");
  mkdirSync(join(pkg, "src"), { recursive: true });
  mkdirSync(join(pkg, "test", "fixtures"), { recursive: true });
  mkdirSync(join(pkg, "data"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), "{}");
  writeFileSync(join(pkg, "README.md"), "");
  const sourcePath = join(pkg, "src", "index.mjs");
  writeFileSync(sourcePath, "");
  writeFileSync(join(pkg, "src", "helper.scm"), "");
  const testPath = join(pkg, "test", "index.test.mjs");
  writeFileSync(testPath, "");
  writeFileSync(join(pkg, "test", "fixtures", "sample.mjs"), "");
  writeFileSync(join(pkg, "data", "record.json"), "");
  const found = collectCompanionFiles(pkg, { sourcePath, testPaths: [testPath] }).sort();
  assert.deepEqual(found, [join(pkg, "test", "fixtures", "sample.mjs"), join(pkg, "src", "helper.scm")].sort());
});

test("collectCompanionFiles leaves out a file sitting directly at the package root", () => {
  const root = mkdtempSync(join(tmpdir(), "companions-root-"));
  const pkg = join(root, "pkg");
  mkdirSync(join(pkg, "src"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), "{}");
  const sourcePath = join(pkg, "src", "index.mjs");
  writeFileSync(sourcePath, "");
  writeFileSync(join(pkg, "wrangler.jsonc"), "{}");
  assert.deepEqual(collectCompanionFiles(pkg, { sourcePath, testPaths: [] }), []);
});

test("resolveCompanionDestination remaps the top directory (src/scripts/apps -> scripts, test -> test) and keeps nested subdirectories", () => {
  const section = "/section";
  const pkg = "/section/services/pkg";
  const taken = new Set();
  assert.equal(
    resolveCompanionDestination(section, pkg, join(pkg, "src", "helper.scm"), "pkg", taken),
    join(section, "scripts", "helper.scm"),
  );
  assert.equal(
    resolveCompanionDestination(section, pkg, join(pkg, "test", "fixtures", "sample.mjs"), "pkg", taken),
    join(section, "test", "fixtures", "sample.mjs"),
  );
});

test("folding a package whose source reaches a sibling script through new URL(..., import.meta.url), not a specifier, moves the sibling alongside it instead of deleting it", () => {
  const root = mkdtempSync(join(tmpdir(), "fold-companion-"));
  const lib = join(root, "lib", "x");
  const section = join(lib, "section-services-section");
  const pkg = join(section, "services", "reader-service");

  mkdirSync(join(section, "scripts"), { recursive: true });
  writeFileSync(join(section, "package.json"), JSON.stringify({ name: "@x/section-services-section", version: "0.1.0", type: "module" }, null, 2));

  mkdirSync(join(pkg, "src"), { recursive: true });
  mkdirSync(join(pkg, "test"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@x/reader-service", version: "0.1.0", type: "module" }, null, 2));
  writeFileSync(join(pkg, "src", "read.mjs"), [
    "import { fileURLToPath } from \"node:url\";",
    "import { readFileSync } from \"node:fs\";",
    "const GRAMMAR = fileURLToPath(new URL(\"./grammar.txt\", import.meta.url));",
    "export function readGrammar() { return readFileSync(GRAMMAR, \"utf8\"); }",
    "",
  ].join("\n"));
  writeFileSync(join(pkg, "src", "grammar.txt"), "start := 'ok'\n");
  writeFileSync(join(pkg, "test", "read.test.mjs"), [
    "import { test } from \"node:test\";",
    "import assert from \"node:assert/strict\";",
    "import { readGrammar } from \"../src/read.mjs\";",
    "test(\"reads the sibling grammar file\", () => { assert.match(readGrammar(), /^start/u); });",
    "",
  ].join("\n"));

  const report = foldOneFilePackage({ packageDir: pkg, root });

  assert.equal(report.refused, null);
  assert.ok(!existsSync(join(pkg, "src", "grammar.txt")), "the package directory, sibling included, is gone");
  assert.ok(existsSync(join(section, "scripts", "grammar.txt")), "the sibling moved alongside the source");
  assert.equal(readFileSync(join(section, "scripts", "grammar.txt"), "utf8"), "start := 'ok'\n");
  assert.deepEqual(
    report.moved.find((m) => m.from.endsWith("grammar.txt")),
    { from: "lib/x/section-services-section/services/reader-service/src/grammar.txt", to: "lib/x/section-services-section/scripts/grammar.txt" },
  );

  check(join(section, "scripts", "read.mjs"), join(section, "test", "read.test.mjs"));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ["--test", "--test-reporter=tap", join(section, "test", "read.test.mjs")], { encoding: "utf8", env });
  assert.match(output, /^# pass 1$/mu);
});

test("folding a package whose test reaches a fixture under test/fixtures through a constructed path moves the fixture alongside it, nested subdirectory kept", () => {
  const root = mkdtempSync(join(tmpdir(), "fold-companion-fixture-"));
  const lib = join(root, "lib", "x");
  const section = join(lib, "section-services-section");
  const pkg = join(section, "services", "loader-service");

  mkdirSync(join(section, "scripts"), { recursive: true });
  writeFileSync(join(section, "package.json"), JSON.stringify({ name: "@x/section-services-section", version: "0.1.0", type: "module" }, null, 2));

  mkdirSync(join(pkg, "src"), { recursive: true });
  mkdirSync(join(pkg, "test", "fixtures"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@x/loader-service", version: "0.1.0", type: "module" }, null, 2));
  writeFileSync(join(pkg, "src", "load.mjs"), "export function load(path) { return path; }\n");
  writeFileSync(join(pkg, "test", "fixtures", "sample.mjs"), "export const value = 42;\n");
  writeFileSync(join(pkg, "test", "load.test.mjs"), [
    "import { test } from \"node:test\";",
    "import assert from \"node:assert/strict\";",
    "import { fileURLToPath } from \"node:url\";",
    "import { readFileSync } from \"node:fs\";",
    "import { dirname, join } from \"node:path\";",
    "const HERE = dirname(fileURLToPath(import.meta.url));",
    "test(\"the fixture named by a constructed path exists\", () => {",
    "  const text = readFileSync(join(HERE, \"fixtures\", \"sample.mjs\"), \"utf8\");",
    "  assert.match(text, /value = 42/u);",
    "});",
    "",
  ].join("\n"));

  const report = foldOneFilePackage({ packageDir: pkg, root });

  assert.equal(report.refused, null);
  assert.ok(existsSync(join(section, "test", "fixtures", "sample.mjs")), "the nested fixture moved under test/fixtures, not flattened");
  assert.equal(readFileSync(join(section, "test", "fixtures", "sample.mjs"), "utf8"), "export const value = 42;\n");

  check(join(section, "scripts", "load.mjs"), join(section, "test", "load.test.mjs"), join(section, "test", "fixtures", "sample.mjs"));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ["--test", "--test-reporter=tap", join(section, "test", "load.test.mjs")], { encoding: "utf8", env });
  assert.match(output, /^# pass 1$/mu);
});

test("rewriteImporterSpecifiers rewrites a bare specifier with any subpath and a relative path into the package, and leaves everything else alone", () => {
  const text = "import a from '@x/pkg';\nimport b from '@x/pkg/sub';\nimport c from '../../section/services/pkg/src/index.mjs';\nimport d from '@x/other';\nimport e from 'node:fs';\n";
  const { text: rewritten, changed } = rewriteImporterSpecifiers(text, "/lib/consumer/src", {
    oldName: "@x/pkg",
    newSpecifier: "@x/section/index",
    packageDir: "/lib/section/services/pkg",
    sourcePath: "/lib/section/services/pkg/src/index.mjs",
    newSourcePath: "/lib/section/scripts/index.mjs",
  });
  assert.equal(changed.length, 3);
  assert.match(rewritten, /from '@x\/section\/index';\nimport b from '@x\/section\/index';\nimport c from '\.\.\/\.\.\/section\/scripts\/index\.mjs';/u);
  assert.match(rewritten, /import d from '@x\/other';/u);
  assert.match(rewritten, /import e from 'node:fs';/u);
});
