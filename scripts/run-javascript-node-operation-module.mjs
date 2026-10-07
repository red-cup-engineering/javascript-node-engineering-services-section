#!/usr/bin/env node
/**
 * `run-javascript-node-operation-module <module> [argument...]` executes the runnable
 * declaration a module exports (`operation`, `catalog` or `command`) as this process, over
 * its standard streams. <module> is a file path, or a house package specifier resolved
 * through the house package resolver. Packages below the code layer carry declarations
 * and no process entry of their own, so this is their command face.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runJavascriptNodeOperationModule } from "../src/operation.mjs";

const USAGE = "usage: run-javascript-node-operation-module <module-path-or-specifier> [argument...]\n";

/** Run one module named by path or house specifier over explicitly supplied streams. */
export async function runJavascriptNodeOperationModuleProcess([target, ...rest], streams) {
  if (target === undefined || target === "--help") {
    (target === undefined ? streams.standardError : streams.standardOutput).write(USAGE);
    return Object.freeze({ exitCode: target === undefined ? 64 : 0 });
  }
  const path = resolve(target);
  let specifier = target;
  if (existsSync(path)) specifier = pathToFileURL(path).href;
  else await import("./register-house-resolver.mjs");
  return runJavascriptNodeOperationModule(await import(specifier), { ...streams, arguments: rest });
}

if (import.meta.main) {
  // A reader that closes the pipe early (`| head`) ends the command, not as a failure.
  process.stdout.on("error", (error) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  const result = await runJavascriptNodeOperationModuleProcess(process.argv.slice(2), { standardInput: process.stdin, standardOutput: process.stdout, standardError: process.stderr });
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
