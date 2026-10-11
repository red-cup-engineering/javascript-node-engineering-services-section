#!/usr/bin/env node
import { resolve } from "node:path";
import { readFileText } from "@red-cup-engineering/computer-file-engineering-services-section/read-file";
import { walkPosixPaths } from "@red-cup-engineering/computer-filepath-engineering-services-section/walk-posix-paths";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";
import { findServicesSectionRepositoryRoot, readServicesSectionLaw } from "./read-services-section-law.mjs";
import { foldDirectoryEntriesIntoServicesSectionForm } from "./fold-directory-entries-into-services-section-form.mjs";

// The same directories the agency read skips: dependencies, history, revival inventory and build
// output are not part of any section's standing form.
const EXCLUDES = Object.freeze(["node_modules", ".git", ".pnpm-store", "legacy", "_archive", "dist", ".cache", ".tmp", "coverage"]);
// A section's own package is its root manifest; the units it deploys (apps, sites, deployments,
// tools) are packages it holds one directory down.
const HELD_PACKAGE = /^(?:(?:apps|sites|deployments|tools)\/[^/]+\/)?package\.json$/u;

const operationDefinition = {
  name: "readServicesSectionTree",
  description: "Reads every services section under a root — each directory that stands under a services/ directory — into its ServicesSectionForm record, with the README and package manifest it describes itself by, in one walk of the root.",
  inputSchema: {
    type: "object",
    required: ["root"],
    properties: { root: { type: "string", minLength: 1 } },
  },
  outputSchema: {
    type: "object",
    required: ["type", "version", "root", "sections"],
    properties: {
      type: { const: "ServicesSectionTree" },
      version: { const: 1 },
      root: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          required: ["form", "readme", "packageJson", "packages"],
          properties: {
            form: { type: "object" },
            readme: { anyOf: [{ type: "string" }, { type: "null" }] },
            packageJson: { anyOf: [{ type: "object" }, { type: "null" }] },
            packages: {
              type: "array",
              items: { type: "object", required: ["path", "manifest"], properties: { path: { type: "string" }, manifest: { type: "object" } } },
            },
          },
        },
      },
    },
  },
};

/** The section a root-relative path stands in: its deepest ancestor directory whose parent is named services. */
function sectionOf(parts, end) {
  for (let index = end - 1; index >= 1; index -= 1) if (parts[index - 1] === "services") return parts.slice(0, index + 1).join("/");
  return undefined;
}

const readManifest = async (path) => {
  try { return JSON.parse(await readFileText(path)); }
  catch (error) { if (error?.code === "ENOENT" || error instanceof SyntaxError) return null; throw error; }
};

const readOptional = async (path) => {
  try { return await readFileText(path); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
};

/**
 * Reads every services section under a root — each directory that stands under a services/ directory — into its ServicesSectionForm record, with the README and package manifest it describes itself by, in one walk of the root.
 * @param {object} request A record with `root` (the directory the section paths are relative to).
 * @returns {Promise<object>} A ServicesSectionTree: `{type, version, root, sections}`, each section `{form, readme, packageJson, packages}` in path order, `packages` being its own manifest and those of the apps, sites, deployments and tools it holds, each at its section-relative directory ("" for the section's own). A section's entries are its own files and a `services/<child>/` entry per nested section, as foldDirectoryEntriesIntoServicesSectionForm reads them.
 * @throws {TypeError} When root is not a non-empty string.
 */
export async function readServicesSectionTree(request) {
  if (typeof request?.root !== "string" || request.root.length === 0) throw new TypeError("root is required");
  const root = resolve(request.root);
  const { contentTaxonomy } = await readServicesSectionLaw(await findServicesSectionRepositoryRoot(root));
  const walk = await walkPosixPaths({ root, excludes: [...EXCLUDES], result: "paths" });
  const entriesOf = new Map();
  const enter = (section) => {
    if (entriesOf.has(section)) return;
    entriesOf.set(section, []);
    const parts = section.split("/");
    const parent = sectionOf(parts, parts.length - 1);
    if (parent === undefined) return;
    enter(parent);
    entriesOf.get(parent).push(`${section.slice(parent.length + 1)}/`);
  };
  for (const file of walk.files) {
    const parts = file.split("/");
    const section = sectionOf(parts, parts.length - 1);
    if (section === undefined) continue;
    enter(section);
    entriesOf.get(section).push(file.slice(section.length + 1));
  }
  const sections = await Promise.all([...entriesOf.keys()].sort().map(async (path) => {
    const entries = entriesOf.get(path);
    const [readme, held] = await Promise.all([
      entries.includes("README.md") ? readOptional(resolve(root, path, "README.md")) : null,
      Promise.all(entries.filter((entry) => HELD_PACKAGE.test(entry)).sort().map(async (entry) => ({
        path: entry.slice(0, -"package.json".length).replace(/\/$/u, ""),
        manifest: await readManifest(resolve(root, path, entry)),
      }))),
    ]);
    const packages = held.filter((held) => held.manifest !== null).map(Object.freeze);
    const packageJson = packages.find((held) => held.path === "")?.manifest ?? null;
    return Object.freeze({ form: foldDirectoryEntriesIntoServicesSectionForm({ path, entries, packageJson }, contentTaxonomy), readme, packageJson, packages: Object.freeze(packages) });
  }));
  return Object.freeze({ type: "ServicesSectionTree", version: 1, root, sections: Object.freeze(sections) });
}

if (import.meta.main) {
  process.exitCode = (await runJavascriptNodeOperation(
    { ...operationDefinition, operation: readServicesSectionTree },
    { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout },
  )).exitCode;
}
