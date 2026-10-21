#!/usr/bin/env node
/**
 * `node --import <this file> …` registers the house package resolver for the
 * process. It discovers package manifests from HOUSE_ROOT, or else from the
 * repository tree this file lives in (a checkout, or a release of one),
 * whatever the working directory is, rather than depending on a maintained
 * location registry.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function repositoryRoot(start) {
  for (let directory = start; ; directory = dirname(directory)) {
    // A checkout's root holds .git; a release tree's root holds its release receipt.
    if (existsSync(join(directory, ".git")) || existsSync(join(directory, "release-receipt.json"))) return directory;
    if (dirname(directory) === directory) return process.cwd();
  }
}

const bindingFile = process.env.HOUSE_PACKAGE_BINDINGS;
if (bindingFile !== undefined && statSync(bindingFile).size > 1024 * 1024)
  throw new RangeError("house supplier bindings exceed one MiB");
const data = bindingFile === undefined
  ? { root: process.env.HOUSE_ROOT ?? repositoryRoot(dirname(fileURLToPath(import.meta.url))) }
  : { bindings: JSON.parse(readFileSync(bindingFile, "utf8")) };
register(new URL("../src/resolve-house-package.mjs", import.meta.url), { data });
