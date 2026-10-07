import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { countLines, measureHouseTree, measureReviewer, sourceKind } from "../scripts/measure-house-tree.mjs";
import { HOUSE_TREE_DIRECTORY } from "../scripts/export-house-tree-at-ref.mjs";

const REAL_SCRIPTS_DIR = fileURLToPath(new URL("../scripts", import.meta.url));

test("sourceKind counts src, scripts and apps sources and skips nested services, dist, declarations and tests", () => {
  assert.equal(sourceKind("src/a.mjs"), "js");
  assert.equal(sourceKind("scripts/a.cjs"), "js");
  assert.equal(sourceKind("apps/x/a.mts"), "ts");
  assert.equal(sourceKind("src/a.d.mts"), undefined);
  assert.equal(sourceKind("src/services/b/src/a.mjs"), undefined);
  assert.equal(sourceKind("apps/x/dist/a.js"), undefined);
  assert.equal(sourceKind("test/a.test.mjs"), undefined);
  assert.equal(sourceKind("README.md"), undefined);
});

test("countLines matches a line-terminated file and a file with an unterminated last line", () => {
  assert.equal(countLines(Buffer.from("a\nb\n")), 3);
  assert.equal(countLines(Buffer.from("a\nb")), 2);
  assert.equal(countLines(Buffer.from("")), 1);
});

test("measureHouseTree reads a committed tree, never the working copy, and counts a file once for its deepest package", () => {
  const repository = mkdtempSync(join(tmpdir(), "measure-house-"));
  const git = (...args) => execFileSync("/usr/bin/git", args, { cwd: repository, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  const section = "lib/x/javascript-node-services-section";
  mkdirSync(join(repository, section, "data", "records"), { recursive: true });
  mkdirSync(join(repository, "lib/x/one/src"), { recursive: true });
  mkdirSync(join(repository, "lib/x/two/src"), { recursive: true });
  mkdirSync(join(repository, "lib/x/two/services/nested/src"), { recursive: true });
  mkdirSync(join(repository, "lib/x/two/apps/foo/src"), { recursive: true });
  mkdirSync(join(repository, "lib/x/two/lib/bar/src"), { recursive: true });
  mkdirSync(join(repository, "lib/x/two/lib/plain"), { recursive: true });
  writeFileSync(join(repository, section, "package.json"), "{}");
  writeFileSync(join(repository, "lib/x/one/package.json"), "{}");
  writeFileSync(join(repository, "lib/x/one/src/a.mjs"), "1\n2\n3\n");
  writeFileSync(join(repository, "lib/x/two/package.json"), "{}");
  writeFileSync(join(repository, "lib/x/two/src/b.mjs"), "1\n");
  writeFileSync(join(repository, "lib/x/two/src/c.mts"), "1\n2\n");
  writeFileSync(join(repository, "lib/x/two/services/nested/package.json"), "{}");
  writeFileSync(join(repository, "lib/x/two/services/nested/src/d.mjs"), "1\n2\n3\n4\n");
  writeFileSync(join(repository, "lib/x/two/apps/foo/package.json"), "{}");
  writeFileSync(join(repository, "lib/x/two/apps/foo/src/e.mjs"), "1\n");
  writeFileSync(join(repository, "lib/x/two/lib/bar/package.json"), "{}");
  writeFileSync(join(repository, "lib/x/two/lib/bar/src/f.mjs"), "1\n2\n");
  writeFileSync(join(repository, "lib/x/two/lib/plain/g.mjs"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  writeFileSync(join(repository, "lib/x/one/src/uncommitted.mjs"), "should not count\n");
  const measured = measureHouseTree({ ref: "HEAD", repository });
  assert.deepEqual(measured, {
    ref: "HEAD", packages: 6, jsFiles: 6, jsLines: 4 + 2 + 5 + 2 + 3 + 2, tsFiles: 1, tsLines: 3, oneFilePackages: 4,
    // This fixture's tree lives under lib/x, not lib/emsenn/services/561-group (the one directory a
    // ref export always covers), and never committed a house-layers.json either; the norm counts are
    // left out entirely rather than reported as zero, with a note explaining why.
    note: "no house-layers.json under lib at HEAD; norm counts skipped",
  });
});

test("measureReviewer reports a timed-out run instead of throwing, naming how long it waited, rather than the reviewer's barrel/cross-package-import counts", () => {
  const scratch = mkdtempSync(join(tmpdir(), "measure-house-reviewer-timeout-"));
  const result = measureReviewer(REAL_SCRIPTS_DIR, scratch, { timeoutMs: 1 });
  assert.equal(result.barrels, undefined);
  assert.equal(result.crossPackageRelativeImports, undefined);
  assert.equal(result.detail, "timed out after 1ms");
  assert.equal(typeof result.elapsedMs, "number");
});

test("measureHouseTree, against a real ref rooted under lib/emsenn/services/561-group with a committed house-layers.json, reports layerFindings, phantomFindings, hullKernelFindings, barrels and crossPackageRelativeImports from the audits and the reviewer's own tree run", () => {
  const repository = mkdtempSync(join(tmpdir(), "measure-house-norms-"));
  const git = (...args) => execFileSync("/usr/bin/git", args, { cwd: repository, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  const mk = (path, text) => { mkdirSync(join(repository, path, ".."), { recursive: true }); writeFileSync(join(repository, path), text); };
  const base = `${HOUSE_TREE_DIRECTORY}/x`;
  const section = `${base}/javascript-node-services-section`;

  mk(`${section}/data/records/house-layers.json`, JSON.stringify({
    root: base,
    layers: [
      { name: "substrate", imports: [], directories: ["pkg", "other"] },
      { name: "web-server", imports: ["substrate"], directories: ["apps/web-server"] },
    ],
  }));

  mk(`${base}/pkg/package.json`, JSON.stringify({}));
  // One forbidden layer import: substrate (pkg) has an empty imports list, so reaching web-server breaks the DAG.
  mk(`${base}/pkg/src/a.mjs`, "import { serve } from \"@red-cup-engineering/web-server/serve\";\nexport const a = 1;\n");
  // One phantom import: no discovered package has this name.
  mk(`${base}/pkg/src/phantom.mjs`, "import { ghost } from \"@red-cup-engineering/does-not-exist\";\nexport const usesGhost = () => ghost;\n");
  // A kernel module (touches node:fs) and a hull module reaching it by a relative import: one hull-imports-kernel finding.
  mk(`${base}/pkg/src/kernel-thing.mjs`, "import { readFileSync } from \"node:fs\";\nexport const k = () => readFileSync;\n");
  mk(`${base}/pkg/src/hull-thing.mjs`, "import { k } from \"./kernel-thing.mjs\";\nexport const h = () => k;\n");
  // One barrel module: only re-exports.
  mk(`${base}/pkg/src/barrel.mjs`, "export * from \"./a.mjs\";\n");
  // One relative import that escapes pkg entirely (into the sibling "other" package, same layer so no layer finding).
  mk(`${base}/pkg/src/reach.mjs`, "import { thing } from \"../../other/src/thing.mjs\";\nexport const r = thing;\n");
  // One relative import that reaches into a package nested under pkg itself.
  mk(`${base}/pkg/nested-thing/package.json`, JSON.stringify({}));
  mk(`${base}/pkg/nested-thing/src/x.mjs`, "export const x = 1;\n");
  mk(`${base}/pkg/src/reach2.mjs`, "import { x } from \"../nested-thing/src/x.mjs\";\nexport const r2 = x;\n");

  mk(`${base}/other/package.json`, JSON.stringify({}));
  mk(`${base}/other/src/thing.mjs`, "export const thing = 1;\n");

  mk(`${base}/apps/web-server/package.json`, JSON.stringify({ exports: { "./serve": "./src/serve.mjs" } }));
  mk(`${base}/apps/web-server/src/serve.mjs`, "export const serve = 1;\n");

  git("add", "-A");
  git("commit", "-q", "-m", "norms fixture");

  const measured = measureHouseTree({ ref: "HEAD", repository });
  assert.equal(measured.note, undefined, "everything needed was available at the ref, so no note");
  assert.equal(measured.layerFindings, 1, "pkg/src/a.mjs importing the web server breaks substrate's empty imports list");
  assert.equal(measured.phantomFindings, 1, "pkg/src/phantom.mjs names no real package");
  assert.equal(measured.hullKernelFindings, 1, "pkg/src/hull-thing.mjs, hull, imports pkg/src/kernel-thing.mjs, kernel");
  assert.equal(measured.barrels, 1, "pkg/src/barrel.mjs only re-exports");
  assert.equal(measured.crossPackageRelativeImports, 2, "reach.mjs escapes the package, reach2.mjs reaches into the nested package");
});
