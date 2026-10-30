/**
 * discovery.test — the three tools' pure functions over a temp fixture tree.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildGlossaryIndex,
  buildSectionIndex,
  fabricationRecordsGraph,
  resolveGlossaryTerm,
  searchSections,
} from "./discovery.mjs";

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), "jsnode-server-discovery-"));

  // A section with a modern-shaped glossary term (and one legacy-shaped
  // carrier under lib/legacy, to exercise includeLegacy).
  const scienceSection = join(root, "lib/emsenn/services/561-group/services/fixture-science-services-section");
  mkdirSync(join(scienceSection, "content/text/glossary/terms"), { recursive: true });
  writeFileSync(
    join(scienceSection, "README.md"),
    "\ufeff+++\r\ntitle = \"Metadata is not the summary\"\r\n+++\r\nFixture Science Services Section\r\n================================\r\n\r\n~~~text\r\n# Fenced heading\r\nExample prose is not the summary.\r\n~~~\r\n\r\nThis section holds the fixture theory of glossary fixture matters, for tests only.\r\n",
  );
  writeFileSync(
    join(scienceSection, "content/text/glossary/terms/glossary-fixture-term.md"),
    [
      "---",
      "identity: glossary-fixture-term",
      "name: glossary fixture term",
      "description: A term that exists only to be resolved by a jsnode_term test.",
      "aliases:",
      "  - gft",
      "---",
      "",
      "The body of the fixture term.",
      "",
    ].join("\n"),
  );

  const legacyDir = join(scienceSection, "lib/legacy/old-fixture/content/glossary/terms");
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(
    join(legacyDir, "legacy-fixture-term.md"),
    ["---", "identity: legacy-fixture-term", "name: legacy fixture term", "---", "", "Legacy body.", ""].join("\n"),
  );

  // A child section nested under services/, and a sibling with a less exact
  // name match, to exercise jsnode_section's ranking.
  const childSection = join(scienceSection, "services/fixture-glossary-science-services-section");
  mkdirSync(childSection, { recursive: true });
  writeFileSync(join(childSection, "README.md"), "# Fixture Glossary Science Services Section\n\nA narrower fixture section about glossary science specifically.\n");
  writeFileSync(join(childSection, "package.json"), JSON.stringify({ name: "@fixture/glossary-science", version: "0.1.0" }, null, 2) + "\n");

  const broaderSection = join(root, "lib/emsenn/services/561-group/services/fixture-science-broader-cousin-services-section");
  mkdirSync(broaderSection, { recursive: true });
  writeFileSync(join(broaderSection, "README.md"), "# Fixture Science Broader Cousin Services Section\n\nA cousin section, matching fewer words of the same query.\n");

  // A work order and a fabrication receipt, joined to a package.
  const specDir = join(root, "lib/emsenn/services/561-group/services/fixture-fab-services-section/content/text/documents/articles/specifications");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "fixture-op.md"), "# fixture-op\n## Requirements\n- test: a fixture requirement.\n");
  const recordsDir = join(root, "lib/emsenn/services/561-group/services/fixture-fab-services-section/data/records");
  mkdirSync(recordsDir, { recursive: true });
  writeFileSync(
    join(recordsDir, "2026-09-04-fixture-op-fabrication-receipt.json"),
    JSON.stringify({
      type: "MarkdownJsnodeOperationPackageFabricationReceipt",
      sourceDigest: "sha256:aaaa",
      specificationDigest: "sha256:bbbb",
      // packageName/packageVersion/destination nest here: this is the real
      // shape listFabricationRecords's own walker reads (creation.packageName).
      jsnodeOperationPackageCreationReceipt: {
        packageName: "@fixture/fixture-op-service",
        packageVersion: "0.1.0",
        destination: "lib/emsenn/services/561-group/services/fixture-fab-services-section/services/fixture-op-service",
      },
    }, null, 2),
  );
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("buildGlossaryIndex / resolveGlossaryTerm", () => {
  it("resolves a modern-shaped term by identity, name, and alias", () => {
    const index = buildGlossaryIndex(root);
    const byIdentity = resolveGlossaryTerm(index, "glossary-fixture-term");
    assert.equal(byIdentity.length, 1);
    assert.equal(byIdentity[0]?.matchedBy, "identity");
    assert.equal(byIdentity[0]?.kind, "term");
    assert.equal(byIdentity[0]?.description, "A term that exists only to be resolved by a jsnode_term test.");

    const byName = resolveGlossaryTerm(index, "glossary fixture term");
    assert.equal(byName.length, 1);
    assert.equal(byName[0]?.matchedBy, "name");

    const byAlias = resolveGlossaryTerm(index, "gft");
    assert.equal(byAlias.length, 1);
    assert.equal(byAlias[0]?.matchedBy, "alias");
  });

  it("reports the term-engineering recognizer's admitted verdict and finding count", () => {
    const index = buildGlossaryIndex(root);
    const [match] = resolveGlossaryTerm(index, "glossary-fixture-term");
    assert.equal(typeof match?.admitted, "boolean");
    assert.equal(typeof match?.findings, "number");
  });

  it("excludes lib/legacy carriers by default and includes them with includeLegacy", () => {
    const index = buildGlossaryIndex(root);
    assert.equal(resolveGlossaryTerm(index, "legacy-fixture-term").length, 0);
    const withLegacy = resolveGlossaryTerm(index, "legacy-fixture-term", { includeLegacy: true });
    assert.equal(withLegacy.length, 1);
    assert.equal(withLegacy[0]?.underLegacy, true);
  });

  it("returns no matches for an unknown name", () => {
    const index = buildGlossaryIndex(root);
    assert.deepEqual(resolveGlossaryTerm(index, "no-such-term-anywhere"), []);
  });
});

describe("buildSectionIndex / searchSections", () => {
  it("finds every *-services-section, excluding lib/legacy", () => {
    const index = buildSectionIndex(root);
    const names = index.map((entry) => entry.name);
    assert.ok(names.includes("fixture-science-services-section"));
    assert.ok(names.includes("fixture-glossary-science-services-section"));
    assert.ok(!names.some((name) => name.includes("old-fixture")));
  });

  it("ranks the exact-word-match section above a superset-named cousin", () => {
    const index = buildSectionIndex(root);
    const { sections } = searchSections(index, "fixture glossary science");
    assert.ok(sections.length > 0);
    assert.equal(sections[0]?.name, "fixture-glossary-science-services-section");
  });

  it("carries observed README, entries, package facts and child names", () => {
    const index = buildSectionIndex(root);
    const entry = index.find((section) => section.name === "fixture-science-services-section");
    assert.ok(entry);
    assert.match(entry?.readmeFirstParagraph ?? "", /fixture theory of glossary fixture matters/);
    assert.ok(entry?.children.includes("content"));
    assert.ok(entry?.children.includes("services"));
    assert.ok(entry.entries.includes("README.md"));
    assert.ok(entry.entries.includes("content/text/glossary/terms/glossary-fixture-term.md"));
    assert.ok(entry.entries.includes("services/fixture-glossary-science-services-section/"));
    assert.ok(!entry.entries.includes("services/fixture-glossary-science-services-section/README.md"));
    assert.equal(entry.packageJson, null);
    assert.equal(Object.hasOwn(entry, "sectionForm"), false);
    assert.equal(Object.hasOwn(entry, "custody"), false);
    const child = index.find((section) => section.name === "fixture-glossary-science-services-section");
    assert.deepEqual(child?.packageJson, { name: "@fixture/glossary-science", version: "0.1.0" });
  });

  it("returns an empty page for a query matching no section", () => {
    const index = buildSectionIndex(root);
    const { count, sections } = searchSections(index, "totally-unmatched-query-xyz");
    assert.equal(count, 0);
    assert.deepEqual(sections, []);
  });
});

describe("fabricationRecordsGraph", () => {
  it("lists the fixture work order and receipt, joined to its package", () => {
    const graph = fabricationRecordsGraph(root, [
      { name: "@fixture/fixture-op-service", version: "0.1.0", layer: "services" },
    ]) as { workOrders: Array<{ artifactId: string }>; receipts: Array<{ packageName: string; package: unknown }>; joinedCount: number };
    assert.ok(graph.workOrders.some((wo) => wo.artifactId === "fixture-op"));
    const receipt = graph.receipts.find((r) => r.packageName === "@fixture/fixture-op-service");
    assert.ok(receipt);
    assert.deepEqual(receipt?.package, { name: "@fixture/fixture-op-service", version: "0.1.0", layer: "services" });
    assert.equal(graph.joinedCount, 1);
  });

  it("leaves package null when no workspace package matches the receipt's packageName", () => {
    const graph = fabricationRecordsGraph(root, []) as { receipts: Array<{ package: unknown }>; joinedCount: number };
    assert.ok(graph.receipts.every((r) => r.package === null));
    assert.equal(graph.joinedCount, 0);
  });
});
