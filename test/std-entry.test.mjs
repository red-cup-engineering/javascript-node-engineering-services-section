import assert from "node:assert/strict";
import test from "node:test";
import { findEntryGuards, rewriteEntryGuards, STD_ENTRY_SPECIFIER } from "../src/std-entry.mjs";

const owner = `import { isEntryModule } from "${STD_ENTRY_SPECIFIER}";`;

test("each hand-written guard shape in the estate becomes the owner's call", () => {
  const shapes = [
    // carry-located-indexes before the realpath fix (run 388)
    ['import path from "node:path";\nconst x = path.join("a", "b");\nif (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {\n  main();\n}\n', true],
    // eavt, csl-json, custody-file, metrologic
    ['import { join } from "node:path";\nif (import.meta.url === `file://${process.argv[1]}`) {\n  main(join("a"));\n}\n', true],
    // relocate-directory, search-file-content, replace-file-content
    ['import { dirname, resolve } from "node:path";\nimport { fileURLToPath } from "node:url";\nconst here = dirname(fileURLToPath(import.meta.url));\nif (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "")) {\n  main(here);\n}\n', true],
    // group-operations run-financial-fleet-pulse
    ['import { x } from "./x.mjs";\nif(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){x();}\n', true],
    // import.meta.filename, compared without resolving links
    ['import { resolve } from "node:path";\nif (resolve(process.argv[1]) === resolve(import.meta.filename)) {\n  main();\n}\n', true],
    // the realpath IIFE written by hand into 19 csds scripts
    ['import { realpathSync } from "node:fs";\nimport { fileURLToPath } from "node:url";\nif ((process.argv[1] !== undefined && (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })())) {\n  main();\n}\n', false],
  ];
  for (const [text, blind] of shapes) {
    const result = rewriteEntryGuards(text);
    assert.equal(result.changed, true, text);
    assert.equal(result.rewrites.length, 1, text);
    assert.equal(result.rewrites[0].symlinkBlind, blind, text);
    assert.match(result.text, /if ?\(isEntryModule\(import\.meta\.url\)\) ?\{/u, result.text);
    assert.ok(result.text.includes(owner), result.text);
    assert.doesNotMatch(result.text, /process\.argv\[1\]/u, result.text);
    assert.deepEqual(result.unrewritten, []);
  }
});

test("imports only the guard read are dropped; names the module still reads are kept", () => {
  const iife = rewriteEntryGuards('import { realpathSync } from "node:fs";\nimport { fileURLToPath } from "node:url";\nif ((process.argv[1] !== undefined && (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })())) {\n  main();\n}\n');
  assert.deepEqual(iife.imports.removed.sort(), ["fileURLToPath", "realpathSync"]);
  assert.equal(iife.text, `${owner}\nif (isEntryModule(import.meta.url)) {\n  main();\n}\n`);
  const kept = rewriteEntryGuards('import { dirname, resolve } from "node:path";\nimport { fileURLToPath } from "node:url";\nconst here = dirname(fileURLToPath(import.meta.url));\nif (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "")) {\n  main(here);\n}\n');
  assert.deepEqual(kept.imports.removed, ["resolve"]);
  assert.ok(kept.text.startsWith(`import { dirname } from "node:path";\nimport { fileURLToPath } from "node:url";\n${owner}\n`), kept.text);
});

test("helpers that compare argv[1] with their URL parameter keep their name and call the owner", () => {
  const helper = rewriteEntryGuards('import { realpathSync } from "node:fs";\nimport { fileURLToPath } from "node:url";\nfunction isEntrypoint(metaUrl) {\n  if (!process.argv[1]) return false;\n  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl)); } catch { return false; }\n}\nif (isEntrypoint(import.meta.url)) main();\n');
  assert.equal(helper.rewrites[0].shape, "helper");
  assert.match(helper.text, /function isEntrypoint\(metaUrl\) \{ return isEntryModule\(metaUrl\); \}/u);
  const arrow = rewriteEntryGuards('import { realpathSync } from "node:fs";\nimport { fileURLToPath } from "node:url";\nconst isEntrypoint = () => process.argv[1]\n  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));\nif (isEntrypoint()) main();\n');
  assert.match(arrow.text, /const isEntrypoint = \(\) => isEntryModule\(import\.meta\.url\);/u);
  // A helper that does more than the guard is reported, never overwritten.
  const busy = findEntryGuards('function check(metaUrl) {\n  log("checking");\n  return process.argv[1] === new URL(metaUrl).pathname;\n}\n');
  assert.equal(busy.guards.length, 0);
});

test("a negated guard keeps its sense; import.meta.main, argv dispatch and the owner's import are left alone", () => {
  const negated = rewriteEntryGuards('if (import.meta.url !== `file://${process.argv[1]}`) process.exit(0);\n');
  assert.equal(negated.text, `${owner}\nif (!isEntryModule(import.meta.url)) process.exit(0);\n`);
  for (const text of ['if (import.meta.main) main();\n', 'const op = basename(process.argv[1]).replace(/\\.mjs$/u, "");\n', `${owner}\nif (isEntryModule(import.meta.url)) main();\n`]) {
    assert.equal(rewriteEntryGuards(text).changed, false, text);
  }
  const existing = rewriteEntryGuards(`import { isEntryModule } from "${STD_ENTRY_SPECIFIER}";\nif (import.meta.url === \`file://\${process.argv[1]}\`) main();\n`);
  assert.equal(existing.imports.added.length, 0);
  assert.equal(existing.text.split(STD_ENTRY_SPECIFIER).length - 1, 1);
});

test("a shebang stays first, and a module that defines its own isEntryModule is reported, not rewritten", () => {
  const shebang = rewriteEntryGuards('#!/usr/bin/env node\nif (import.meta.url === `file://${process.argv[1]}`) main();\n');
  assert.ok(shebang.text.startsWith(`#!/usr/bin/env node\n${owner}\n`), shebang.text);
  const own = rewriteEntryGuards('const isEntryModule = () => true;\nif (import.meta.url === `file://${process.argv[1]}`) main();\n');
  assert.equal(own.changed, false);
  assert.equal(own.unrewritten.length, 1);
});
