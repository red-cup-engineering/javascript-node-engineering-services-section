import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { auditExternalImports } from "../scripts/audit-external-imports.mjs";

test("finds an external dependency import with its line", () => {
  const audit = auditExternalImports({ path: "scripts/x.mjs", text: "import { z } from \"zod\";\n" });
  assert.deepEqual(audit.findings, [{ line: 1, specifier: "zod" }]);
  assert.equal(audit.count, 1);
});
test("ignores node: builtins", () => {
  const audit = auditExternalImports({ path: "scripts/x.mjs", text: "import test from \"node:test\";\nimport { readFile } from \"node:fs/promises\";\n" });
  assert.equal(audit.count, 0);
});
test("ignores relative imports", () => {
  const audit = auditExternalImports({ path: "scripts/x.mjs", text: "import { helper } from \"./helper.mjs\";\nimport { other } from \"../other.mjs\";\n" });
  assert.equal(audit.count, 0);
});
test("ignores every house scope", () => {
  const text = [
    "@red-cup-engineering/computer-file-engineering-services-section", "@red-cup-engineering/metrologic", "@561-group/board-of-directors",
    "@emsenn/personal", "@causeway-services/gateway", "@coesite-operations/ledger",
  ].map((specifier) => `import x from "${specifier}/x.mjs";`).join("\n");
  assert.equal(auditExternalImports({ path: "scripts/x.mjs", text }).count, 0);
});
test("finds @modelcontextprotocol/sdk as an external dependency", () => {
  const audit = auditExternalImports({ path: "scripts/x.mjs", text: "import { Server } from \"@modelcontextprotocol/sdk/server/index.js\";\n" });
  assert.deepEqual(audit.findings, [{ line: 1, specifier: "@modelcontextprotocol/sdk/server/index.js" }]);
});
test("refuses a missing text", () => assert.throws(() => auditExternalImports({ path: "x" }), /path and text are required/u));

test("the CLI face agrees with the library face", () => {
  const input = { path: "scripts/x.mjs", text: "import { z } from \"zod\";\n" };
  const output = { type: "ExternalImportAudit", path: "scripts/x.mjs", findings: [{ line: 1, specifier: "zod" }], count: 1 };
  assert.deepEqual(auditExternalImports(input), output);
  const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/audit-external-imports.mjs", import.meta.url))], {
    input: JSON.stringify(input) + "\n",
    encoding: "utf8",
  });
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(JSON.parse(command.stdout.trim()), output);
});
