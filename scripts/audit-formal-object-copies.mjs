#!/usr/bin/env node
// Audits copies of the house's formal objects: each object has one implementation, and a module
// that restates part of it by hand, instead of reading it from that implementation, is a finding.
// FOUR is the first: its points are named only through the data layer's four.mjs (readingFamilies,
// readingSchema, readingOfSides, sidesOfReading), so a source that spells three or more points of
// one family is a name table or a case analysis over FOUR, which is FOUR restated.
//
// As a ratchet (--base, --candidate) a candidate may remove copies, never add one; findings count by
// object and family, so a copy that moves to another file or package is not a new one. Read from git objects
// (see git-tree-at-ref), only the files a candidate changes, unless it changes this audit, when every
// audited source is read at both commits.
//
//   node audit-formal-object-copies.mjs [--root <repository>] [--summary]
//   node audit-formal-object-copies.mjs --base <ref> --candidate <ref> [--root <repository>] [--summary]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readingFamilies } from "@red-cup-engineering/computer-data-engineering-services-section/four";
import { isAuditedSource } from "./audit-layer-imports.mjs";
import { argument } from "../src/argv.mjs";
import { discoverHousePackages } from "../src/discover-house-packages.mjs";
import { compareTallies, owningPackage, packageDirectories, tallyFindings } from "../src/finding-ratchet.mjs";
import { changedPaths, gitTreeAtRef } from "../src/git-tree-at-ref.mjs";

const AUDITED_TREE = "lib/emsenn/services/561-group/";
const SELF = "javascript-node-services-section/scripts/audit-formal-object-copies.mjs";
const LITERAL = /["'`]([^"'`\n]{1,24})["'`]/gu;

/** A literal set's FOUR copies: each family three or more of whose point names it spells. */
function fourCopies(literals) {
  return Object.entries(readingFamilies).filter(([, names]) => names.filter((name) => literals.has(name)).length >= 3).map(([family]) => family);
}

/** The formal objects audited for copies: where each is implemented, how a copy reads, and what to use instead. */
export const formalObjects = Object.freeze([
  Object.freeze({
    object: "FOUR",
    implementation: "computer-data-engineering-services-section/src/four.mjs",
    remedy: "name FOUR's points through four.mjs: readingFamilies, readingSchema, readingOfSides, sidesOfReading",
    copies: fourCopies,
  }),
]);

/** True when a path is audited for copies: a source under the house tree that is not a test, a document's evidence, generated output, or an object's own implementation. */
export function isCopyAudited(path) {
  return path.startsWith(AUDITED_TREE) && isAuditedSource(path)
    && !/\/(test|tests|__tests__|generated|content\/text)\//u.test(path) && !/\.test\.[cm]?[jt]s$/u.test(path)
    && !formalObjects.some(({ implementation }) => path.endsWith(`/${implementation}`));
}

/** A generated source says so on its first line; its copies are its generator's. */
const GENERATED = /^\s*\/\/\s*(generated|@generated)\b|do not (hand-)?edit/iu;

/** The copies one source holds: one finding per object and family it restates. */
export function formalObjectCopiesOfSource(path, text) {
  if (GENERATED.test(text.slice(0, text.indexOf("\n") >>> 0))) return [];
  const literals = new Set([...text.matchAll(LITERAL)].map((match) => match[1]));
  return formalObjects.flatMap(({ object, copies }) => copies(literals).map((family) => Object.freeze({ importer: path, object, family })));
}

/** A copy's ratchet key: the object it restates and the family it spells. Where it sits is attribution. */
const KEY_FIELDS = Object.freeze(["object", "family"]);

function tallyAt(tree, paths) {
  const findings = [...tree.read(paths)].flatMap(([path, buffer]) => formalObjectCopiesOfSource(path, buffer.toString("utf8")));
  return tallyFindings(findings, (finding) => `${finding.object}\t${finding.family}`);
}

/** The ratchet verdict between two tree views of one repository (see git-tree-at-ref). */
export function ratchetFormalObjectCopiesOfTrees(before, after) {
  const changed = changedPaths(before, after);
  const full = changed.some((path) => path.endsWith(`/${SELF}`));
  const paths = full ? [...new Set([...before.blobs.keys(), ...after.blobs.keys()])] : changed;
  const audited = paths.filter(isCopyAudited);
  const basePaths = audited.filter((path) => before.blobs.has(path));
  const candidatePaths = audited.filter((path) => after.blobs.has(path));
  const { rose, fell } = compareTallies(tallyAt(before, basePaths), tallyAt(after, candidatePaths), KEY_FIELDS);
  const remedies = new Map(formalObjects.map(({ object, remedy }) => [object, remedy]));
  return Object.freeze({
    kind: "formal-object-copies:ratchet",
    base: before.commit,
    candidate: after.commit,
    mode: full ? "full" : "changed",
    audited: Object.freeze({ base: basePaths.length, candidate: candidatePaths.length }),
    added: rose.reduce((sum, row) => sum + row.candidate - row.base, 0),
    removed: fell.reduce((sum, row) => sum + row.base - row.candidate, 0),
    rose: Object.freeze(rose),
    fell: Object.freeze(fell),
    admitted: rose.length === 0,
    reasons: Object.freeze(rose.map((row) => `formal-object-copy-added:${row.object}:${row.family}:${row.base}->${row.candidate} in ${row.importers.join(", ")} (${remedies.get(row.object)})`)),
  });
}

/** Every copy in a working tree, with a census by object and family. */
export function auditFormalObjectCopies(root) {
  const map = discoverHousePackages(root);
  const directories = packageDirectories(map);
  const tree = gitTreeAtRef(root, "HEAD");
  const findings = [...tree.blobs.keys()].filter(isCopyAudited).flatMap((path) => {
    let text;
    try { text = readFileSync(resolve(root, path), "utf8"); } catch { return []; }
    return formalObjectCopiesOfSource(path, text).map((finding) => ({ ...finding, package: owningPackage(finding.importer, directories) }));
  });
  const census = {};
  for (const { object, family } of findings) census[`${object}:${family}`] = (census[`${object}:${family}`] ?? 0) + 1;
  return { findings, census };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const root = resolve(argument("--root", args) ?? process.cwd());
  const base = argument("--base", args);
  const candidate = argument("--candidate", args);
  if (base !== undefined && candidate !== undefined) {
    const verdict = ratchetFormalObjectCopiesOfTrees(gitTreeAtRef(root, base), gitTreeAtRef(root, candidate));
    const { rose, fell, ...summary } = verdict;
    process.stdout.write(`${JSON.stringify(args.includes("--summary") ? summary : verdict, null, 2)}\n`);
    process.exitCode = verdict.admitted ? 0 : 1;
  } else {
    const report = auditFormalObjectCopies(root);
    process.stdout.write(`${JSON.stringify(args.includes("--summary") ? { findings: report.findings.length, census: report.census } : report, null, 2)}\n`);
  }
}
