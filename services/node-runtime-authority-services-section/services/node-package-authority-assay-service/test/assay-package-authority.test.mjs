import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assayNodePackageAuthority } from "../src/assay-package-authority.mjs";

test("distinguishes package-local npm authority from workspace pnpm development", async () => {
  const root = await mkdtemp(join(tmpdir(), "package-authority-assay-"));
  try {
    await mkdir(join(root, "packages", "npm-cell"), { recursive: true });
    await mkdir(join(root, "packages", "shared"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "root", packageManager: "pnpm@11.9.0" }));
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\nallowBuilds:\n  esbuild: false\n");
    await writeFile(join(root, "packages", "npm-cell", "package.json"), JSON.stringify({ name: "npm-cell" }));
    await writeFile(join(root, "packages", "npm-cell", "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
    await writeFile(join(root, "packages", "shared", "package.json"), JSON.stringify({ name: "shared" }));
    const report = await assayNodePackageAuthority(root);
    assert.equal(report.packageCount, 2);
    assert.deepEqual(report.authorityCounts, { npm: 1, "workspace-pnpm-development": 1 });
    assert.deepEqual(report.conflicts, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reports competing root ownership and package lock disagreement", async () => {
  const root = await mkdtemp(join(tmpdir(), "package-authority-conflict-"));
  try {
    await mkdir(join(root, "packages", "cell"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "root", packageManager: "pnpm@11.9.0", workspaces: ["packages/*"] }));
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\nallowBuilds:\n  sharp: decide-later\n");
    await writeFile(join(root, "packages", "cell", "package.json"), JSON.stringify({ name: "cell", packageManager: "pnpm@11.9.0" }));
    await writeFile(join(root, "packages", "cell", "package-lock.json"), "{}");
    const report = await assayNodePackageAuthority(root);
    assert.equal(report.conflicts.length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("assays an independent package tree after workspace authority is abolished", async () => {
  const root = await mkdtemp(join(tmpdir(), "package-authority-independent-"));
  try {
    await mkdir(join(root, "services", "cell", "node_modules"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "root" }));
    await writeFile(join(root, "services", "cell", "package.json"), JSON.stringify({ name: "cell" }));
    await writeFile(join(root, "services", "cell", "node_modules", ".package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
    const report = await assayNodePackageAuthority(root);
    assert.equal(report.discoveryMode, "independent-package-tree");
    assert.equal(report.packageCount, 1);
    assert.deepEqual(report.authorityCounts, { "independent-package-unmaterialized": 1 });
    assert.equal(report.npmInstallMarkerCount, 1);
    assert.deepEqual(report.conflicts, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("assays a repository enclosure that carries packages but is not itself a package", async () => {
  const root = await mkdtemp(join(tmpdir(), "package-authority-enclosure-"));
  try {
    await mkdir(join(root, "services", "cell"), { recursive: true });
    await writeFile(join(root, "services", "cell", "package.json"), JSON.stringify({ name: "cell" }));
    const report = await assayNodePackageAuthority(root);
    assert.equal(report.discoveryMode, "independent-package-tree");
    assert.equal(report.rootManager, null);
    assert.equal(report.packageCount, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
