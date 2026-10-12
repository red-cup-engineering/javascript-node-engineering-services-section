#!/usr/bin/env node
import { build } from "esbuild";

const args = process.argv.slice(2);
const entries = [];
for (let index = 0; index < args.length; index += 2) {
  if (args[index] !== "--entry" || !args[index + 1]) throw new TypeError("usage: compile-node-runtime --entry <module>...");
  entries.push(args[index + 1]);
}
if (!entries.length) throw new TypeError("at least one runtime entrance is required");
// Compile the actual source entrances and their static dependency bindings.
// The bundled output is an in-memory compiler product, never a substitute for
// the installed package layout that owns file URLs and runtime assets.
await build({ entryPoints: entries, bundle: true, write: false, outdir: "compiled-runtime",
  platform: "node", format: "esm", target: "node24", logLevel: "error",
  external: ["*.node", "*.wasm"], loader: { ".sql": "text", ".txt": "text" } });
process.stdout.write(JSON.stringify({ type: "NodeRuntimeSourceCompilation", version: 1, entries,
  staticBindingsCompiled: true, applicationExecuted: false }) + "\n");
