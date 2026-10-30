/**
 * workspace — filesystem reading into node-topology carriers.
 *
 * `javascript-computer.eachWorkspacePackageDir` supplies the manifest walk everything else is
 * built on: every directory with a readable package.json, minus exclusions
 * honoured everywhere at once. `discoverWorkspace` collects them all; layer
 * comes from directory position, not manifest content.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { eachWorkspacePackageDir, type WorkspaceFilter, type DiscoveredPackage } from "@red-cup-engineering/javascript-computer";
import {
  JSNODE_LAYERS,
  jsNodePackage,
  jsNodeWorkspace,
  type JSNodeLayer,
  type JSNodePackage,
  type JSNodeWorkspace,
  type TypeCatalog,
  type PackageDependency,
  type DependencyKind,
} from "@red-cup-engineering/jsnode-topology";
import { introspectDeclarations, discoverJavaScriptPackageSources } from "@red-cup-engineering/javascript-computer";

export type { JSNodePackage, JSNodeWorkspace };

/** Whether to project authored source declarations into the package's type category.
 * Off by default so manifest-only discovery does not read source files. */
export interface ReadOptions {
  readonly introspect?: boolean;
}

// The same authored-source selection feeds single-package and workspace reads.
function readPackageApi(dir: string, manifest: Record<string, unknown>): TypeCatalog | undefined {
  const catalog = introspectDeclarations(discoverJavaScriptPackageSources(dir, manifest).files);
  return catalog.types.length || catalog.functions.length ? catalog : undefined;
}

function classifyLayer(dir: string): JSNodeLayer {
  const parts = dir.split(path.sep);
  for (const layer of JSNODE_LAYERS) {
    if (parts.includes(layer)) return layer;
  }
  return "lib";
}

function extractExports(manifest: Record<string, unknown>): string[] {
  const raw = manifest["exports"];
  if (raw === null || typeof raw !== "object") return [];
  return Object.keys(raw as Record<string, unknown>).filter(
    (k) => k !== "./package.json",
  );
}

function extractDependencies(manifest: Record<string, unknown>): string[] {
  const deps = manifest["dependencies"];
  if (deps === null || typeof deps !== "object") return [];
  return Object.keys(deps as Record<string, unknown>);
}

// A package's `keywords` are its tags on the meme floor: the `deprecated`
// keyword is what the deprecated-sweep reads to find packages slated for
// retirement. Without this, `tags` was always empty and `searchPackages`'
// tag-rank and the sweep had nothing to match.
function extractTags(manifest: Record<string, unknown>): string[] {
  const kw = manifest["keywords"];
  if (!Array.isArray(kw)) return [];
  return kw.filter((k): k is string => typeof k === "string");
}

// ---------- the plain manifest facts (the normie metadata) ----------

const DEP_FIELDS: ReadonlyArray<readonly [string, DependencyKind]> = [
  ["dependencies", "runtime"],
  ["devDependencies", "dev"],
  ["peerDependencies", "peer"],
  ["optionalDependencies", "optional"],
];

// Every declared dependency across all four kinds, each with its version range —
// the superset of the runtime name-list. The drift and consistency tools read
// this; the dependency graph still reads only the runtime names.
function extractDeps(manifest: Record<string, unknown>): PackageDependency[] {
  const out: PackageDependency[] = [];
  for (const [field, kind] of DEP_FIELDS) {
    const raw = manifest[field];
    if (raw === null || typeof raw !== "object") continue;
    for (const [name, range] of Object.entries(raw as Record<string, unknown>)) {
      out.push({ name, range: typeof range === "string" ? range : "*", kind });
    }
  }
  return out;
}

function extractEngines(manifest: Record<string, unknown>): Record<string, string> {
  const raw = manifest["engines"];
  if (raw === null || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function extractScriptNames(manifest: Record<string, unknown>): string[] {
  const raw = manifest["scripts"];
  if (raw === null || typeof raw !== "object") return [];
  return Object.keys(raw as Record<string, unknown>);
}

// A repository can be a string or { type, url }; normalize to a URL-ish string.
function extractRepository(manifest: Record<string, unknown>): string | null {
  const raw = manifest["repository"];
  if (typeof raw === "string") return raw;
  if (raw !== null && typeof raw === "object") {
    const url = (raw as Record<string, unknown>)["url"];
    if (typeof url === "string") return url;
  }
  return null;
}

function extractModuleType(manifest: Record<string, unknown>): "module" | "commonjs" | null {
  const t = manifest["type"];
  return t === "module" || t === "commonjs" ? t : null;
}

// Build a carrier from an already-parsed manifest (the strata walk hands these
// over), so discovery never re-reads a file it has already read.
function manifestToPackage(
  dir: string,
  manifest: Record<string, unknown>,
  opts: ReadOptions,
): JSNodePackage {
  const name = typeof manifest["name"] === "string" ? manifest["name"] : path.basename(dir);
  const version = typeof manifest["version"] === "string" ? manifest["version"] : "0.0.0";
  const description = typeof manifest["description"] === "string" ? manifest["description"] : "";
  const api = opts.introspect ? readPackageApi(dir, manifest) : undefined;
  const license = typeof manifest["license"] === "string" ? manifest["license"] : null;
  return jsNodePackage({
    name,
    version,
    description,
    layer: classifyLayer(dir),
    tags: extractTags(manifest),
    exports: extractExports(manifest),
    dependencies: extractDependencies(manifest),
    deps: extractDeps(manifest),
    license,
    private: manifest["private"] === true,
    moduleType: extractModuleType(manifest),
    engines: extractEngines(manifest),
    scripts: extractScriptNames(manifest),
    repository: extractRepository(manifest),
    homepage: typeof manifest["homepage"] === "string" ? manifest["homepage"] : null,
    ...(api !== undefined ? { api } : {}),
  });
}

export async function readJSNodePackage(
  dir: string,
  opts: ReadOptions = {},
): Promise<JSNodePackage | undefined> {
  const manifestPath = path.join(dir, "package.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return undefined;
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  return manifestToPackage(dir, manifest, opts);
}

export async function discoverWorkspace(
  root: string,
  opts: ReadOptions & WorkspaceFilter = {},
): Promise<JSNodeWorkspace> {
  return workspaceFromDiscoveredPackages(root, eachWorkspacePackageDir(root, opts), opts);
}

/** Projects one already-read workspace package snapshot without filesystem reads. */
export function workspaceFromDiscoveredPackages(root: string, discoveredPackages: Iterable<DiscoveredPackage>, opts: ReadOptions = {}): JSNodeWorkspace {
  return jsNodeWorkspace(root, [...discoveredPackages].map(({ dir, manifest }) => manifestToPackage(dir, manifest, opts)));
}
