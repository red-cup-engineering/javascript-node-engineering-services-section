#!/usr/bin/env node
import { runJavascriptNodeOperation } from "../src/operation.mjs";
// The house services that own what each substrate module does (Node built-ins and third-party
// packages alike); an import of one outside a test file or the owner's own wrapper is a finding.
// A value of null names a substrate with no house wrapper yet: the finding is "build the wrapper
// upstream," not "import something else."
//
// This is a distinct capability from `audit-external-imports.mjs`: that script audits for
// *external* (non-house, non-relative, non-`node:`) dependencies under the founder's ruling that
// pure wrappers over Node builtins are deleted going forward — a house scope owns a capability,
// not a passthrough over `node:fs`. This script keeps auditing the closed, curated table of
// builtins that already have a named house owner, for callers (such as MetroPlat's
// checkout-health monitor) that still read that specific, narrower signal.
const HOUSE_OWNERS = Object.freeze({
  "node:fs": "@red-cup-engineering/computer-file-engineering-services-section",
  "node:fs/promises": "@red-cup-engineering/computer-file-engineering-services-section",
  "node:path": "@red-cup-engineering/computer-filepath-engineering-services-section/filepath",
  "node:child_process": "@red-cup-engineering/execute-javascript-node-command-service",
  "@modelcontextprotocol/sdk/server/stdio.js": null,
  "@modelcontextprotocol/sdk/server/index.js": null,
});

/**
 * Audits one JavaScript source text for single-line imports of substrate modules (Node built-ins
 * or third-party packages) that a house service owns or should own, exempting the owner itself.
 * @param {object} request A record with the source path, its text, and optionally the name of the package it belongs to.
 * @returns {object} A NodeBuiltinImportAudit record.
 * @throws {TypeError} When path or text is not a string.
 */
export function auditNodeBuiltinImports(request) {
  if (typeof request?.path !== "string" || typeof request?.text !== "string") throw new TypeError("path and text are required");
  const findings = [];
  const lines = request.text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*import\b[^;]*?\bfrom\s+["']([^"']+)["']/u.exec(lines[index])
      ?? /^\s*import\s+["']([^"']+)["']/u.exec(lines[index]);
    if (match === null) continue;
    if (!(match[1] in HOUSE_OWNERS)) continue;
    const houseService = HOUSE_OWNERS[match[1]];
    if (houseService === request.packageName) continue;
    findings.push({
      line: index + 1,
      builtin: match[1],
      houseService: houseService ?? null,
      ...(houseService === null ? { needsUpstreamWrapper: true } : {}),
    });
  }
  return { type: "NodeBuiltinImportAudit", path: request.path, findings, count: findings.length };
}

/**
 * Filters one file's substrate-import findings down to those genuinely introduced since an earlier
 * text, so an edit that does not add a new banned import is not penalized for pre-existing debt.
 * @param {object} request A record with the file's path, its resulting text, its earlier text (or
 *   undefined for a brand-new file), and optionally the name of the package it belongs to.
 * @returns {object[]} The findings present in the resulting text but not in the earlier text.
 * @throws {TypeError} When path or text is not a string.
 */
export function newlyIntroducedNodeBuiltinImportFindings(request) {
  const afterFindings = auditNodeBuiltinImports(request).findings;
  if (typeof request.beforeText !== "string") return afterFindings;
  const beforeFindings = auditNodeBuiltinImports({ path: request.path, text: request.beforeText, packageName: request.packageName }).findings;
  const alreadyPresent = new Set(beforeFindings.map((finding) => finding.builtin));
  return afterFindings.filter((finding) => !alreadyPresent.has(finding.builtin));
}


if (import.meta.main) {
  const result = await runJavascriptNodeOperation({
    name: "audit-node-builtin-imports",
    description: "Audit an explicit source reading for imported substrate capabilities.",
    operation: auditNodeBuiltinImports,
    inputSchema: {"type": "object", "required": ["path", "text"], "properties": {"path": {"type": "string"}, "text": {"type": "string"}}},
    outputSchema: {"type": "object"},
  }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
