#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { assessSourceInterfaces } from "../src/assess-source-interfaces.mjs";
const args = process.argv.slice(2);
let selection, entries = [];
for (let index = 0; index < args.length; index += 2) {
  if (!["--selection", "--entry"].includes(args[index]) || !args[index + 1]) throw new TypeError("usage: assess-node-runtime-source --selection <authenticated source selection> [--entry <source-program>...]");
  if (args[index] === "--selection") { if (selection) throw new TypeError("one source selection required"); selection = JSON.parse(readFileSync(args[index + 1], "utf8")); }
  else entries.push(args[index + 1]);
}
if (!selection) throw new TypeError("source selection required");
const receipt = await assessSourceInterfaces({ workspace: selection.workspace, commit: selection.commit, importerIds: selection.importerIds, entries });
process.stdout.write(JSON.stringify(receipt) + "\n");
if (receipt.status === "refused") process.exitCode = 1;
