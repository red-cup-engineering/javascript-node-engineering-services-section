import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readJSNodePackage, discoverWorkspace } from "./workspace.mjs";
import { runCli } from "./cli.mjs";

function findRepositoryRoot(start: string): string {
  let current = path.resolve(start);
  while (!existsSync(path.join(current, ".git"))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("repository root not found");
    current = parent;
  }
  return current;
}

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(TEST_DIRECTORY, "../..");
const REPO_ROOT = findRepositoryRoot(TEST_DIRECTORY);

function capture(): { write(s: string): void; text(): string } {
  let buf = "";
  return { write: (s) => { buf += s; }, text: () => buf };
}

describe("readJSNodePackage", () => {
  it("reads this package's own manifest", async () => {
    const pkg = await readJSNodePackage(PACKAGE_ROOT);
    assert.ok(pkg !== undefined);
    assert.equal(pkg.name, "@red-cup-engineering/jsnode-computer");
    assert.ok(pkg.exports.includes("."));
  });

  it("returns undefined for a directory with no package.json", async () => {
    const pkg = await readJSNodePackage(path.join(PACKAGE_ROOT, "__nonexistent__"));
    assert.equal(pkg, undefined);
  });
});

describe("discoverWorkspace", () => {
  it("discovers packages from the repo root", async () => {
    const ws = await discoverWorkspace(REPO_ROOT);
    assert.ok(ws.packages.length > 10, `expected >10 packages, got ${ws.packages.length}`);
    const names = ws.packages.map((p) => p.name);
    assert.ok(names.includes("@red-cup-engineering/jsnode-topology"), "expected node-topology in workspace");
  });
});

describe("cli", () => {
  it("search ranks a name hit and prints the description", async () => {
    const out = capture();
    const code = await runCli(["search", "jsnode-topology", "--root", REPO_ROOT], { stdout: out, stderr: capture() });
    assert.equal(code, 0);
    assert.match(out.text(), /\[name\] @red-cup-engineering\/jsnode-topology/);
  });

  it("describe reports a package's coordinates", async () => {
    const out = capture();
    const code = await runCli(["describe", "@red-cup-engineering/jsnode-topology", "--root", REPO_ROOT], { stdout: out, stderr: capture() });
    assert.equal(code, 0);
    assert.match(out.text(), /@red-cup-engineering\/jsnode-topology {2}\(lib\)/);
    // The describe output carries a depends-on line listing this package's
    // workspace dependencies. Assert the *shape* (a depends-on line naming at
    // least one scoped package), not a specific edge — which dependency it has
    // is a fact about the current graph that must not be hardcoded here.
    assert.match(out.text(), /depends-on:.*@[\w-]+\/[\w-]+/);
  });

  it("describe exits non-zero for an unknown package", async () => {
    const out = capture();
    const code = await runCli(["describe", "@emsenn/does-not-exist", "--root", REPO_ROOT], { stdout: out, stderr: capture() });
    assert.equal(code, 1);
  });
});
