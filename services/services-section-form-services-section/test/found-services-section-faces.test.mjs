import { installSectionLaw } from "./section-law-fixture.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { foundServicesSection } from "../scripts/found-services-section.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "a path outside the services tree is refused",
    "input": {
      "path": "tmp/not-a-section",
      "name": "not-a-section",
      "custody": "engineering",
      "packageName": "@red-cup-engineering/not-a-section",
      "packageDescription": "Should never be created."
    },
    "output": {
      "refused": "PATH_OUTSIDE_SERVICES_TREE"
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await foundServicesSection(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/found-services-section.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}

test("the command preserves its help face without reading NDJSON", () => {
  const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/found-services-section.mjs", import.meta.url)), "--help"], {
    input: "not-json\n",
    encoding: "utf8",
  });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(command.stdout, "foundServicesSection — Founds one new services-section directory in ServicesSectionForm shape — a README.md and package.json — skipping either that already exists rather than overwriting it, optionally appending one sentence to the parent section's README, then folds the resulting directory entries through fold-directory-entries-into-services-section-form-service.\n");
});

test("the command founds a section and emits the same complete result carrier", async () => {
  const root = await mkdtemp(join(tmpdir(), "found-services-section-cli-"));
  await installSectionLaw(root);
  try {
    await mkdir(join(root, "lib/emsenn/services/561-group/services"), { recursive: true });
    const path = "lib/emsenn/services/561-group/services/widget-services-section";
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/found-services-section.mjs", import.meta.url))], {
      input: `${JSON.stringify({
        path,
        name: "widget-services-section",
        custody: "engineering",
        packageName: "@red-cup-engineering/widget-services-section",
        packageDescription: "A widget section founded through the CLI.",
        root,
      })}\n`,
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const result = JSON.parse(command.stdout);
    assert.equal(result.path, path);
    assert.deepEqual(result.created.sort(), ["README.md", "package.json"]);
    assert.deepEqual(result.skipped, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
