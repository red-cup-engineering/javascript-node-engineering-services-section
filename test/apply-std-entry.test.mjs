import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyStdEntry } from "../scripts/apply-std-entry.mjs";

const script = fileURLToPath(new URL("../scripts/apply-std-entry.mjs", import.meta.url));

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "apply-std-entry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof text === "string" ? text : `${JSON.stringify(text, null, 2)}\n`); };
  put("repo/services/tool/package.json", { name: "@house/tool", bin: { "run-tool": "./scripts/run.mjs" }, dependencies: { "@house/other": "workspace:*" } });
  put("repo/services/tool/scripts/run.mjs", "#!/usr/bin/env node\nif (import.meta.url === `file://${process.argv[1]}`) {\n  console.log(\"ran\");\n}\n");
  put("repo/services/tool/scripts/careful.mjs", "import { realpathSync } from \"node:fs\";\nimport { fileURLToPath } from \"node:url\";\nif (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();\nfunction main() {}\n");
  put("repo/services/money/package.json", { name: "@house/money-loop" });
  put("repo/services/money/src/loop.mjs", "if (import.meta.url === `file://${process.argv[1]}`) trade();\n");
  put("repo/lib/legacy/old.mjs", "if (import.meta.url === `file://${process.argv[1]}`) old();\n");
  put("machine/units/tool.service", "ExecStart=/srv/app/node_modules/.bin/run-tool\n");
  put("machine/machine.json", { program: "packages/@house__tool/scripts/run.mjs" });
  spawnSync("git", ["init", "-q"], { cwd: join(root, "repo") });
  spawnSync("git", ["add", "."], { cwd: join(root, "repo") });
  return root;
}

test("--check reports every guard, what changes behaviour, and its callers, and writes nothing", (t) => {
  const root = repository(t);
  const before = readFileSync(join(root, "repo/services/tool/scripts/run.mjs"), "utf8");
  const report = applyStdEntry([join(root, "repo")], { callers: [join(root, "machine")], hold: ["@house/money-*"] });
  assert.deepEqual(report.files.map((file) => file.path).sort(), ["services/tool/scripts/careful.mjs", "services/tool/scripts/run.mjs"]);
  assert.deepEqual(report.held.map((entry) => [entry.package, entry.symlinkBlind]), [["@house/money-loop", true]]);
  assert.deepEqual(report.excluded.map((entry) => entry.path), ["lib/legacy/old.mjs"]);
  // Only the symlink-blind guard changes behaviour; the realpath one already ran through links.
  assert.deepEqual(report.audit.map((entry) => [entry.packagePath, entry.bins]), [["scripts/run.mjs", ["run-tool"]]]);
  assert.deepEqual(report.audit[0].callers.map((hit) => [hit.file, hit.throughNodeModules]), [["machine.json", false], ["units/tool.service", true]]);
  assert.deepEqual(report.dependencies.map((entry) => [entry.package, entry.added]), [["@house/tool", true]]);
  assert.equal(readFileSync(join(root, "repo/services/tool/scripts/run.mjs"), "utf8"), before);
  assert.equal(spawnSync(process.execPath, [script, "--check", join(root, "repo")], { encoding: "utf8" }).status, 1);
});

test("--write rewrites the guards and adds the owner dependency, after which --check is clean", (t) => {
  const root = repository(t);
  const run = spawnSync(process.execPath, [script, "--write", "--hold", "@house/money-*", join(root, "repo")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).summary.guards, 2);
  const rewritten = readFileSync(join(root, "repo/services/tool/scripts/run.mjs"), "utf8");
  assert.equal(rewritten, "#!/usr/bin/env node\nimport { isEntryModule } from \"@red-cup-engineering/node-process-services-section/entrypoint\";\nif (isEntryModule(import.meta.url)) {\n  console.log(\"ran\");\n}\n");
  const manifest = JSON.parse(readFileSync(join(root, "repo/services/tool/package.json"), "utf8"));
  assert.deepEqual(manifest.dependencies, { "@house/other": "workspace:*", "@red-cup-engineering/node-process-services-section": "workspace:*" });
  assert.match(readFileSync(join(root, "repo/services/money/src/loop.mjs"), "utf8"), /process\.argv\[1\]/u, "a held package is untouched");
  const again = spawnSync(process.execPath, [script, "--check", "--hold", "@house/money-*", join(root, "repo")], { encoding: "utf8" });
  assert.equal(again.status, 0, again.stdout);
  assert.equal(JSON.parse(again.stdout).summary.guards, 0);
});
