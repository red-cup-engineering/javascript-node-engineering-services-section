import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { rewriteSpecifiers, stripSource, tidyStripped, translatedPath, translateTypescriptPackage } from "../scripts/translate-typescript-package.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "translate-ts-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "dist", "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "@red-cup-engineering/fixture", type: "module", main: "./dist/src/index.js", types: "./dist/src/index.d.ts",
    exports: { ".": { types: "./dist/src/index.d.ts", default: "./dist/src/index.js" }, "./srs": "./dist/src/srs.js" },
    scripts: { build: "tsc -p tsconfig.json", test: "tsc -p tsconfig.json && node --test dist/src/*.test.js" },
    devDependencies: { typescript: "^5.0.0", "@types/node": "^20.0.0" }, dependencies: { "@red-cup-engineering/computer-file-engineering-services-section": "0.1.0" },
  }, null, 2));
  writeFileSync(join(root, "tsconfig.json"), "{}");
  writeFileSync(join(root, "src", "types.mts"), "export interface Card { id: string; due: number }\nexport type Grade = 1 | 2 | 3 | 4;\n");
  writeFileSync(join(root, "src", "srs.mts"), "import type { Card, Grade } from './types.mts';\nexport function schedule(card: Card, grade: Grade): Card { return { ...card, due: card.due + grade }; }\n");
  writeFileSync(join(root, "src", "index.mts"), "export { schedule } from './srs.js';\nexport * from './types';\nexport enum Stage { New, Learning }\nexport const helper = (): number => import('./srs.js').then(() => 1) && 1;\n");
  writeFileSync(join(root, "src", "srs.test.mts"), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { schedule } from './srs.mts';\ntest('schedules', () => { assert.equal(schedule({ id: 'a', due: 1 }, 2).due, 3); });\n");
  writeFileSync(join(root, "dist", "src", "srs.js"), "stale");
  writeFileSync(join(root, "dist", "src", "index.d.ts"), "export {};");
  return root;
}

test("stripSource keeps comments and leaves no trailing whitespace or blank-line runs where types stood", () => {
  const source = "/** Doc. */\nexport interface Shape {\n  kind: string;\n  size: number;\n}\n\nexport type Named = { name: string };\n\n/** Keeps its comment. */\nexport function area(shape: Shape): number {\n  return shape.size;\n}\n";
  const { text, mode } = stripSource(source);
  assert.equal(mode, "strip");
  assert.equal(text, "/** Doc. */\n\n/** Keeps its comment. */\nexport function area(shape) {\n  return shape.size;\n}\n");
  assert.equal(tidyStripped("a  \n\n\n\n b\t\n"), "a\n\n b\n");
  const cases = [
    ["export { a, type T, b } from \"x\";\n", "export { a, b } from \"x\";\n"],
    ["const x = { k: \"v\" as const, n: 1 };\n", "const x = { k: \"v\", n: 1 };\n"],
    ["function f(a: A, b: B): R { return g<T>(a); }\n", "function f(a, b) { return g(a); }\n"],
    ["const y = value as unknown as Y;\n", "const y = value;\n"],
    ["import { a, type B } from \"x\";\n", "import { a } from \"x\";\n"],
    ["export { type A, b, type C };\n", "export { b };\n"],
  ];
  for (const [input, expected] of cases) assert.equal(stripSource(input).text, expected, input);
});

test("translatedPath maps TypeScript sources and ignores declarations", () => {
  assert.equal(translatedPath("/p/src/a.mts"), "/p/src/a.mjs");
  assert.equal(translatedPath("/p/src/a.ts"), "/p/src/a.mjs");
  assert.equal(translatedPath("/p/src/a.cts"), "/p/src/a.cjs");
  assert.equal(translatedPath("/p/src/a.d.mts"), undefined);
  assert.equal(translatedPath("/p/src/a.mjs"), undefined);
});

test("rewriteSpecifiers repoints TypeScript, compiled-twin and extensionless relative specifiers only", () => {
  const translated = new Set(["/p/src/srs.mjs", "/p/src/types.mjs"]);
  const text = "import a from './srs.mts';\nimport b from './srs.js';\nexport * from './types';\nimport c from './other.js';\nimport d from 'node:fs';\nconst e = import('./srs.js');\n";
  assert.equal(rewriteSpecifiers(text, "/p/src", translated), "import a from './srs.mjs';\nimport b from './srs.mjs';\nexport * from './types.mjs';\nimport c from './other.js';\nimport d from 'node:fs';\nconst e = import('./srs.mjs');\n");
});

test("a dry run reports without writing", () => {
  const root = fixture();
  const report = translateTypescriptPackage({ root, dryRun: true });
  assert.equal(report.translated.length, 4);
  assert.ok(!existsSync(join(root, "src", "srs.mjs")));
  assert.ok(existsSync(join(root, "src", "srs.mts")));
});

test("translating a package yields runnable plain Node, deletes the TypeScript, dist and tsconfig, and repoints package.json", () => {
  const root = fixture();
  const report = translateTypescriptPackage({ root });
  assert.deepEqual(report.translated.map((entry) => entry.target).sort(), ["src/index.mjs", "src/srs.mjs", "src/srs.test.mjs", "src/types.mjs"]);
  assert.equal(report.translated.find((entry) => entry.source === "src/index.mts").mode, "transform", "an enum forces the transform mode");
  assert.equal(report.translated.find((entry) => entry.source === "src/srs.mts").mode, "strip");
  for (const gone of ["src/srs.mts", "src/index.mts", "src/types.mts", "src/srs.test.mts", "tsconfig.json", "dist"]) assert.ok(!existsSync(join(root, gone)), `${gone} deleted`);
  const index = readFileSync(join(root, "src", "index.mjs"), "utf8");
  assert.match(index, /from ['"]\.\/srs\.mjs['"]/u);
  assert.match(index, /from ['"]\.\/types\.mjs['"]/u);
  assert.doesNotMatch(index, /enum Stage/u);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.main, "./src/index.mjs");
  assert.equal(manifest.types, undefined);
  assert.deepEqual(manifest.exports, { ".": { default: "./src/index.mjs" }, "./srs": "./src/srs.mjs" });
  assert.equal(manifest.devDependencies, undefined);
  assert.deepEqual(manifest.dependencies, { "@red-cup-engineering/computer-file-engineering-services-section": "0.1.0" });
  assert.equal(manifest.scripts.build, undefined);
  assert.equal(manifest.scripts.test, "node --test \"**/*.test.mjs\"");
  for (const file of ["src/index.mjs", "src/srs.mjs", "src/types.mjs", "src/srs.test.mjs"]) execFileSync(process.execPath, ["--check", join(root, file)]);
  // A child test runner inherits NODE_TEST_CONTEXT from this runner and would report to it instead of stdout.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ["--test", "--test-reporter=tap", join(root, "src", "srs.test.mjs")], { encoding: "utf8", env });
  assert.match(output, /^# pass 1$/mu);
});
