#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { runWorkspaceSelection } from "../src/install-workspace-selection.mjs";

const [receiptPath, ...options] = process.argv.slice(2);
let deployOutput;
if (options[0] === "--deploy-output") {
  options.shift();
  deployOutput = options.shift();
  if (!deployOutput) throw new TypeError("--deploy-output requires an absolute output path");
}
const [separator, ...args] = options;
if (!receiptPath || separator !== "--" || !args.length) throw new TypeError("usage: run-workspace-selection <install-receipt> [--deploy-output <path>] -- <pnpm arguments>");
try {
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const result = await runWorkspaceSelection({ receipt, arguments: args, deployOutput, onOutput: text => process.stderr.write(text) });
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write(String(error?.stack ?? error) + "\n");
  process.exitCode = 1;
}
