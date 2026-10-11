import assert from "node:assert/strict";
import test from "node:test";
import { foldDirectoryEntriesIntoServicesSectionForm as boundOperation } from "../scripts/fold-directory-entries-into-services-section-form.mjs";
import { law } from "./section-law-fixture.mjs";
const foldDirectoryEntriesIntoServicesSectionForm = (request) => boundOperation(request, law.contentTaxonomy);

const widgetEntries = [
  "README.md",
  "package.json",
  "src/widget.mjs",
  "scripts/make-widget.mjs",
  "apps/widget-cli.mjs",
  "test/widget.test.mjs",
  "data/logs/",
  "data/records/",
  "content/text/glossary/terms/widget.md",
  "content/text/documents/articles/notes/2026/09/04/2026-09-04-note-on-widgets.md",
  "content/text/documents/articles/teaching-articles/guides/making-widgets.md",
  "services/widget-part-engineering-services-section/",
];
const widgetPackageJson = { name: "@red-cup-engineering/widget", version: "0.1.0", type: "module", dependencies: { "left-pad": "1.3.0" } };

test("a conformant engineering section folds to a fully-populated ServicesSectionForm record", () => {
  const record = foldDirectoryEntriesIntoServicesSectionForm({
    path: "lib/emsenn/services/561-group/services/engineering-services-section/services/widget-engineering-services-section",
    entries: widgetEntries,
    packageJson: widgetPackageJson,
  });
  assert.equal(record.type, "ServicesSectionForm");
  assert.equal(record.version, 1);
  assert.equal(record.name, "widget-engineering-services-section");
  assert.equal(record.custody, "engineering");
  assert.deepEqual(record.readme, { present: true });
  assert.equal(record.package.present, true);
  assert.equal(record.package.dependenciesExactPins, true);
  assert.deepEqual(record.code, { src: ["widget.mjs"], scripts: ["make-widget.mjs"], apps: ["widget-cli.mjs"], test: ["widget.test.mjs"] });
  assert.deepEqual(record.data, { present: true, logs: true, records: true, state: false, other: [] });
  assert.equal(record.content.text.glossary.terms, 1);
  assert.equal(record.content.text.documents.articles.notes, 1);
  assert.equal(record.content.text.documents.articles.teachingArticles.guides, 1);
  assert.deepEqual(record.services, ["widget-part-engineering-services-section"]);
  assert.deepEqual(record.legacy, []);
  assert.deepEqual(record.stray, []);
});

test("a thin public section with only content/ folds present:false elsewhere and custody public", () => {
  const record = foldDirectoryEntriesIntoServicesSectionForm({
    path: "lib/emsenn/services/561-group/services/public-services-section/services/thin-public-services-section",
    entries: ["content/text/glossary/terms/a.md"],
  });
  assert.equal(record.custody, "public");
  assert.deepEqual(record.readme, { present: false });
  assert.equal(record.package.present, false);
  assert.equal(record.content.present, true);
  assert.deepEqual(record.data, { present: false, logs: false, records: false, state: false, other: [] });
  assert.deepEqual(record.code, { src: [], scripts: [], apps: [], test: [] });
});

test("a data/ directory named only 'ontology' lands in data.other", () => {
  const record = foldDirectoryEntriesIntoServicesSectionForm({
    path: "lib/emsenn/services/561-group/services/science-services-section/services/botany-services-section",
    entries: ["data/logs/", "data/ontology/"],
  });
  assert.equal(record.custody, "science");
  assert.deepEqual(record.data, { present: true, logs: true, records: false, state: false, other: ["ontology"] });
});

test("a caret dependency version folds dependenciesExactPins:false", () => {
  const record = foldDirectoryEntriesIntoServicesSectionForm({
    path: "lib/emsenn/services/561-group/services/engineering-services-section/services/caret-engineering-services-section",
    entries: ["package.json"],
    packageJson: { name: "@red-cup-engineering/caret", version: "0.1.0", type: "module", dependencies: { "left-pad": "^1.3.0" } },
  });
  assert.equal(record.package.dependenciesExactPins, false);
});

test("refuses a request without a string path", () => {
  assert.throws(() => foldDirectoryEntriesIntoServicesSectionForm({ entries: [] }), /path is required/u);
  assert.throws(() => foldDirectoryEntriesIntoServicesSectionForm({ path: "", entries: [] }), /path is required/u);
});

test("refuses a request whose entries is not an array of strings", () => {
  assert.throws(() => foldDirectoryEntriesIntoServicesSectionForm({ path: "a/b" }), /entries must be an array of strings/u);
  assert.throws(() => foldDirectoryEntriesIntoServicesSectionForm({ path: "a/b", entries: ["ok", 1] }), /entries must be an array of strings/u);
});
