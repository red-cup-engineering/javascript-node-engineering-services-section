#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileNodeRuntime } from "../src/compile-node-runtime.mjs";

const args = process.argv.slice(2);
const entries = [];
const jobDirectories = [];
let selection, runtime, preserveSymlinks = false;
for (let index = 0; index < args.length; index += 2) {
  if (args[index] === "--preserve-symlinks") { preserveSymlinks = true; index--; continue; }
  if (!["--entry", "--selection", "--runtime", "--job-directory"].includes(args[index]) || !args[index + 1]) throw new TypeError("usage: compile-node-runtime [--entry <module>...] [--selection <installed receipt> --runtime <packed runtime>] [--job-directory <runtime-relative directory>...] [--preserve-symlinks]");
  if (args[index] === "--entry") entries.push(args[index + 1]);
  else if (args[index] === "--selection") selection = JSON.parse(readFileSync(args[index + 1], "utf8"));
  else if (args[index] === "--job-directory") jobDirectories.push(args[index + 1]);
  else runtime = resolve(args[index + 1]);
}
try {
  const receipt = await compileNodeRuntime({ entries, selection, runtime, jobDirectories, preserveSymlinks });
  process.stdout.write(JSON.stringify(receipt) + "\n");
} catch (error) {
  if (error.receipt) process.stdout.write(JSON.stringify(error.receipt) + "\n");
  throw error;
}
