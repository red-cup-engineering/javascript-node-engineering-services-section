import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isDirectEntrypoint, isEntryModule } from "../src/entrypoint.mjs";

const owner = pathToFileURL(fileURLToPath(new URL("../src/entrypoint.mjs", import.meta.url))).href;

/** A package laid out as an installation lays it out: the real directory, a pnpm-style link to it under
 *  node_modules, and a link to the whole top-level directory (as a deployment item links its packages/). */
function installation(t) {
  const root = mkdtempSync(join(tmpdir(), "std-entry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const real = join(root, "packages/scope__pkg");
  mkdirSync(join(real, "scripts"), { recursive: true });
  writeFileSync(join(real, "package.json"), JSON.stringify({ name: "@scope/pkg", type: "module" }));
  writeFileSync(join(real, "scripts/main.mjs"), `import { isEntryModule } from ${JSON.stringify(owner)};\nimport "./imported.mjs";\nconsole.log(JSON.stringify({ main: isEntryModule(import.meta.url) }));\n`);
  writeFileSync(join(real, "scripts/imported.mjs"), `import { isEntryModule } from ${JSON.stringify(owner)};\nconsole.log(JSON.stringify({ imported: isEntryModule(import.meta.url) }));\n`);
  mkdirSync(join(root, "app/node_modules/@scope"), { recursive: true });
  symlinkSync(real, join(root, "app/node_modules/@scope/pkg"), "dir");
  symlinkSync(join(root, "packages"), join(root, "linked-packages"), "dir");
  return { root, real };
}
const run = (script, cwd) => spawnSync(process.execPath, [script], { cwd, encoding: "utf8" });
const answers = (result) => result.stdout.trim().split("\n").map((line) => JSON.parse(line));

test("a script run by its real path is the entry; a module it imports is not", (t) => {
  const { real } = installation(t);
  const result = run(join(real, "scripts/main.mjs"));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(answers(result), [{ imported: false }, { main: true }]);
});

test("a script run through a symlinked package directory under node_modules is the entry", (t) => {
  const { root } = installation(t);
  const result = run("node_modules/@scope/pkg/scripts/main.mjs", join(root, "app"));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(answers(result), [{ imported: false }, { main: true }]);
});

test("a script run under a symlinked top-level directory is the entry", (t) => {
  const { root } = installation(t);
  const result = run(join(root, "linked-packages/scope__pkg/scripts/main.mjs"));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(answers(result), [{ imported: false }, { main: true }]);
});

test("a missing, empty or unresolvable argv[1] answers false and never throws", () => {
  // `node -e` has no script slot: process.argv[1] is missing, so the default answers false.
  const evaluated = spawnSync(process.execPath, ["--input-type=module", "-e", `import { isEntryModule } from ${JSON.stringify(owner)}; console.log(JSON.stringify([process.argv[1] ?? null, isEntryModule(import.meta.url)]));`], { encoding: "utf8" });
  assert.equal(evaluated.status, 0, evaluated.stderr);
  assert.deepEqual(JSON.parse(evaluated.stdout), [null, false]);
  assert.equal(isEntryModule(import.meta.url, ""), false);
  assert.equal(isEntryModule(import.meta.url, "/no/such/script.mjs"), false);
  assert.equal(isEntryModule("data:text/javascript,export{}", fileURLToPath(import.meta.url)), false);
  assert.equal(isEntryModule("not a url", fileURLToPath(import.meta.url)), false);
});

test("an explicit argv slot naming this file answers true, and the older name agrees", () => {
  assert.equal(isEntryModule(import.meta.url, fileURLToPath(import.meta.url)), true);
  assert.equal(isDirectEntrypoint(import.meta.url, fileURLToPath(import.meta.url)), true);
  assert.equal(isDirectEntrypoint(import.meta.url, undefined), false);
});
