#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { assessSourceInterfaces } from "../src/assess-source-interfaces.mjs";
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--selection") throw new TypeError("usage: assess-node-runtime-source --selection <authenticated source selection>");
const selection = JSON.parse(readFileSync(args[1], "utf8"));
const receipt = await assessSourceInterfaces({ workspace: selection.workspace, commit: selection.commit, importerIds: selection.importerIds });
process.stdout.write(JSON.stringify(receipt) + "\n");
if (receipt.status === "refused") process.exitCode = 1;
