import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EFFECTFUL_BUILTINS,
  EFFECTFUL_CRYPTO_NAMES,
  auditHullKernel,
  classifyModule,
  computeReaches,
  effectfulCryptoUses,
  effectsInText,
  packageEntryFile,
  resolveRelativeModule,
} from "../scripts/audit-hull-kernel.mjs";

test("a module with no effects is hull", () => {
  assert.deepEqual(classifyModule("export function add(a, b) { return a + b; }\n"), { kind: "hull", effects: [] });
});

test("every effectful builtin import makes a module kernel", () => {
  for (const specifier of EFFECTFUL_BUILTINS) {
    const { kind, effects } = classifyModule(`import thing from "${specifier}";\nexport const x = thing;\n`);
    assert.equal(kind, "kernel", specifier);
    assert.deepEqual(effects, [specifier]);
  }
});

test("a plain house or external import is hull", () => {
  assert.equal(classifyModule('import { thing } from "@red-cup-engineering/example";\n').kind, "hull");
  assert.equal(classifyModule('import { z } from "zod";\n').kind, "hull");
});

test("effectsInText is not fooled by an effectful builtin named in a JSDoc type reference, a comment, or a template literal: the module stays hull", () => {
  const text = [
    '/** @param {import("node:fs").Stats} value */',
    '/*',
    'import fs from "node:fs";',
    '*/',
    'const doc = `import fs from "node:fs"`;',
    '// import fs from "node:fs"',
    'export function pure(x) { return x + 1; }',
    '',
  ].join("\n");
  assert.deepEqual(effectsInText(text), []);
  assert.equal(classifyModule(text).kind, "hull");
});

test("reading process.env, argv, or a standard stream makes a module kernel", () => {
  assert.deepEqual(effectsInText("export const x = process.env.FOO;\n"), ["process.env"]);
  assert.deepEqual(effectsInText("export const x = process.argv[2];\n"), ["process.argv"]);
  assert.deepEqual(effectsInText("process.stdout.write('hi');\n"), ["process.stdout"]);
  assert.deepEqual(effectsInText("process.stderr.write('hi');\nprocess.stdin.resume();\n").sort(), ["process.stderr", "process.stdin"]);
});

test("fetch(, Math.random(, and Date.now( each make a module kernel", () => {
  assert.deepEqual(effectsInText("export const p = fetch('https://example.com');\n"), ["fetch"]);
  assert.deepEqual(effectsInText("export const r = Math.random();\n"), ["Math.random"]);
  assert.deepEqual(effectsInText("export const n = Date.now();\n"), ["Date.now"]);
});

test("new Date() with no argument is kernel; new Date(x) with an argument stays hull", () => {
  assert.deepEqual(effectsInText("export const n = new Date();\n"), ["new Date()"]);
  assert.deepEqual(effectsInText("export const n = new Date(0);\n"), []);
  assert.deepEqual(effectsInText("export const n = new Date(anIsoString);\n"), []);
});

test("node:crypto is effectful only through randomBytes or randomUUID by name", () => {
  assert.deepEqual(effectfulCryptoUses('import { createHash } from "node:crypto";\n'), []);
  assert.deepEqual(effectfulCryptoUses('import { randomBytes } from "node:crypto";\n'), ["node:crypto#randomBytes"]);
  assert.deepEqual(effectfulCryptoUses('import { createHash, randomUUID } from "node:crypto";\n'), ["node:crypto#randomUUID"]);
  for (const name of EFFECTFUL_CRYPTO_NAMES) {
    assert.deepEqual(effectfulCryptoUses(`import crypto from "node:crypto";\nconst id = crypto.${name}();\n`), [`node:crypto#${name}`]);
  }
  assert.deepEqual(effectfulCryptoUses('import * as crypto from "node:crypto";\nconst h = crypto.createHash("sha256");\n'), []);
});

test("classifyModule folds node:crypto's named effects into the module's overall kind", () => {
  assert.equal(classifyModule('import { randomBytes } from "node:crypto";\nexport const id = () => randomBytes(16);\n').kind, "kernel");
  assert.equal(classifyModule('import { createHash } from "node:crypto";\nexport const h = () => createHash("sha256");\n').kind, "hull");
});

test("resolveRelativeModule tries extensionless, suffixed, and index forms; ignores non-relative specifiers", () => {
  const candidates = new Set(["lib/a/pkg/src/thing.mjs", "lib/a/pkg/src/dir/index.mjs"]);
  assert.equal(resolveRelativeModule("./thing", "lib/a/pkg/src/entry.mjs", candidates), "lib/a/pkg/src/thing.mjs");
  assert.equal(resolveRelativeModule("./thing.mjs", "lib/a/pkg/src/entry.mjs", candidates), "lib/a/pkg/src/thing.mjs");
  assert.equal(resolveRelativeModule("./dir", "lib/a/pkg/src/entry.mjs", candidates), "lib/a/pkg/src/dir/index.mjs");
  assert.equal(resolveRelativeModule("@red-cup-engineering/pkg/thing", "lib/a/pkg/src/entry.mjs", candidates), undefined);
  assert.equal(resolveRelativeModule("./missing", "lib/a/pkg/src/entry.mjs", candidates), undefined);
});

test("packageEntryFile reads exports['.'], falls back to module/main, then an index file, else undefined", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "hull-kernel-entry-"));
  writeFileSync(join(fixtureRoot, "index.mjs"), "export const x = 1;\n");
  assert.equal(packageEntryFile({ exports: { ".": "./src/main.mjs" } }, fixtureRoot), "src/main.mjs");
  assert.equal(packageEntryFile({ exports: { ".": { import: "./src/main.mjs" } } }, fixtureRoot), "src/main.mjs");
  assert.equal(packageEntryFile({ exports: "./src/only.mjs" }, fixtureRoot), "src/only.mjs");
  assert.equal(packageEntryFile({ module: "./src/module.mjs" }, fixtureRoot), "src/module.mjs");
  assert.equal(packageEntryFile({ main: "./src/main-field.mjs" }, fixtureRoot), "src/main-field.mjs");
  assert.equal(packageEntryFile({}, fixtureRoot), "index.mjs");
  assert.equal(packageEntryFile({ exports: { "./sub": "./src/sub.mjs" } }, fixtureRoot), undefined);
});

function makeTree() {
  const root = mkdtempSync(join(tmpdir(), "audit-hull-kernel-"));
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };

  mk("lib/a/pkg-a/package.json", JSON.stringify({ name: "@red-cup-engineering/pkg-a", exports: { ".": "./src/index.mjs" } }));
  mk("lib/a/pkg-a/src/index.mjs", [
    'import fs from "node:fs";',
    'import { pureUsed } from "./pure-used.mjs";',
    'import { consume } from "./consumer.mjs";',
    "export function run() { return fs.existsSync(\".\") && pureUsed() && consume(); }",
    "",
  ].join("\n"));
  mk("lib/a/pkg-a/src/pure-used.mjs", "export function pureUsed() { return 1; }\n");
  mk("lib/a/pkg-a/src/consumer.mjs", [
    'import { help } from "./effectful-helper.mjs";',
    "export function consume() { return help(); }",
    "",
  ].join("\n"));
  mk("lib/a/pkg-a/src/effectful-helper.mjs", "export function help() { return process.env.FOO; }\n");
  mk("lib/a/pkg-a/src/pure.mjs", "export function neverReached() { return 2; }\n");
  mk("lib/a/pkg-a/src/skip.test.mjs", 'import fs from "node:fs";\nfs.existsSync(".");\n');
  mk("lib/a/pkg-a/src/legacy/old.mjs", 'import fs from "node:fs";\nfs.existsSync(".");\n');
  mk("lib/a/pkg-a/src/nested-package/package.json", JSON.stringify({ name: "@red-cup-engineering/nested" }));
  mk("lib/a/pkg-a/src/nested-package/index.mjs", 'import fs from "node:fs";\nfs.existsSync(".");\n');

  mk("lib/a/pkg-b/package.json", JSON.stringify({ name: "@red-cup-engineering/pkg-b" }));
  mk("lib/a/pkg-b/src/clean.mjs", "export const clean = true;\n");

  const map = { packages: { "@red-cup-engineering/pkg-a": "lib/a/pkg-a", "@red-cup-engineering/pkg-b": "lib/a/pkg-b" } };
  return { root, map };
}

test("auditHullKernel censuses modules per package, skipping legacy, test, and nested-package files", () => {
  const { root, map } = makeTree();
  const { census } = auditHullKernel({ root, map });
  assert.deepEqual(census["@red-cup-engineering/pkg-a"], { modules: 5, hull: 3, kernel: 2, findings: 2, hullReachingKernel: 0 });
  assert.deepEqual(census["@red-cup-engineering/pkg-b"], { modules: 1, hull: 1, kernel: 0, findings: 0, hullReachingKernel: 0 });
});

test("auditHullKernel finds a hull module importing a kernel module by relative path", () => {
  const { root, map } = makeTree();
  const { findings } = auditHullKernel({ root, map });
  const hullImportsKernel = findings.filter((finding) => finding.kind === "hull-imports-kernel");
  assert.equal(hullImportsKernel.length, 1);
  assert.deepEqual(hullImportsKernel[0], {
    package: "@red-cup-engineering/pkg-a",
    importer: "lib/a/pkg-a/src/consumer.mjs",
    imported: "lib/a/pkg-a/src/effectful-helper.mjs",
    effects: ["process.env"],
    kind: "hull-imports-kernel",
  });
});

test("auditHullKernel does not treat a relative path named only in a JSDoc comment as a real edge into a kernel module", () => {
  const root = mkdtempSync(join(tmpdir(), "audit-hull-kernel-comments-"));
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/c/pkg-c/package.json", JSON.stringify({ name: "@red-cup-engineering/pkg-c", exports: { ".": "./src/index.mjs" } }));
  mk("lib/c/pkg-c/src/index.mjs", "export { dodger } from './dodger.mjs';\n");
  // A writer rewrote a real relative import into a JSDoc type reference (still naming the kernel
  // module) to keep the documentation without the edge counting against the audit. Post-fix, the
  // JSDoc reference is not a real import either way: no hull-imports-kernel finding results.
  mk(
    "lib/c/pkg-c/src/dodger.mjs",
    [
      "/** @param {import('./effectful.mjs').Helper} helper */",
      "export function dodger(helper) { return helper; }",
      "",
    ].join("\n"),
  );
  mk("lib/c/pkg-c/src/effectful.mjs", "export function help() { return process.env.FOO; }\n");
  const map = { packages: { "@red-cup-engineering/pkg-c": "lib/c/pkg-c" } };
  const { findings } = auditHullKernel({ root, map });
  assert.equal(findings.filter((finding) => finding.kind === "hull-imports-kernel").length, 0);
});

test("auditHullKernel reports a kernel entry stranding a hull module, informationally, as entry-is-kernel", () => {
  const { root, map } = makeTree();
  const { findings } = auditHullKernel({ root, map });
  const entryIsKernel = findings.filter((finding) => finding.kind === "entry-is-kernel");
  assert.equal(entryIsKernel.length, 1);
  assert.equal(entryIsKernel[0].package, "@red-cup-engineering/pkg-a");
  assert.equal(entryIsKernel[0].entry, "lib/a/pkg-a/src/index.mjs");
  assert.deepEqual(entryIsKernel[0].strandedHullModules, ["lib/a/pkg-a/src/pure.mjs"]);
});

test("a package whose reachable hull modules are all reached from its entry gets no entry-is-kernel finding", () => {
  const { root, map } = makeTree();
  // pure-used.mjs is reachable from the kernel entry, so it alone would not strand anything.
  const scoped = auditHullKernel({ root, map: { packages: { "@red-cup-engineering/pkg-a": map.packages["@red-cup-engineering/pkg-a"] } } });
  assert.ok(scoped.findings.some((finding) => finding.kind === "entry-is-kernel"), "pure.mjs still strands even scoped alone");
});

test("computeReaches gives 0 to kernel modules, a hop count to hull modules composing them, and no entry to a module that never reaches one", () => {
  const modulesByPath = new Map([
    ["pkg/a.mjs", { strippedText: 'import { b } from "./b.mjs";\n', kind: "hull" }],
    ["pkg/b.mjs", { strippedText: 'import { c } from "./c.mjs";\n', kind: "hull" }],
    ["pkg/c.mjs", { strippedText: "", kind: "kernel" }],
    ["pkg/isolated.mjs", { strippedText: "", kind: "hull" }],
  ]);
  const packageOfPath = new Map([["pkg/a.mjs", "pkg"], ["pkg/b.mjs", "pkg"], ["pkg/c.mjs", "pkg"], ["pkg/isolated.mjs", "pkg"]]);
  const reaches = computeReaches(modulesByPath, packageOfPath);
  assert.equal(reaches.get("pkg/c.mjs"), 0);
  assert.equal(reaches.get("pkg/b.mjs"), 1);
  assert.equal(reaches.get("pkg/a.mjs"), 2);
  assert.equal(reaches.has("pkg/isolated.mjs"), false);
});

test("computeReaches follows only edges within the same package: a relative import that resolves into another package's kernel module gives that importer no reach", () => {
  const modulesByPath = new Map([
    ["pkg-a/entry.mjs", { strippedText: 'import { help } from "../pkg-b/kernel.mjs";\n', kind: "hull" }],
    ["pkg-b/kernel.mjs", { strippedText: "", kind: "kernel" }],
  ]);
  const packageOfPath = new Map([["pkg-a/entry.mjs", "pkg-a"], ["pkg-b/kernel.mjs", "pkg-b"]]);
  const reaches = computeReaches(modulesByPath, packageOfPath);
  assert.equal(reaches.get("pkg-b/kernel.mjs"), 0);
  assert.equal(reaches.has("pkg-a/entry.mjs"), false);
});

function makeTransitiveTree() {
  const root = mkdtempSync(join(tmpdir(), "audit-hull-kernel-transitive-"));
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("lib/t/pkg-t/package.json", JSON.stringify({ name: "@red-cup-engineering/pkg-t" }));
  mk("lib/t/pkg-t/src/kernel.mjs", 'import fs from "node:fs";\nexport function touch() { return fs.existsSync("."); }\n');
  // middle.mjs has no direct effect marker of its own -- a direct import of a kernel module, so a
  // "hull-imports-kernel" finding already flags it (reaches 1).
  mk("lib/t/pkg-t/src/middle.mjs", 'import { touch } from "./kernel.mjs";\nexport function relay() { return touch(); }\n');
  // outer.mjs has no direct effect marker either, and imports only middle.mjs -- itself hull by the
  // direct-marker classifier alone, and not named by any "hull-imports-kernel" finding, yet it
  // composes the same filesystem effect two hops away. This is the MetroPlat journal-namespace shape.
  mk("lib/t/pkg-t/src/outer.mjs", 'import { relay } from "./middle.mjs";\nexport function call() { return relay(); }\n');
  mk("lib/t/pkg-t/src/isolated.mjs", "export const isolated = true;\n");
  const map = { packages: { "@red-cup-engineering/pkg-t": "lib/t/pkg-t" } };
  return { root, map };
}

test("auditHullKernel's modules carry reaches -- 0 for kernel, 1 for a direct hull importer, 2 for a hull module that only composes another hull module reaching kernel, absent when no path reaches one -- and hullReachingKernel counts only the reaches>=2 case", () => {
  const { root, map } = makeTransitiveTree();
  const { modules, census } = auditHullKernel({ root, map });
  const byPath = Object.fromEntries(modules.map((entry) => [entry.path.split("/").pop(), entry]));
  assert.equal(byPath["kernel.mjs"].kind, "kernel");
  assert.equal(byPath["kernel.mjs"].reaches, 0);
  assert.equal(byPath["middle.mjs"].kind, "hull");
  assert.equal(byPath["middle.mjs"].reaches, 1);
  assert.equal(byPath["outer.mjs"].kind, "hull");
  assert.equal(byPath["outer.mjs"].reaches, 2);
  assert.equal(byPath["isolated.mjs"].kind, "hull");
  assert.equal("reaches" in byPath["isolated.mjs"], false);
  assert.deepEqual(census["@red-cup-engineering/pkg-t"], { modules: 4, hull: 3, kernel: 1, findings: 1, hullReachingKernel: 1 });
});

test("--package limits the audit to one package directory or a prefix of nested ones", () => {
  const { root, map } = makeTree();
  const scoped = auditHullKernel({ root, map, packageDirectory: "lib/a/pkg-b" });
  assert.deepEqual(Object.keys(scoped.census), ["@red-cup-engineering/pkg-b"]);
  const prefixScoped = auditHullKernel({ root, map, packageDirectory: "lib/a" });
  assert.deepEqual(Object.keys(prefixScoped.census).sort(), ["@red-cup-engineering/pkg-a", "@red-cup-engineering/pkg-b"]);
});

test("the CLI prints JSON and --summary collapses to counts; --package scopes the run", () => {
  const { root, map } = makeTree();
  const scriptPath = fileURLToPath(new URL("../scripts/audit-hull-kernel.mjs", import.meta.url));
  const mapPath = join(root, "map.json");
  writeFileSync(mapPath, JSON.stringify(map));

  const full = spawnSync(process.execPath, [scriptPath, "--root", root, "--map", mapPath], { encoding: "utf8" });
  assert.equal(full.status, 0, full.stderr);
  const fullReport = JSON.parse(full.stdout);
  assert.equal(fullReport.findings.length, 2);
  assert.ok(Array.isArray(fullReport.modules) && fullReport.modules.length > 0);

  const summary = spawnSync(process.execPath, [scriptPath, "--root", root, "--map", mapPath, "--summary"], { encoding: "utf8" });
  assert.equal(summary.status, 0, summary.stderr);
  assert.deepEqual(JSON.parse(summary.stdout), { findings: 2, census: fullReport.census });

  const scoped = spawnSync(process.execPath, [scriptPath, "--root", root, "--map", mapPath, "--package", "lib/a/pkg-b", "--summary"], { encoding: "utf8" });
  assert.equal(scoped.status, 0, scoped.stderr);
  assert.deepEqual(JSON.parse(scoped.stdout), { findings: 0, census: { "@red-cup-engineering/pkg-b": { modules: 1, hull: 1, kernel: 0, findings: 0, hullReachingKernel: 0 } } });
});
