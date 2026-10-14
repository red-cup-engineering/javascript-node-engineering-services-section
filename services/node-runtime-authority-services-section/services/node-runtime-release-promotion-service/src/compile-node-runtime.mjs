#!/usr/bin/env node
import { build } from "esbuild";
import { declaredNodeRuntimeEntries } from "./source-entrances.mjs";
import { parseJavaScript } from "@red-cup-engineering/javascript-node-services-section/javascript-parser";
import assert from "node:assert/strict";
import { verifyWorkspaceSelection } from "./install-workspace-selection.mjs";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { nodeJobProgramEntries } from "@red-cup-engineering/node-job-service";


/** Compile source bindings without executing the application or replacing its installed layout. */
export async function compileNodeRuntime({ entries: requestedEntries = [], selection, runtime: runtimePath, jobDirectories = [], preserveSymlinks = false } = {}) {
  if (!Array.isArray(requestedEntries) || requestedEntries.some(entry => typeof entry !== "string" || !entry)) {
    throw new TypeError("explicit source entries must be nonempty paths");
  }
  const entries = [...requestedEntries];
  const runtime = runtimePath === undefined ? undefined : resolve(runtimePath);
  if (!Array.isArray(jobDirectories) || jobDirectories.some(path => typeof path !== "string" || !path)) throw new TypeError("job directories must be nonempty paths");
  if (jobDirectories.length && runtime === undefined) throw new TypeError("job programs must be compiled from their packed runtime");
  for (const jobsDirectory of jobDirectories) entries.push(...nodeJobProgramEntries({ runtimeRoot: runtime, jobsDirectory }));
if (runtime !== undefined && selection === undefined) throw new TypeError("a packed runtime requires its installed selection receipt");
const failures = [];
const selectedNames = new Set();
const inspectedPackages = [];
const externalModules = new Set();
const inspectedModules = new Set();
const vendorReexports = [];
const starExports = new Map();
function isStarExport(importer, specifier) {
  if (!importer || !/\.[cm]?js$/u.test(importer)) return false;
  if (!starExports.has(importer)) {
    const program = parseJavaScript(readFileSync(importer, "utf8"));
    starExports.set(importer, new Set(program.body.filter(node => node.type === "ExportAllDeclaration").map(node => node.source.value)));
  }
  return starExports.get(importer).has(specifier);
}
function carrier(root, manifest) {
  inspectedPackages.push({ name: manifest.name, version: manifest.version, directory: root });
  const observed = declaredNodeRuntimeEntries(root, manifest);
  entries.push(...observed.entries);
  failures.push(...observed.missing.map(item => manifest.name + ": " + item.reason + " " + item.declaration));
}
if (selection !== undefined) {
  await verifyWorkspaceSelection(selection);
  if (selection.type !== "NodeRuntimeWorkspaceSelectionInstallReceipt" || selection.status !== "installed" || selection.sourceConfigurationUnchanged !== true) throw new TypeError("an installed unchanged selection is required");
  const manifests = selection.importerIds.map(id => ({ id, manifest: JSON.parse(readFileSync(join(selection.workspace, id, "package.json"), "utf8")) }));
  const selected = new Map(manifests.map(item => [item.manifest.name, item]));
  const comparePacked = (manifest, source) => {
    for (const field of ["name", "version", "type", "exports", "bin", "main", "files"]) {
      assert.deepEqual(manifest[field], source.manifest[field], "packed declaration differs from selected source: " + manifest.name + "." + field);
    }
  };
  for (const name of selected.keys()) selectedNames.add(name);
  if (runtime === undefined) for (const { id, manifest } of manifests) carrier(resolve(selection.workspace, id), manifest);
  else {
    // Inspect only the portable pnpm closure and its two package-directory levels.
    const seen = new Set();
    const rootManifest = JSON.parse(readFileSync(join(runtime, "package.json"), "utf8"));
    const rootSource = selected.get(rootManifest.name);
    if (!rootSource) throw new TypeError("packed runtime root is outside the selected source");
    comparePacked(rootManifest, rootSource);
    seen.add(realpathSync(runtime));
    carrier(runtime, rootManifest);
    const modules = [join(runtime, "node_modules"), ...readdirSync(join(runtime, "node_modules/.pnpm"), { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== "node_modules").map(entry => join(runtime, "node_modules/.pnpm", entry.name, "node_modules"))];
    for (const directory of modules) {
      if (!existsSync(directory)) continue;
      for (const entry of readdirSync(directory)) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const roots = entry.startsWith("@") ? readdirSync(join(directory, entry)).map(name => join(directory, entry, name)) : [join(directory, entry)];
        for (const root of roots) {
          const file = join(root, "package.json");
          if (!existsSync(file)) continue;
          const manifest = JSON.parse(readFileSync(file, "utf8")), source = selected.get(manifest.name);
          const identity = realpathSync(root);
          if (!source || seen.has(identity)) continue;
          comparePacked(manifest, source);
          seen.add(identity); carrier(identity, manifest);
        }
      }
    }
  }
}
if (failures.length) throw new Error("Incomplete package carriers:\n" + failures.join("\n"));
if (!entries.length) throw new TypeError("at least one runtime entrance is required");
// Compile the actual source entrances and their static dependency bindings.
// The bundled output is an in-memory compiler product, never a substitute for
// the installed package layout that owns file URLs and runtime assets.
let compilation;
try { compilation = await build({ metafile: true, entryPoints: [...new Set(entries)], bundle: true, splitting: true, write: false, outdir: "compiled-runtime", preserveSymlinks,
  platform: "node", format: "esm", target: "node24", logLevel: "error",
  plugins: [{ name: "installed-third-party-boundaries", setup(builder) {
    builder.onLoad({ filter: /./u, namespace: "file" }, args => { inspectedModules.add(args.path); });
    builder.onResolve({ filter: /^(?:@[^/]+\/)?[^./][^:]*$/ }, async (args) => {
      if (args.pluginData?.installedVendor === true) return;
      const packageName = args.path.startsWith("@") ? args.path.split("/").slice(0, 2).join("/") : args.path.split("/")[0];
      if (selection === undefined || selectedNames.has(packageName)) return;
      // Ordinary vendor imports remain in their installed Node layout. A star
      // re-export needs the genuine vendor declarations for static symbol
      // projection. Only this in-memory compiler follows that source edge;
      // no bundle is deployed and no application or native binding executes.
      const resolved = await builder.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, pluginData: { installedVendor: true } });
      if (resolved.errors.length) return { errors: resolved.errors };
      if (args.kind === "import-statement" && isStarExport(args.importer, args.path)) {
        vendorReexports.push({ importer: args.importer, specifier: args.path, source: resolved.path });
        return { ...resolved, pluginData: undefined };
      }
      externalModules.add(args.path);
      return { path: args.path, external: true };
    });
  } }],
  external: ["*.node", "*.wasm"], loader: { ".sql": "text", ".txt": "text" } });
} catch (error) {
  error.receipt = { type: "NodeRuntimeSourceCompilation", version: 1, status: "refused",
    staticBindingsCompiled: false, applicationExecuted: false, sourceCommit: selection?.commit,
    entries, inspectedPackages, inspectedModules: [...inspectedModules].sort(), vendorReexports,
    externalModules: [...externalModules].sort(), diagnostics: error.errors ?? [{ text: error.message }] };
  throw error;
}
if (selection !== undefined) await verifyWorkspaceSelection(selection);
const observed = new Set(inspectedPackages.map(({ name }) => name));
return { type: "NodeRuntimeSourceCompilation", version: 1, status: "compiled", entries,
  inspectedModules: [...inspectedModules].sort(), vendorReexports, moduleGraph: compilation.metafile.inputs,
  staticBindingsCompiled: true, applicationExecuted: false,
  scope: runtime !== undefined ? "packed-selected-packages" : selection !== undefined ? "selected-source" : "explicit-entries",
  sourceCommit: selection?.commit, inspectedPackages,
  selectedPackagesNotObserved: [...selectedNames].filter(name => !observed.has(name)).sort(),
  externalModules: [...externalModules].sort(), nativeBindingsExecuted: false };

}
