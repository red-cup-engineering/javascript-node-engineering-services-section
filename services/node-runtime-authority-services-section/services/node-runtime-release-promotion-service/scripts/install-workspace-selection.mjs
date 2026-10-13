#!/usr/bin/env node
import { installWorkspaceSelection } from "../src/install-workspace-selection.mjs";
import { writeFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

const usage = "node install-workspace-selection.mjs --workspace <git-checkout> (--selector <pnpm-filter> | --importer <source-path>...) --state-dir <outside-checkout> [--store-dir <path>] [--pnpm <executable>] [--revision <commit>] [--prepare-only | --plan-only] [--materialize-sources] [--receipt <output-file>]";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(usage);
} else {
  const flags = { importers: [] };
  const names = new Set(["--workspace", "--selector", "--state-dir", "--store-dir", "--pnpm", "--importer", "--revision", "--receipt"]);
  try {
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "--prepare-only") { flags.prepareOnly = true; continue; }
      if (args[i] === "--plan-only") { flags.planOnly = true; continue; }
      if (args[i] === "--materialize-sources") { flags.materializeSources = true; continue; }
      if (!names.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new TypeError(usage);
      if (args[i] === "--importer") flags.importers.push(args[++i]);
      else flags[args[i].slice(2)] = args[++i];
    }
    const result = await installWorkspaceSelection({
      workspace: flags.workspace, expectedCommit: flags.revision, selector: flags.selector, stateDirectory: flags["state-dir"],
      storeDirectory: flags["store-dir"], pnpm: flags.pnpm, prepareOnly: flags.prepareOnly,
      importerIds: flags.importers.length ? flags.importers : undefined,
      planOnly: flags.planOnly, materializeSources: flags.materializeSources,
    });
    const text = JSON.stringify(result, null, 2) + "\n";
    if (flags.receipt !== undefined) {
      const file = resolve(flags.receipt), temporary = file + ".tmp." + process.pid;
      try {
        await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
    } else process.stdout.write(text);
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n");
    process.exitCode = 1;
  }
}
