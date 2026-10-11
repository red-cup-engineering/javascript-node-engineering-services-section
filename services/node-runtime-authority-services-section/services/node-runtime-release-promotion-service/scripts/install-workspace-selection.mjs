#!/usr/bin/env node
import { installWorkspaceSelection } from "../src/install-workspace-selection.mjs";

const usage = "node install-workspace-selection.mjs --workspace <git-checkout> --selector <pnpm-filter> --state-dir <outside-checkout> [--store-dir <path>] [--pnpm <executable>] [--prepare-only]";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(usage);
} else {
  const flags = {};
  const names = new Set(["--workspace", "--selector", "--state-dir", "--store-dir", "--pnpm"]);
  try {
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "--prepare-only") { flags.prepareOnly = true; continue; }
      if (!names.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new TypeError(usage);
      flags[args[i].slice(2)] = args[++i];
    }
    const result = await installWorkspaceSelection({
      workspace: flags.workspace, selector: flags.selector, stateDirectory: flags["state-dir"],
      storeDirectory: flags["store-dir"], pnpm: flags.pnpm, prepareOnly: flags.prepareOnly,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n");
    process.exitCode = 1;
  }
}
