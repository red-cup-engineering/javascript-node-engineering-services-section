#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { runWorkspaceSelection } from "../src/install-workspace-selection.mjs";

const [receiptPath, separator, ...args] = process.argv.slice(2);
if (!receiptPath || separator !== "--" || !args.length) throw new TypeError("usage: run-workspace-selection <install-receipt> -- <pnpm arguments>");
try {
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const result = await runWorkspaceSelection({ receipt, arguments: args, onOutput: text => process.stderr.write(text) });
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write(String(error?.stack ?? error) + "\n");
  process.exitCode = 1;
}
