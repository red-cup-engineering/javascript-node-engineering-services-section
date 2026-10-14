#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { runWorkspaceSelection } from "../src/install-workspace-selection.mjs";

const [receiptPath, ...options] = process.argv.slice(2);
let deployOutput,deployImporter;
while(options[0]!=="--"&&options.length){
  const flag=options.shift(),value=options.shift();
  if(!value||!["--deploy-output","--deploy-importer"].includes(flag))throw new TypeError("explicit deploy output and importer options required");
  if(flag==="--deploy-output"){if(deployOutput!==undefined)throw new TypeError("duplicate deploy output");deployOutput=value;}
  else {if(deployImporter!==undefined)throw new TypeError("duplicate deploy importer");deployImporter=value;}
}
if((deployOutput===undefined)!==(deployImporter===undefined))throw new TypeError("deploy output requires its explicit selected importer");
const [separator, ...args] = options;
if (!receiptPath || separator !== "--" || !args.length) throw new TypeError("usage: run-workspace-selection <install-receipt> [--deploy-output <path> --deploy-importer <path>] -- <pnpm arguments>");
try {
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const result = await runWorkspaceSelection({ receipt, arguments: args, deployOutput, deployImporter, onOutput: text => process.stderr.write(text) });
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write(String(error?.stack ?? error) + "\n");
  process.exitCode = 1;
}
