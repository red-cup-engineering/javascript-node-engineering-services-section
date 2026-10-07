#!/usr/bin/env node
import { runJavascriptNodeOperation } from "../src/operation.mjs";
// The founder ruled pure wrappers over Node builtins deleted: a house scope owns a capability,
// not a passthrough over node:fs. What the laws still need audited is an external dependency —
// any import that is neither a Node builtin, a relative path, nor one of the house's own scopes.
const HOUSE_SCOPES = Object.freeze([
  "@red-cup-engineering/", "@lenticule-science/", "@561-group/", "@emsenn/", "@causeway-services/", "@coesite-operations/",
]);

function isExternalSpecifier(specifier) {
  return !specifier.startsWith("node:") && !specifier.startsWith(".") && !HOUSE_SCOPES.some((scope) => specifier.startsWith(scope));
}

/**
 * Audits one JavaScript source text for single-line imports of external dependencies: specifiers
 * that are not a Node built-in, not a relative path, and not a house scope.
 * @param {object} request A record with the source path and its text.
 * @returns {object} An ExternalImportAudit record.
 * @throws {TypeError} When path or text is not a string.
 */
export function auditExternalImports(request) {
  if (typeof request?.path !== "string" || typeof request?.text !== "string") throw new TypeError("path and text are required");
  const findings = [];
  const lines = request.text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*import\b[^;]*?\bfrom\s+["']([^"']+)["']/u.exec(lines[index])
      ?? /^\s*import\s+["']([^"']+)["']/u.exec(lines[index]);
    if (match === null) continue;
    if (!isExternalSpecifier(match[1])) continue;
    findings.push({ line: index + 1, specifier: match[1] });
  }
  return { type: "ExternalImportAudit", path: request.path, findings, count: findings.length };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({
    name: "audit-external-imports",
    description: "Audit an explicit source reading for imported external dependencies.",
    operation: auditExternalImports,
    inputSchema: {"type": "object", "required": ["path", "text"], "properties": {"path": {"type": "string"}, "text": {"type": "string"}}},
    outputSchema: {"type": "object"},
  }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
