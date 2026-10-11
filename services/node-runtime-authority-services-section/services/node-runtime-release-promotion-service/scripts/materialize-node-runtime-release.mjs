#!/usr/bin/env node
import process from "node:process";
import { materializeNodeRuntimeRelease } from "../src/materialize-release.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
}

const receipt = await materializeNodeRuntimeRelease({
  stagedRoot: option("--staged"),
  releaseRoot: option("--release-root"),
  source: JSON.parse(option("--source", "{}")),
  derived: JSON.parse(option("--derived", "[]")),
  identity: option("--identity") === undefined ? undefined : JSON.parse(option("--identity")),
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
