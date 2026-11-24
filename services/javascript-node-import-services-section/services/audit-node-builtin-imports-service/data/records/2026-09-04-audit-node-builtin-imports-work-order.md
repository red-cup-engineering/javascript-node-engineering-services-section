# audit-node-builtin-imports
## Requirements
- `owned-builtin-findings`: The operation returns a NodeBuiltinImportAudit record listing every single-line import of a Node built-in module that a house service owns, with the line number and the owning house service.
- `unowned-builtins-ignored`: The operation ignores imports of Node built-ins no house service owns, such as node:test and node:assert.
- `owner-exempt`: When the request names the package the source belongs to (packageName) and that package is the house owner of the built-in, the import is not a finding: the owner is where the built-in lives once.
## Prohibitions
- `missing-text-refusal`: The operation must refuse requests whose path or text is not a string.
## Laws
- `fabricate-do-not-hand-write` | 561 Group working discipline, dispatch-agents skill | 2026-09-04 | .claude/skills/dispatch-agents/SKILL.md | Applies to the imports of every new script and source module in the tree. | A direct node:fs, node:path, or node:child_process import where a house service exists is a defect a lot must not ship.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation, its import.meta.main guard, and downstream package-birth assays. | The package uses one executable ESM operation source file that is eligible for downstream staged package-birth assays.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/audit-node-builtin-imports-service","packageVersion":"1.1.0","license":"MIT","dependencies":{},"devDependencies":{}}
```
## Operation
```mjs path=scripts/audit-node-builtin-imports.mjs
#!/usr/bin/env node
// The house services that own what each Node built-in module does; an import of one outside a test file is a finding.
const HOUSE_OWNERS = Object.freeze({
  "node:fs": "@red-cup-engineering/file-services",
  "node:fs/promises": "@red-cup-engineering/file-services",
  "node:path": "@red-cup-engineering/filepath-services-section",
  "node:url": "@red-cup-engineering/project-file-url-filepath-service",
  "node:child_process": "@red-cup-engineering/execute-javascript-node-command-service",
});

/**
 * Audits one JavaScript source text for single-line imports of Node built-in modules that a house service owns, exempting the owner itself.
 * @param {object} request A record with the source path, its text, and optionally the name of the package it belongs to.
 * @returns {object} A NodeBuiltinImportAudit record.
 * @throws {TypeError} When path or text is not a string.
 */
export function auditNodeBuiltinImports(request) {
  if (typeof request?.path !== "string" || typeof request?.text !== "string") throw new TypeError("path and text are required");
  const findings = [];
  const lines = request.text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*import\b[^;]*?\bfrom\s+["'](node:[a-z_/]+)["']/u.exec(lines[index])
      ?? /^\s*import\s+["'](node:[a-z_/]+)["']/u.exec(lines[index]);
    if (match === null) continue;
    const houseService = HOUSE_OWNERS[match[1]];
    if (houseService === undefined || houseService === request.packageName) continue;
    findings.push({ line: index + 1, builtin: match[1], houseService });
  }
  return { type: "NodeBuiltinImportAudit", path: request.path, findings, count: findings.length };
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write("auditNodeBuiltinImports — Audits one JavaScript source text for single-line imports of Node built-in modules that a house service owns, exempting the owner itself.\n");
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.length > 0) process.stdout.write(`${JSON.stringify(auditNodeBuiltinImports(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/audit-node-builtin-imports.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { auditNodeBuiltinImports } from "../scripts/audit-node-builtin-imports.mjs";
test("finds an owned built-in import with its line and owner", () => {
  const audit = auditNodeBuiltinImports({ path: "scripts/x.mjs", text: "import { readFileSync } from \"node:fs\";\n" });
  assert.deepEqual(audit.findings, [{ line: 1, builtin: "node:fs", houseService: "@red-cup-engineering/file-services" }]);
  assert.equal(audit.count, 1);
});
test("ignores unowned built-ins", () => {
  const audit = auditNodeBuiltinImports({ path: "test/x.test.mjs", text: "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\n" });
  assert.equal(audit.count, 0);
});
test("exempts the owning package", () => {
  const audit = auditNodeBuiltinImports({ path: "scripts/read-file.mjs", text: "import { readFile } from \"node:fs/promises\";\n", packageName: "@red-cup-engineering/file-services" });
  assert.equal(audit.count, 0);
});
test("refuses a missing text", () => assert.throws(() => auditNodeBuiltinImports({ path: "x" }), /path and text are required/u));
```
## Examples
```json name="finds one owned import"
{"input":{"path":"scripts/x.mjs","text":"import { readFileSync } from \"node:fs\";\n"},"output":{"type":"NodeBuiltinImportAudit","path":"scripts/x.mjs","findings":[{"line":1,"builtin":"node:fs","houseService":"@red-cup-engineering/file-services"}],"count":1}}
```
## Traceability
- `owned-builtin-findings` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `fabricate-do-not-hand-write`, `node-esm-operation`
- `unowned-builtins-ignored` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `fabricate-do-not-hand-write`, `node-esm-operation`
- `owner-exempt` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `fabricate-do-not-hand-write`, `node-esm-operation`
- `missing-text-refusal` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `fabricate-do-not-hand-write`, `node-esm-operation`
