#!/usr/bin/env node
import process from "node:process";
import { promoteNodeRuntimeRelease } from "../src/promote-release.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
}

const receipt = await promoteNodeRuntimeRelease({
  releaseRoot: option("--release-root"),
  digest: option("--digest"),
  pointerName: option("--pointer", "current"),
  receiptRoot: option("--receipt-root"),
  commit: option("--commit"),
  derived: option("--derived") === undefined ? undefined : JSON.parse(option("--derived")),
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
