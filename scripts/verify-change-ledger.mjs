#!/usr/bin/env node
// The writer's end-of-work check: every path on the ledger (after the same normalization and
// directory expansion the screen uses) must actually record a change — it differs from HEAD, it is
// new, or it existed at HEAD and is now gone. A path that is byte-identical to HEAD, or that never
// existed on either side, is an offense: the ledger claims a change that is not there.
//
//   node verify-change-ledger.mjs --ledger <file> [--root /home/emsenn/info]
//
// Prints a JSON summary to stdout and one offender line per path to stderr; exit 1 when any offend.
// With packages discovered from manifests, it also reports —
// as a warning only, never an offense — the untracked, non-ignored source files under the
// ledger's owning packages that the ledger omits, same as the gate's omittedUntracked check.
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { classifyChangeState, expandEntries, omittedUntrackedFiles, readHeldAreas, readLedgerEntries } from "./screen-change-ledger.mjs";
import { packagesForLedger } from "./run-package-suites.mjs";
import { argument } from "../src/argv.mjs";
import { discoverHousePackages } from "../src/discover-house-packages.mjs";

const OFFENSE_STATES = new Set(["unchanged", "absent-both"]);

/**
 * Verifies every expanded ledger path records a real change against HEAD.
 * @returns {{ok: boolean, offenders: {path: string, reason: string}[], summary: object, omittedUntracked: object[]}}
 */
export function verifyChangeLedger({ ledgerFile, root, map, heldAreas }) {
  const entries = readLedgerEntries(ledgerFile, root);
  const expanded = expandEntries(entries, root);
  const offenders = [];
  for (const path of expanded) {
    const state = classifyChangeState(path, root);
    if (OFFENSE_STATES.has(state)) offenders.push({ path, reason: state });
  }
  const summary = { input: entries.length, expanded: expanded.length, verified: expanded.length - offenders.length, offenders: offenders.length };
  const omittedUntracked = map ? omittedUntrackedFiles({ root, packages: packagesForLedger(ledgerFile, root, map), ledgerPaths: expanded, heldAreas }) : [];
  return { ok: offenders.length === 0, offenders, summary, omittedUntracked };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const root = resolve(argument("--root", args) || process.cwd());
  const here = dirname(new URL(import.meta.url).pathname);
  const map = discoverHousePackages(root);
  const heldAreas = readHeldAreas(argument("--held-areas", args) || join(here, "../data/records/house-held-areas.json"));
  const ledgerFile = argument("--ledger", args);
  if (!ledgerFile) { process.stderr.write("usage: verify-change-ledger.mjs --ledger <file> [--root <repo>] [--held-areas <house-held-areas.json>]\n"); process.exit(2); }
  const { ok, offenders, summary, omittedUntracked } = verifyChangeLedger({ ledgerFile, root, map, heldAreas });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  for (const { path, reason } of offenders) process.stderr.write(`${reason}: ${path}\n`);
  for (const { package: pkg, path, importedBy } of omittedUntracked) process.stderr.write(`warning: omitted-untracked: ${path} (${pkg})${importedBy.length ? ` importedBy=${importedBy.join(",")}` : ""}\n`);
  process.exitCode = ok ? 0 : 1;
}
