import assert from "node:assert/strict";
import test from "node:test";
import { checkServicesSectionFormConformance as boundOperation } from "../scripts/check-services-section-form-conformance.mjs";
import { law } from "./section-law-fixture.mjs";
const checkServicesSectionFormConformance = (form) => boundOperation(form, law.schema);

const conformantEngineeringForm = {
  type: "ServicesSectionForm",
  version: 1,
  path: "lib/emsenn/services/561-group/services/engineering-services-section/services/widget-engineering-services-section",
  name: "widget-engineering-services-section",
  custody: "engineering",
  readme: { present: true },
  package: { present: true, name: "@red-cup-engineering/widget", version: "0.1.0", type: "module", dependenciesExactPins: true },
  content: {
    present: false,
    text: {
      glossary: { terms: 0, concepts: 0, topics: 0 },
      documents: { articles: { notes: 0, teachingArticles: { explanations: 0, guides: 0, references: 0, tutorials: 0 }, specifications: 0, bibliographies: 0, researchArticles: 0 } },
    },
  },
  code: { src: ["x.mjs"], scripts: ["read-x.mjs"], apps: [], test: ["x.test.mjs"] },
  data: { present: true, logs: false, records: true, state: false, other: [] },
  services: ["child-services-section"],
  legacy: [],
  stray: [],
  laws: {
    dataTrioOnly: true, scriptsVerbNounNaming: true, appsComposeScripts: true, oneTopicPerSection: true,
    contentUnderContentText: true, notesDatedPath: true, noRootWorkspaceFiles: true, legacyIsRevivalInventory: true,
  },
};

const conformantThinPublicForm = {
  type: "ServicesSectionForm",
  version: 1,
  path: "lib/emsenn/services/561-group/services/public-services-section/services/thin-public-services-section",
  name: "thin-public-services-section",
  custody: "public",
  readme: { present: false },
  package: { present: false },
  content: {
    present: true,
    text: {
      glossary: { terms: 1, concepts: 0, topics: 0 },
      documents: { articles: { notes: 0, teachingArticles: { explanations: 0, guides: 0, references: 0, tutorials: 0 }, specifications: 0, bibliographies: 0, researchArticles: 0 } },
    },
  },
  code: { src: [], scripts: [], apps: [], test: [] },
  data: { present: false, logs: false, records: false, state: false, other: [] },
  services: [],
  legacy: [],
  stray: [],
  laws: {
    dataTrioOnly: true, scriptsVerbNounNaming: true, appsComposeScripts: true, oneTopicPerSection: true,
    contentUnderContentText: true, notesDatedPath: true, noRootWorkspaceFiles: true, legacyIsRevivalInventory: true,
  },
};

test("the schema's own fully-populated engineering worked example is conformant", () => {
  const result = checkServicesSectionFormConformance(conformantEngineeringForm);
  assert.equal(result.conformant, true);
  assert.deepEqual(result.obstructions, []);
});

test("the schema's own thin public worked example is conformant", () => {
  const result = checkServicesSectionFormConformance(conformantThinPublicForm);
  assert.equal(result.conformant, true);
  assert.deepEqual(result.obstructions, []);
});

test("a non-empty data.other violates dataTrioOnly, obstructing at /data/other", () => {
  const form = { ...conformantEngineeringForm, data: { ...conformantEngineeringForm.data, other: ["stray-topic"] } };
  const result = checkServicesSectionFormConformance(form);
  assert.equal(result.conformant, false);
  assert.ok(result.obstructions.some((o) => o.path === "/data/other" && o.keyword === "maxItems"));
});

test("a scripts entry that fails the verb-noun pattern violates scriptsVerbNounNaming, obstructing under /code/scripts", () => {
  const form = { ...conformantEngineeringForm, code: { ...conformantEngineeringForm.code, scripts: ["widget.mjs"] } };
  const result = checkServicesSectionFormConformance(form);
  assert.equal(result.conformant, false);
  assert.ok(result.obstructions.some((o) => o.path === "/code/scripts/0" && o.keyword === "pattern"));
});

test("an invalid custody value obstructs at /custody (substitutes for notesDatedPath, which the record shape cannot express)", () => {
  const form = { ...conformantEngineeringForm, custody: "not-a-real-custody" };
  const result = checkServicesSectionFormConformance(form);
  assert.equal(result.conformant, false);
  assert.ok(result.obstructions.some((o) => o.path === "/custody"));
});

test("refuses a non-object form", () => {
  assert.throws(() => checkServicesSectionFormConformance(null), /form must be a non-null object/u);
  assert.throws(() => checkServicesSectionFormConformance("x"), /form must be a non-null object/u);
  assert.throws(() => checkServicesSectionFormConformance([]), /form must be a non-null object/u);
});
