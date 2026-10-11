import assert from "node:assert/strict";
import test from "node:test";
import { auditNodeBuiltinImports, newlyIntroducedNodeBuiltinImportFindings } from "../scripts/audit-node-builtin-imports.mjs";

test("finds an owned built-in import with its line and owner", () => {
  const audit = auditNodeBuiltinImports({ path: "scripts/x.mjs", text: "import { readFileSync } from \"node:fs\";\n" });
  assert.deepEqual(audit.findings, [{ line: 1, builtin: "node:fs", houseService: "@red-cup-engineering/computer-file-engineering-services-section" }]);
  assert.equal(audit.count, 1);
});
test("ignores unowned built-ins", () => {
  const audit = auditNodeBuiltinImports({ path: "test/x.test.mjs", text: "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\n" });
  assert.equal(audit.count, 0);
});
test("exempts the owning package", () => {
  const audit = auditNodeBuiltinImports({ path: "scripts/read-file.mjs", text: "import { readFile } from \"node:fs/promises\";\n", packageName: "@red-cup-engineering/computer-file-engineering-services-section" });
  assert.equal(audit.count, 0);
});
test("refuses a missing text", () => assert.throws(() => auditNodeBuiltinImports({ path: "x" }), /path and text are required/u));

test("newly-introduced findings treats a file with no earlier text as all-new", () => {
  const findings = newlyIntroducedNodeBuiltinImportFindings({ path: "scripts/x.mjs", text: "import { readFileSync } from \"node:fs\";\n" });
  assert.deepEqual(findings, [{ line: 1, builtin: "node:fs", houseService: "@red-cup-engineering/computer-file-engineering-services-section" }]);
});

test("newly-introduced findings excludes a finding already present in the earlier text", () => {
  const text = "import { readFileSync } from \"node:fs\";\nimport { join } from \"node:path\";\n";
  const findings = newlyIntroducedNodeBuiltinImportFindings({ path: "scripts/x.mjs", text, beforeText: "import { readFileSync } from \"node:fs\";\n" });
  assert.deepEqual(findings, [{ line: 2, builtin: "node:path", houseService: "@red-cup-engineering/computer-filepath-engineering-services-section/filepath" }]);
});

test("newly-introduced findings is empty when the resulting text adds no new finding", () => {
  const text = "import { readFileSync } from \"node:fs\";\n";
  const findings = newlyIntroducedNodeBuiltinImportFindings({ path: "scripts/x.mjs", text, beforeText: text });
  assert.deepEqual(findings, []);
});
