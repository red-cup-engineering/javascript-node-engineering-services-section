#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fabricatePnpmWorkspace } from "../src/fabricate-pnpm-workspace.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

const specification = JSON.parse(await readFile(option("--specification"), "utf8"));
process.stdout.write(`${JSON.stringify(await fabricatePnpmWorkspace({ specification, outputDirectory: option("--output") }), null, 2)}\n`);
