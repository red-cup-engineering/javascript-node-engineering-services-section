#!/usr/bin/env node
import { assessSourceInterfaces } from "../src/assess-source-interfaces.mjs";
import { readNodeWorkspace } from "../src/read-workspace-source.mjs";
const args = process.argv.slice(2), options = {}, entries = [];
for (let index = 0; index < args.length; index += 2) {
  if (!["--workspace", "--pnpm", "--entry"].includes(args[index]) || !args[index + 1]) throw new TypeError("usage: assess-node-runtime-source --workspace <source root> [--pnpm <executable>] [--entry <source-program>...]");
  if (args[index] === "--entry") entries.push(args[index + 1]);
  else options[args[index].slice(2)] = args[index + 1];
}
const { workspace, commit, importerIds } = await readNodeWorkspace(options);
const result = await assessSourceInterfaces({ workspace, commit, importerIds, entries, recursiveSource: true });
process.stdout.write(JSON.stringify(result) + "\n");
if (result.status === "refused") process.exitCode = 1;
