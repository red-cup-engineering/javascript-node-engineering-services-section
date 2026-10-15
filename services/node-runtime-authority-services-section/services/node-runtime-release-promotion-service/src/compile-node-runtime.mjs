#!/usr/bin/env node
import { build } from "esbuild";
import { declaredNodeRuntimeEntries } from "./source-entrances.mjs";
import { parseJavaScript } from "@red-cup-engineering/javascript-node-services-section/javascript-parser";
import { javascriptInstalledResolver } from "@red-cup-engineering/javascript-node-services-section/module-closure";
import {comparePackedManifest,readPackedWorkspacePackages} from "./packed-workspace-packages.mjs";
import { readNodeWorkspace } from "./read-workspace-source.mjs";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { nodeJobProgramEntries } from "@red-cup-engineering/node-job-service";


/** Compile source bindings without executing the application or replacing its installed layout. */
export async function compileNodeRuntime({ entries: requestedEntries = [], workspace, pnpm, filter, runtime: runtimePath, jobDirectories = [], preserveSymlinks = false } = {}) {
  if (!Array.isArray(requestedEntries) || requestedEntries.some(entry => typeof entry !== "string" || !entry)) {
    throw new TypeError("explicit source entries must be nonempty paths");
  }
  if (filter !== undefined && workspace === undefined) throw new TypeError("a native workspace filter requires its source workspace");
  const entries = [...requestedEntries];
  const runtime = runtimePath === undefined ? undefined : resolve(runtimePath);
  if (!Array.isArray(jobDirectories) || jobDirectories.some(path => typeof path !== "string" || !path)) throw new TypeError("job directories must be nonempty paths");
  if (jobDirectories.length && runtime === undefined) throw new TypeError("job programs must be compiled from their packed runtime");
  for (const jobsDirectory of jobDirectories) entries.push(...nodeJobProgramEntries({ runtimeRoot: runtime, jobsDirectory }));
const source = workspace === undefined ? undefined : await readNodeWorkspace({ workspace, pnpm, filter });
if (runtime !== undefined && source === undefined) throw new TypeError("a packed runtime requires its source workspace");
const failures = [];
const workspaceNames = new Set();
const inspectedPackages = [];
const externalModules = new Set();
const inspectedModules = new Set();
const resolveInstalled = javascriptInstalledResolver();
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
if (source !== undefined) {
  const manifests = source.importerIds.map(id => ({ id, manifest: JSON.parse(readFileSync(join(source.workspace, id, "package.json"), "utf8")) }));
  const providers = new Map(manifests.map(item => [item.manifest.name, item]));
  for (const name of providers.keys()) workspaceNames.add(name);
  if (runtime === undefined) for (const { id, manifest } of manifests) carrier(resolve(source.workspace, id), manifest);
  else {
    const packed = readPackedWorkspacePackages(runtime);
    const rootSource = providers.get(packed.packages[0].manifest.name);
    if (!rootSource) throw new TypeError("packed runtime root is outside the source workspace");
    for (const {directory,manifest} of packed.packages) {
      const owner = providers.get(manifest.name);
      if (!owner) continue;
      comparePackedManifest(manifest, owner.manifest);
      carrier(directory, manifest);
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
    // esbuild transports filters to Go's regexp engine; JavaScript's `u` flag
    // is not supported there. The Go dot already matches Unicode path runes.
    builder.onLoad({ filter: /./, namespace: "file" }, args => { inspectedModules.add(args.path); });
    builder.onResolve({ filter: /^(?:@[^/]+\/)?[^./][^:]*$/ }, async (args) => {
      if (args.pluginData?.installedVendor === true) return;
      const packageName = args.path.startsWith("@") ? args.path.split("/").slice(0, 2).join("/") : args.path.split("/")[0];
      if (source === undefined || workspaceNames.has(packageName)) return;
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
    // esbuild may search past an incomplete package scope or apply extension
    // fallbacks that Node's ESM loader does not use. Bind the actual installed
    // supplier before asking the compiler to inspect its exported symbols.
    builder.onResolve({ filter: /./ }, args => {
      if (preserveSymlinks || !args.importer || args.kind === "entry-point") return;
      const mode = ["require-call", "require-resolve"].includes(args.kind) ? "require" : "import";
      try {
        const selected = resolveInstalled(args.path, args.importer, mode);
        if (selected === null || selected?.builtin) return;
        if (!selected?.file || !statSync(selected.file).isFile())
          throw new TypeError(selected?.external ?? "installed import does not select a regular file");
        return { path: realpathSync(selected.file) };
      } catch (error) {
        return { errors: [{ text: `Installed ${mode} binding refused: ${args.path}: ${error.message}` }] };
      }
    });
  } }],
  external: ["*.node", "*.wasm"], loader: { ".sql": "text", ".txt": "text" } });
} catch (error) {
  error.receipt = { type: "NodeRuntimeSourceCompilation", version: 1, status: "refused",
    staticBindingsCompiled: false, applicationExecuted: false, sourceCommit: source?.commit,
    entries, inspectedPackages, inspectedModules: [...inspectedModules].sort(), vendorReexports,
    externalModules: [...externalModules].sort(), diagnostics: error.errors ?? [{ text: error.message }] };
  throw error;
}
if (source !== undefined) await source.reader.verify();
const observed = new Set(inspectedPackages.map(({ name }) => name));
return { type: "NodeRuntimeSourceCompilation", version: 1, status: "compiled", entries,
  inspectedModules: [...inspectedModules].sort(), vendorReexports, moduleGraph: compilation.metafile.inputs,
  staticBindingsCompiled: true, applicationExecuted: false,
  scope: runtime !== undefined ? "packed-workspace-packages" : source !== undefined ? "workspace-source" : "explicit-entries",
  sourceCommit: source?.commit, inspectedPackages,
  workspacePackagesNotObserved: [...workspaceNames].filter(name => !observed.has(name)).sort(),
  externalModules: [...externalModules].sort(), nativeBindingsExecuted: false };

}
