import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditLayerImports, isForbidden, layerOf, resolveSpecifier, SPECIFIER, stripCommentsAndLiterals } from "../scripts/audit-layer-imports.mjs";
import { exportHouseTreeAtRef, HOUSE_TREE_DIRECTORY } from "../scripts/export-house-tree-at-ref.mjs";

/** Every specifier SPECIFIER finds once `text` has gone through stripCommentsAndLiterals. */
function specifiersFound(text) {
  return [...stripCommentsAndLiterals(text).matchAll(SPECIFIER)].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4]);
}

const layers = {
  root: "lib/x",
  layers: [
    { name: "substrate", imports: [], directories: ["data", "net"] },
    { name: "sign", imports: ["substrate"], directories: ["sign"] },
    { name: "relationality", imports: ["substrate", "sign"], directories: ["engine"], faculties: { relating: 0, communicating: 1, knowing: 1, animating: 2 } },
    { name: "web-server", imports: ["substrate"], directories: ["apps/web-server"] },
    { name: "gui-server", imports: ["substrate"], directories: ["apps/gui-server"] },
    { name: "feltos", imports: ["substrate", "sign", "relationality", "web-server", "gui-server"], directories: ["apps/feltos"] },
    { name: "applications", imports: ["substrate", "sign", "relationality", "web-server", "gui-server", "feltos", "applications"], directories: ["apps"] },
  ],
};

test("layerOf takes the deepest matching directory and reads the faculty from the engine's lib path", () => {
  assert.deepEqual(layerOf("lib/x/data/json/src/a.mjs", layers), { name: "substrate" });
  assert.deepEqual(layerOf("lib/x/apps/web-server/src/a.mjs", layers), { name: "web-server" });
  assert.deepEqual(layerOf("lib/x/apps/other/src/a.mjs", layers), { name: "applications" });
  assert.deepEqual(layerOf("lib/x/engine/lib/knowing/src/a.mts", layers), { name: "relationality", faculty: "knowing", facultyRank: 1 });
  assert.equal(layerOf("lib/y/elsewhere.mjs", layers), undefined);
});

test("isForbidden follows the DAG's imports lists: web-server and gui-server import only the substrate, feltos imports relationality and the gui server, sign and applications sit at the DAG's ends", () => {
  const substrate = { name: "substrate" };
  const sign = { name: "sign" };
  const relating = { name: "relationality", faculty: "relating", facultyRank: 0 };
  const webServer = { name: "web-server" };
  const guiServer = { name: "gui-server" };
  const feltos = { name: "feltos" };
  const applications = { name: "applications" };

  assert.equal(isForbidden(webServer, relating, layers), true, "web-server importing relationality breaks web-server's imports list");
  assert.equal(isForbidden(guiServer, webServer, layers), true, "gui-server importing web-server breaks gui-server's imports list");
  assert.equal(isForbidden(feltos, relating, layers), false, "feltos importing relationality is in feltos's imports list");
  assert.equal(isForbidden(feltos, guiServer, layers), false, "feltos importing gui-server is in feltos's imports list");
  assert.equal(isForbidden(relating, sign, layers), false, "relationality importing sign is in relationality's imports list");
  assert.equal(isForbidden(sign, relating, layers), true, "sign importing relationality breaks sign's imports list");
  assert.equal(isForbidden(substrate, sign, layers), true, "substrate importing sign breaks substrate's empty imports list");
  assert.equal(isForbidden(applications, substrate, layers), false, "applications may import anything");
  assert.equal(isForbidden(applications, relating, layers), false, "applications may import anything");
  assert.equal(isForbidden(applications, feltos, layers), false, "applications may import anything");
  assert.equal(isForbidden(applications, applications, layers), false, "applications may import anything, including itself");
});

test("isForbidden is true across rising relationality faculties and across different faculties of equal rank, false otherwise", () => {
  const relating = { name: "relationality", faculty: "relating", facultyRank: 0 };
  const communicating = { name: "relationality", faculty: "communicating", facultyRank: 1 };
  const knowing = { name: "relationality", faculty: "knowing", facultyRank: 1 };
  const animating = { name: "relationality", faculty: "animating", facultyRank: 2 };
  const substrate = { name: "substrate" };
  assert.equal(isForbidden(relating, animating, layers), true);
  assert.equal(isForbidden(animating, relating, layers), false);
  assert.equal(isForbidden(communicating, knowing, layers), true, "different faculties of equal rank are forbidden");
  assert.equal(isForbidden(knowing, communicating, layers), true, "different faculties of equal rank are forbidden both ways");
  assert.equal(isForbidden(knowing, knowing, layers), false, "the same faculty may import itself");
  assert.equal(isForbidden(substrate, undefined, layers), false);
});

test("resolveSpecifier maps relative paths against the importer and house names through the map", () => {
  const map = { packages: { "@red-cup-engineering/web-server": "lib/x/apps/web-server" } };
  assert.equal(resolveSpecifier("../src/b.mjs", "lib/x/data/json/test/a.test.mjs", map), "lib/x/data/json/src/b.mjs");
  assert.equal(resolveSpecifier("@red-cup-engineering/web-server/serve", "lib/x/data/json/src/a.mjs", map), "lib/x/apps/web-server/serve");
  assert.equal(resolveSpecifier("@red-cup-engineering/unknown", "lib/x/data/json/src/a.mjs", map), undefined);
  assert.equal(resolveSpecifier("node:fs", "lib/x/data/json/src/a.mjs", map), undefined);
});

test("stripCommentsAndLiterals: a JSDoc import() type reference is not a specifier; the real import after it still is", () => {
  const text = '/** @param {import("./fiction.mjs").Thing} value */\nimport { real } from "./real.mjs";\n';
  assert.deepEqual(specifiersFound(text), ["./real.mjs"]);
});

test("stripCommentsAndLiterals: a block comment holding a written-out import line is not a specifier; the real import after it still is", () => {
  const text = '/*\nimport { fake } from "./fiction.mjs";\n*/\nimport { real } from "./real.mjs";\n';
  assert.deepEqual(specifiersFound(text), ["./real.mjs"]);
});

test("stripCommentsAndLiterals: a template literal holding an import-shaped documentation example is not a specifier; the real import after it still is", () => {
  const text = 'const example = `\nimport { fake } from "./fiction.mjs";\n`;\nimport { real } from "./real.mjs";\n';
  assert.deepEqual(specifiersFound(text), ["./real.mjs"]);
});

test("stripCommentsAndLiterals: a line comment holding an import is not a specifier; the real import after it still is", () => {
  const text = '// import "./fiction.mjs"\nimport { real } from "./real.mjs";\n';
  assert.deepEqual(specifiersFound(text), ["./real.mjs"]);
});

test("stripCommentsAndLiterals: a plain string holding import-shaped prose is not a specifier; the real import after it still is", () => {
  const text = 'const s = "see import x from \'./fiction.mjs\'";\nimport { real } from "./real.mjs";\n';
  assert.deepEqual(specifiersFound(text), ["./real.mjs"]);
});

test("stripCommentsAndLiterals: a dynamic import() written inside a JSDoc block is not a specifier; a real dynamic import() still is", () => {
  const text = '/** {import("./fiction.mjs")} */\nconst mod = import("./real.mjs");\n';
  assert.deepEqual(specifiersFound(text), ["./real.mjs"]);
});

test("stripCommentsAndLiterals: a regex literal shaped like SPECIFIER's own dynamic-import alternative is not a specifier", () => {
  const text = 'const RE = /import\\(["\']([^"\']+)["\']\\)/u;\nimport "./real.mjs";\n';
  assert.deepEqual(specifiersFound(text), ["./real.mjs"]);
});

test("stripCommentsAndLiterals: ordinary division after an identifier is not mistaken for a regex literal", () => {
  const text = "const ratio = width / height / depth;\nimport \"./real.mjs\";\n";
  assert.deepEqual(specifiersFound(text), ["./real.mjs"]);
});

test("stripCommentsAndLiterals preserves every character's position, including newlines inside a masked span, so match.indices still lands on the same offsets the original text would give", () => {
  const text = '// import "./fiction.mjs"\nimport "./real.mjs";\n';
  const stripped = stripCommentsAndLiterals(text);
  assert.equal(stripped.length, text.length);
  const [match] = stripped.matchAll(SPECIFIER);
  const [start, end] = match.indices[2];
  assert.equal(text.slice(start, end), "./real.mjs");
});

test("stripCommentsAndLiterals leaves ordinary code untouched", () => {
  const text = 'import { a } from "./a.mjs";\nexport function add(x, y) { return x + y; }\n';
  assert.equal(stripCommentsAndLiterals(text), text);
});

test("auditLayerImports finds a substrate file importing the web server, also across a multi-line import, across a semicolon-joined second import on one line, and via import.meta.resolve in both quote styles, and a faculty importing a higher faculty, and nothing else", () => {
  const root = mkdtempSync(join(tmpdir(), "audit-layers-"));
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/x/data/json/src/a.mjs", "import { serve } from \"@red-cup-engineering/web-server/serve\";\nimport { b } from \"./b.mjs\";\n");
  mk("lib/x/data/json/src/b.mjs", "export const b = 1;\n");
  mk("lib/x/data/json/src/m.mjs", "import { b } from \"./b.mjs\";import { serve } from \"@red-cup-engineering/web-server/serve\";\n");
  mk("lib/x/data/json/src/imr.mjs", "const url = import.meta.resolve(\"@red-cup-engineering/web-server/serve\");\nconst alt = import.meta.resolve('@red-cup-engineering/web-server/serve');\n");
  mk("lib/x/apps/web-server/src/serve.mjs", "import { b } from \"@red-cup-engineering/json\";\n");
  mk("lib/x/engine/lib/relating/src/r.mts", "import { k } from \"../../knowing/src/k.mts\";\n");
  mk("lib/x/engine/lib/knowing/src/k.mts", "import { r } from \"../../relating/src/r.mts\";\n");
  mk("lib/x/apps/other/src/o.mjs", "import { serve } from \"@red-cup-engineering/web-server/serve\";\n");
  mk("lib/x/net/src/n.mjs", "import {\n  one,\n  two,\n} from \"@red-cup-engineering/web-server/serve\";\n");
  const map = { packages: { "@red-cup-engineering/web-server": "lib/x/apps/web-server", "@red-cup-engineering/json": "lib/x/data/json" } };
  const report = auditLayerImports({ root, layers, map });
  assert.deepEqual(report.census, { "substrate -> web-server": 5, "relationality:relating -> relationality:knowing": 1 });
  const byImporter = (importer) => report.findings.filter((finding) => finding.importer === importer);
  assert.equal(byImporter("lib/x/data/json/src/a.mjs").length, 1, "the top-of-file import is seen");
  assert.equal(byImporter("lib/x/net/src/n.mjs").length, 1, "the multi-line import still holds");
  assert.equal(byImporter("lib/x/engine/lib/relating/src/r.mts").length, 1, "the rising-faculty import is seen");
  const mFindings = byImporter("lib/x/data/json/src/m.mjs");
  assert.equal(mFindings.length, 1, "the semicolon-joined second import is seen, and only that second one");
  assert.equal(mFindings[0].specifier, "@red-cup-engineering/web-server/serve");
  const imrFindings = byImporter("lib/x/data/json/src/imr.mjs");
  assert.equal(imrFindings.length, 2, "import.meta.resolve is seen in both quote styles");
  assert.ok(imrFindings.every((finding) => finding.specifier === "@red-cup-engineering/web-server/serve"));
  assert.equal(byImporter("lib/x/apps/other/src/o.mjs").length, 0, "applications may import the web server");
  assert.equal(report.findings.length, 6);
});

test("auditLayerImports is not fooled by a forbidden import written into a JSDoc type reference, a comment, or a template literal: only the real import after each is a finding", () => {
  const root = mkdtempSync(join(tmpdir(), "audit-layers-comments-"));
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk(
    "lib/x/data/json/src/a.mjs",
    [
      '/** @param {import("@red-cup-engineering/web-server/serve").Thing} value */',
      '/*',
      'import { serve } from "@red-cup-engineering/web-server/serve";',
      '*/',
      'const example = `import { serve } from "@red-cup-engineering/web-server/serve"`;',
      '// import { serve } from "@red-cup-engineering/web-server/serve"',
      'import { serve } from "@red-cup-engineering/web-server/serve";',
      '',
    ].join("\n"),
  );
  const map = { packages: { "@red-cup-engineering/web-server": "lib/x/apps/web-server" } };
  const report = auditLayerImports({ root, layers, map });
  assert.equal(report.findings.length, 1, "the JSDoc reference, block comment, template literal, and line comment each contributed nothing; only the real import is a finding");
  assert.equal(report.findings[0].specifier, "@red-cup-engineering/web-server/serve");
});

function makeRefRepo() {
  const root = mkdtempSync(join(tmpdir(), "audit-layers-ref-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk(`${HOUSE_TREE_DIRECTORY}/x/data/json/src/a.mjs`, "export const a = 1;\n");
  mk(`${HOUSE_TREE_DIRECTORY}/x/apps/web-server/src/serve.mjs`, "export const serve = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "clean tree");
  const cleanRef = git("rev-parse", "HEAD").trim();
  return { root, git, cleanRef };
}

const refMap = { packages: { "@red-cup-engineering/web-server": `${HOUSE_TREE_DIRECTORY}/x/apps/web-server` } };
const refLayers = {
  root: `${HOUSE_TREE_DIRECTORY}/x`,
  layers: [
    { name: "substrate", imports: [], directories: ["data"] },
    { name: "web-server", imports: [], directories: ["apps/web-server"] },
  ],
};

test("exportHouseTreeAtRef exports HOUSE_TREE_DIRECTORY at a ref read-only, reuses the same export for a ref already in a shared cache, and reports undefined for a ref where it does not exist", () => {
  const { root, cleanRef } = makeRefRepo();

  const cache = new Map();
  const first = exportHouseTreeAtRef(root, cleanRef, { cache });
  assert.ok(first, "the directory exists at the ref");
  assert.ok(existsSync(join(first, HOUSE_TREE_DIRECTORY, "x/data/json/src/a.mjs")));
  const second = exportHouseTreeAtRef(root, cleanRef, { cache });
  assert.equal(second, first, "the same ref, in the same shared cache, reuses the same export rather than re-archiving");

  const independent = exportHouseTreeAtRef(root, cleanRef, {});
  assert.notEqual(independent, first, "without a shared cache, a fresh export is made");

  assert.equal(exportHouseTreeAtRef(root, "0000000000000000000000000000000000000000", {}), undefined, "a ref that does not exist reports undefined");

  rmSync(first, { recursive: true, force: true });
  rmSync(independent, { recursive: true, force: true });
});

test("auditLayerImports --ref audits a git-archived export of the ref instead of the working tree, resolving the map's directories under the export's temp root", () => {
  const { root, cleanRef } = makeRefRepo();
  // Only dirty the working tree with a forbidden import; the committed ref stays clean.
  writeFileSync(join(root, `${HOUSE_TREE_DIRECTORY}/x/data/json/src/a.mjs`), "import { serve } from \"@red-cup-engineering/web-server/serve\";\nexport const a = 1;\n");

  const workingTree = auditLayerImports({ root, layers: refLayers, map: refMap });
  assert.equal(workingTree.findings.length, 1, "the working tree has the forbidden import");

  const atRef = auditLayerImports({ root, layers: refLayers, map: refMap, ref: cleanRef });
  assert.equal(atRef.findings.length, 0, "the ref export reflects the committed, clean tree, not the dirty working tree");
});

test("auditLayerImports --ref shares one export across two calls given the same refCache, and each call without one tears its own export down", () => {
  const { root, cleanRef } = makeRefRepo();
  const refCache = new Map();
  auditLayerImports({ root, layers: refLayers, map: refMap, ref: cleanRef, refCache });
  assert.equal(refCache.size, 1);
  const sharedExport = refCache.get(cleanRef);
  auditLayerImports({ root, layers: refLayers, map: refMap, ref: cleanRef, refCache });
  assert.equal(refCache.get(cleanRef), sharedExport, "the second call reused the same shared export");
  // Nothing without a refCache to leak: a bare call exports and cleans up its own copy.
  const report = auditLayerImports({ root, layers: refLayers, map: refMap, ref: cleanRef });
  assert.equal(report.findings.length, 0);
  rmSync(sharedExport, { recursive: true, force: true });
});

test("auditLayerImports --ref reports no findings (not an error) when the ref does not exist", () => {
  const { root } = makeRefRepo();
  const report = auditLayerImports({ root, layers: refLayers, map: refMap, ref: "0000000000000000000000000000000000000000" });
  assert.deepEqual(report, { findings: [], census: {} });
});
