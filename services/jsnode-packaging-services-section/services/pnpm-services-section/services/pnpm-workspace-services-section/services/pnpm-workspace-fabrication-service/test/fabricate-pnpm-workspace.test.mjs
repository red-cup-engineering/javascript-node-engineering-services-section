import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fabricatePnpmWorkspace, projectPnpmWorkspace } from "../src/fabricate-pnpm-workspace.mjs";

const specification = {
  root: { name: "customer-product", version: "1.0.0" },
  pnpmVersion: "10.15.0",
  buildPolicy: { esbuild: false },
  packages: [
    { path: "packages/provider", manifest: { name: "@customer/provider", version: "2.0.0", type: "module" } },
    { path: "packages/consumer", manifest: { name: "@customer/consumer", version: "1.0.0", dependencies: { "@customer/provider": "2.0.0", external: "3.0.0" } } },
  ],
};

test("projects an explicit customer workspace without ambient discovery", () => {
  const projection = projectPnpmWorkspace(specification);
  const consumer = JSON.parse(projection.files.get("packages/consumer/package.json"));
  assert.equal(consumer.dependencies["@customer/provider"], "workspace:2.0.0");
  assert.equal(consumer.dependencies.external, "3.0.0");
  assert.match(projection.files.get("pnpm-workspace.yaml"), /allowBuilds:/u);
});

test("materializes only inside an empty customer territory", async () => {
  const root = await mkdtemp(join(tmpdir(), "pnpm-workspace-product-"));
  try {
    const receipt = await fabricatePnpmWorkspace({ specification, outputDirectory: join(root, "product") });
    assert.equal(receipt.packages.length, 2);
    assert.equal(JSON.parse(await readFile(join(root, "product", "package.json"), "utf8")).private, true);
    await assert.rejects(() => fabricatePnpmWorkspace({ specification, outputDirectory: join(root, "product") }), /must be empty/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses path escape", () => {
  assert.throws(() => projectPnpmWorkspace({ ...specification, packages: [{ path: "../escape", manifest: { name: "escape", version: "1.0.0" } }] }), /escapes/u);
});
