import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { exactImporterFilterArgs } from "../src/install-workspace-selection.mjs";

const json = (value) => JSON.stringify(value, null, 2) + "\n";
function packageAt(root, directory, name) {
  mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, directory, "package.json"), json({ name, version: "1.0.0", private: true }));
}
function listPaths(root, args) {
  const run = spawnSync("pnpm", [...args, "list", "--recursive", "--depth=-1", "--json"], {
    cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 2_000_000,
    env: { ...process.env, CI: "true" },
  });
  if (run.error) throw run.error;
  assert.equal(run.status, 0, `pnpm selected-project discovery failed: ${run.stderr}\n${run.stdout}`);
  return JSON.parse(run.stdout).map(({ path }) => relative(root, path).replaceAll("\\", "/") || ".").sort();
}

test("pnpm 11.19 executes exact lock-selected importer directory filters, not the wider forest", () => {
  const root = mkdtempSync(join(tmpdir(), "pnpm-locked-importer-selection-"));
  try {
    writeFileSync(join(root, "package.json"), json({ name: "workspace-root", private: true, version: "1.0.0", packageManager: "pnpm@11.19.0" }));
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/**"\n');
    packageAt(root, "packages/selected", "selected-package");
    packageAt(root, "packages/selected/child", "selected-child-must-not-be-included");
    packageAt(root, "packages/unselected", "unselected-package");
    packageAt(root, "packages/unselected/child", "unselected-child-must-not-be-included");

    const importers = [".", "packages/selected"];
    const args = [
      ...importers.filter((id) => id !== ".").map((id) => "--workspace-packages=" + id),
      ...exactImporterFilterArgs(importers),
    ];
    assert.deepEqual(listPaths(root, args), importers.sort());
    assert.deepEqual(listPaths(root, exactImporterFilterArgs([".", "packages/selected/child"])),
      [".", "packages/selected/child"]);
    assert.deepEqual(listPaths(root, exactImporterFilterArgs(["packages/unselected"])),
      ["packages/unselected"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
