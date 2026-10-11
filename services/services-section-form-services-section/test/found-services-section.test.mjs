import { installSectionLaw } from "./section-law-fixture.mjs";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { foundServicesSection, sectionNameObstructions } from "../scripts/found-services-section.mjs";

const originalCwd = process.cwd();
const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Walks up from a starting directory to find the ancestor containing lib/emsenn/services/561-group/services, mirroring the resolution the operation itself performs, so the test can assert against the real repository root independently of the operation's own logic.
 * @param {string} startDirectory An absolute directory to start walking upward from.
 * @returns {string} The absolute repository root directory.
 */
function findRepositoryRootForAssertion(startDirectory) {
  let current = startDirectory;
  while (true) {
    if (existsSync(join(current, "lib/emsenn/services/561-group/services"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`repository root not found above ${startDirectory}`);
    current = parent;
  }
}

async function withTempRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "found-services-section-"));
  await installSectionLaw(root);
  await mkdir(join(root, "lib/emsenn/services/561-group/services"), { recursive: true });
  process.chdir(root);
  try {
    await run(root);
  } finally {
    process.chdir(originalCwd);
  }
}

test("refuses a path outside the services tree without writing anything", async () => {
  const result = await foundServicesSection({
    path: "tmp/not-a-section",
    name: "not-a-section",
    custody: "engineering",
    packageName: "@red-cup-engineering/not-a-section",
    packageDescription: "Should never be created.",
  });
  assert.deepEqual(result, { refused: "PATH_OUTSIDE_SERVICES_TREE" });
  assert.equal(existsSync("tmp/not-a-section"), false);
});

test("founds a section, creating both entries and folding a ServicesSectionForm record", async () => {
  await withTempRoot(async (root) => {
    const path = "lib/emsenn/services/561-group/services/widget-services-section";
    const result = await foundServicesSection({
      path,
      name: "widget-services-section",
      custody: "engineering",
      packageName: "@red-cup-engineering/widget-services-section",
      packageDescription: "A widget section founded for a test.",
      root,
    });
    assert.deepEqual(result.created.sort(), [
      "README.md",
      "package.json",
    ].sort());
    assert.deepEqual(result.skipped, []);
    assert.equal(result.type, "ServicesSectionForm");
    assert.equal(result.custody, "engineering");
    assert.equal(result.readme.present, true);
    assert.equal(result.package.present, true);
    assert.equal(result.package.name, "@red-cup-engineering/widget-services-section");

    const readmeText = await readFile(join(path, "README.md"), "utf8");
    assert.match(readmeText, /A widget section founded for a test\./);
  });
});

test("a second call skips every already-founded entry rather than overwriting it", async () => {
  await withTempRoot(async (root) => {
    const path = "lib/emsenn/services/561-group/services/widget-services-section";
    const request = {
      path,
      name: "widget-services-section",
      custody: "engineering",
      packageName: "@red-cup-engineering/widget-services-section",
      packageDescription: "A widget section founded for a test.",
      root,
    };
    await foundServicesSection(request);
    await writeFile(join(path, "README.md"), "# hand-edited\n");
    const second = await foundServicesSection(request);
    assert.deepEqual(second.created, []);
    assert.deepEqual(second.skipped.sort(), [
      "README.md",
      "package.json",
    ].sort());
    const readmeText = await readFile(join(path, "README.md"), "utf8");
    assert.equal(readmeText, "# hand-edited\n");
  });
});

test("uses extra keywords in package.json, and a supplied readme verbatim", async () => {
  await withTempRoot(async (root) => {
    const path = "lib/emsenn/services/561-group/services/rain-barrel-services-section";
    const result = await foundServicesSection({
      path,
      name: "rain-barrel-services-section",
      custody: "561-group",
      packageName: "@561-group/561-group-no-buy-services-section",
      packageDescription: "The 561 Group's own No Buy household.",
      keywords: ["no-buy-operations"],
      readme: "# @561-group/561-group-no-buy-services-section\n\nHand-authored README text.\n",
      root,
    });
    assert.equal(result.package.present, true);
    const packageJson = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    assert.deepEqual(packageJson.keywords, ["561-group", "no-buy-operations"]);
    const readmeText = await readFile(join(path, "README.md"), "utf8");
    assert.equal(readmeText, "# @561-group/561-group-no-buy-services-section\n\nHand-authored README text.\n");
  });
});

test("writes an enterprise brand record for a public-custody section", async () => {
  await withTempRoot(async (root) => {
    const path = "lib/emsenn/services/561-group/services/public-services-section/services/rain-barrel-services-section";
    const result = await foundServicesSection({
      path,
      name: "rain-barrel-services-section",
      custody: "public",
      packageName: "@causeway-services/rain-barrel",
      packageDescription: "A public rain-barrel property.",
      brand: "Rain Barrel",
      root,
    });
    assert.equal(result.brand.type, "EnterpriseBrandWritten");
    const brandRecord = JSON.parse(await readFile(join(path, "data", "records", "service-records", "rain-barrel-services-section-enterprise-brand-service-record.json"), "utf8"));
    assert.deepEqual(brandRecord, { name: "Rain Barrel", custody: "public" });
  });
});

test("refuses a brand for a non-public non-house section without founding it", async () => {
  await withTempRoot(async (root) => {
    const path = "lib/emsenn/services/561-group/services/engineering-services-section/services/rain-barrel-engineering-services-section";
    const result = await foundServicesSection({
      path,
      name: "rain-barrel-engineering-services-section",
      custody: "engineering",
      packageName: "@red-cup-engineering/rain-barrel-engineering-services-section",
      packageDescription: "An engineering leaf section.",
      brand: "Rain Barrel",
      root,
    });
    assert.deepEqual(result, { refusal: "SECTION_CARRIES_NO_BRAND", sectionPath: path, custody: "engineering" });
  });
});

test("appends a parentReadmeSentence once and skips it as already-present on a repeat call", async () => {
  await withTempRoot(async (root) => {
    const parentDir = "lib/emsenn/services/561-group/services/561-group-services-section";
    await mkdir(parentDir, { recursive: true });
    await writeFile(join(parentDir, "README.md"), "# Parent\n\nParent section text.\n");
    const path = `${parentDir}/services/widget-services-section`;
    const sentence = "See [Widget](services/widget-services-section/README.md) for widgets.";
    const request = {
      path,
      name: "widget-services-section",
      custody: "engineering",
      packageName: "@red-cup-engineering/widget-services-section",
      packageDescription: "A widget section founded for a test.",
      parentReadmeSentence: sentence,
      root,
    };
    const first = await foundServicesSection(request);
    assert.ok(first.created.includes(`${parentDir}/README.md (sentence appended)`));
    const afterFirst = await readFile(join(parentDir, "README.md"), "utf8");
    assert.match(afterFirst, /See \[Widget\]/);

    const second = await foundServicesSection(request);
    assert.ok(second.skipped.includes(`${parentDir}/README.md (sentence already present)`));
  });
});

test("records a missing parent README as skipped rather than fabricating one", async () => {
  await withTempRoot(async (root) => {
    const path = "lib/emsenn/services/561-group/services/no-parent-yet-services-section/services/widget-services-section";
    const result = await foundServicesSection({
      path,
      name: "widget-services-section",
      custody: "engineering",
      packageName: "@red-cup-engineering/widget-services-section",
      packageDescription: "A widget section founded for a test.",
      parentReadmeSentence: "See widgets.",
      root,
    });
    assert.ok(result.skipped.some((entry) => entry.endsWith("README.md (parent README missing)")));
  });
});

test("with cwd set to the package's own directory (not the repository root), the section still lands under the repository root, never under cwd", async () => {
  const repositoryRoot = findRepositoryRootForAssertion(packageDirectory);
  const path = "lib/emsenn/services/561-group/services/found-services-section-cwd-repair-test-services-section";
  process.chdir(packageDirectory);
  try {
    const result = await foundServicesSection({
      path,
      name: "found-services-section-cwd-repair-test-services-section",
      custody: "engineering",
      packageName: "@red-cup-engineering/found-services-section-cwd-repair-test-services-section",
      packageDescription: "A disposable section founded only to prove cwd is never consulted.",
    });
    assert.deepEqual(result.created.sort(), [
      "README.md",
      "package.json",
    ].sort());
    assert.equal(existsSync(join(repositoryRoot, path, "README.md")), true);
    assert.equal(existsSync(join(packageDirectory, path)), false);
  } finally {
    process.chdir(originalCwd);
    await rm(join(repositoryRoot, path), { recursive: true, force: true });
  }
});

test("from a cwd outside any repository, refuses REPOSITORY_ROOT_NOT_FOUND and creates nothing", async () => {
  const outsideDirectory = await mkdtemp(join(tmpdir(), "found-services-section-no-repository-"));
  process.chdir(outsideDirectory);
  try {
    const path = "lib/emsenn/services/561-group/services/widget-services-section";
    const result = await foundServicesSection({
      path,
      name: "widget-services-section",
      custody: "engineering",
      packageName: "@red-cup-engineering/widget-services-section",
      packageDescription: "A widget section founded for a test.",
    });
    assert.deepEqual(result, { refused: "REPOSITORY_ROOT_NOT_FOUND", cwd: process.cwd() });
    assert.equal(existsSync(join(outsideDirectory, "lib")), false);
  } finally {
    process.chdir(originalCwd);
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("an explicit root is honored from a cwd that is not the root, founding under the root and appending the parent sentence", async () => {
  const fakeRepositoryRoot = await mkdtemp(join(tmpdir(), "found-services-section-explicit-root-"));
  await installSectionLaw(fakeRepositoryRoot);
  const unrelatedCwd = await mkdtemp(join(tmpdir(), "found-services-section-unrelated-cwd-"));
  const parentDir = "lib/emsenn/services/561-group/services/parent-services-section";
  await mkdir(join(fakeRepositoryRoot, parentDir), { recursive: true });
  await writeFile(join(fakeRepositoryRoot, parentDir, "README.md"), "# Parent\n\nParent section text.\n");
  process.chdir(unrelatedCwd);
  try {
    const path = `${parentDir}/services/child-services-section`;
    const sentence = "See [Child](services/child-services-section/README.md) for the child.";
    const result = await foundServicesSection({
      path,
      name: "child-services-section",
      custody: "engineering",
      packageName: "@red-cup-engineering/child-services-section",
      packageDescription: "A child section founded under an explicit root.",
      parentReadmeSentence: sentence,
      root: fakeRepositoryRoot,
    });
    assert.deepEqual(result.created.sort(), [
      "README.md",
      "package.json",
      `${parentDir}/README.md (sentence appended)`,
    ].sort());
    assert.equal(existsSync(join(fakeRepositoryRoot, path, "README.md")), true);
    const parentReadmeText = await readFile(join(fakeRepositoryRoot, parentDir, "README.md"), "utf8");
    assert.match(parentReadmeText, /See \[Child\]/);
  } finally {
    process.chdir(originalCwd);
    await rm(fakeRepositoryRoot, { recursive: true, force: true });
    await rm(unrelatedCwd, { recursive: true, force: true });
  }
});

test("refuses a nonconformant section name before writing anything", async () => {
  await withTempRoot(async (root) => {
    const path = "lib/emsenn/services/561-group/services/engineering-services-section/services/computer-services-section";
    const result = await foundServicesSection({
      path,
      name: "computer-services-section",
      custody: "engineering",
      packageName: "@red-cup-engineering/computer-services-section",
      packageDescription: "Should never be created.",
      root,
    });
    assert.equal(result.refused, "NAME_NOT_CONFORMANT");
    assert.match(result.obstructions.join("\n"), /-engineering-services-section/u);
    assert.equal(existsSync(join(root, path)), false);
  });
});

test("the naming law reads the path: directory is the name, under services/, kebab-case suffix", () => {
  const engineering = "lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services";
  assert.deepEqual(sectionNameObstructions(`${engineering}/slack-engineering-services-section`, "slack-engineering-services-section"), []);
  assert.deepEqual(sectionNameObstructions(`${engineering}/slack-message-relay-service`, "slack-message-relay-service"), []);
  assert.deepEqual(sectionNameObstructions("lib/emsenn/services/561-group/services/public-services-section/services/garden-services-section", "garden-services-section"), []);
  assert.equal(sectionNameObstructions(`${engineering}/slack-engineering-services-section`, "slack").length, 1);
  assert.equal(sectionNameObstructions(`${engineering.replace(/\/services$/u, "/docs")}/slack-engineering-services-section`, "slack-engineering-services-section").length, 1);
  assert.equal(sectionNameObstructions(`${engineering}/Slack_Stuff`, "Slack_Stuff").length, 1);
  assert.equal(sectionNameObstructions(`${engineering}/slack-services-section`, "slack-services-section").length, 1);
});
