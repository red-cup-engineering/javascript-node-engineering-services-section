#!/usr/bin/env node
import { build } from "esbuild";
import { existsSync, globSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const entries = [];
let selection, runtime, preserveSymlinks = false;
for (let index = 0; index < args.length; index += 2) {
  if (args[index] === "--preserve-symlinks") { preserveSymlinks = true; index--; continue; }
  if (!["--entry", "--selection", "--runtime"].includes(args[index]) || !args[index + 1]) throw new TypeError("usage: compile-node-runtime [--entry <module>...] [--selection <installed receipt> --runtime <packed runtime>] [--preserve-symlinks]");
  if (args[index] === "--entry") entries.push(args[index + 1]);
  else if (args[index] === "--selection") selection = JSON.parse(readFileSync(args[index + 1], "utf8"));
  else runtime = resolve(args[index + 1]);
}
const failures = [];
function targets(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(targets);
  if (value === null || typeof value !== "object") return [];
  const keys = Object.keys(value);
  if (keys.some(key => key.startsWith("."))) return keys.flatMap(key => targets(value[key]));
  // Node's ESM conditions use the first matching branch in declaration order.
  const key = keys.find(key => ["node", "import", "default"].includes(key));
  return key === undefined ? [] : targets(value[key]);
}
function carrier(root, manifest) {
  const paths = [...targets(manifest.exports), ...(typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {}))];
  if (!manifest.exports && manifest.main) paths.push(manifest.main);
  for (const path of new Set(paths)) {
    const absolute = resolve(root, path), offset = relative(root, absolute);
    if (isAbsolute(offset) || offset === ".." || offset.startsWith("../")) throw new TypeError("package carrier escapes its owner: " + manifest.name);
    const files = path.includes("*") ? globSync(path, { cwd: root }).map(file => resolve(root, file)) : [absolute];
    if (!files.length) failures.push(manifest.name + ": unmatched export " + path);
    for (const file of files) {
      if (!existsSync(file)) failures.push(manifest.name + ": absent carrier " + path);
      else if (/\.(?:[cm]?js|tsx?)$/u.test(file) && !/\.d\.[cm]?ts$/u.test(file)) entries.push(file);
    }
  }
}
if (selection !== undefined) {
  if (selection.type !== "NodeRuntimeWorkspaceSelectionInstallReceipt" || selection.status !== "installed" || selection.sourceConfigurationUnchanged !== true) throw new TypeError("an installed unchanged selection is required");
  const manifests = selection.importerIds.map(id => ({ id, manifest: JSON.parse(readFileSync(join(selection.workspace, id, "package.json"), "utf8")) }));
  const selected = new Map(manifests.map(item => [item.manifest.name, item]));
  if (runtime === undefined) for (const { id, manifest } of manifests) carrier(resolve(selection.workspace, id), manifest);
  else {
    // Inspect only the portable pnpm closure and its two package-directory levels.
    const seen = new Set();
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
          if (manifest.version !== source.manifest.version) throw new TypeError("packed package differs from selected version: " + manifest.name);
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
await build({ entryPoints: [...new Set(entries)], bundle: true, write: false, outdir: "compiled-runtime", preserveSymlinks,
  platform: "node", format: "esm", target: "node24", logLevel: "error",
  plugins: [{ name: "installed-third-party-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(?:@[^/]+\/)?[^./][^:]*$/ }, (args) => {
      if (args.path.startsWith("@red-cup-engineering/") || args.path.startsWith("@lenticule-science/")) return;
      // These packages run in their installed Node layout. Inlining a vendor's
      // generated bundle changes optional and native binding semantics.
      createRequire(args.importer).resolve(args.path);
      return { path: args.path, external: true };
    });
  } }],
  external: ["*.node", "*.wasm"], loader: { ".sql": "text", ".txt": "text" } });
process.stdout.write(JSON.stringify({ type: "NodeRuntimeSourceCompilation", version: 1, entries,
  staticBindingsCompiled: true, applicationExecuted: false }) + "\n");
