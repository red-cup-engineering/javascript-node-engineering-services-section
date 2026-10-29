/**
 * consumption — the demand half of the workspace dependency graph.
 *
 * javascript-computer workspaceTypeIndex reads what each package *supplies* (its exported functions and
 * types, attributed to the package). This reads what each package *demands*:
 * for every source file in every package, which named bindings it imports from
 * which other workspace package. Joining the two answers the question the
 * one-descent migration needs before it can delete the deprecated engine:
 * "is anything in our ecosystem still using this function or class?"
 *
 * Fail-safe direction. Import-by-name *over*-counts usage (a symbol imported but
 * never called still reads as used) — the safe error for an "is it dead?" tool.
 * But three import forms reach a provider without naming a symbol — a namespace
 * import (`import * as x`), a star re-export (`export * from`), and a dynamic
 * import — and any of them would let a live symbol read as unused. So a provider
 * reached by any coarse form is recorded as *usage-indeterminate*: the sweep
 * refuses to certify any of its exports unused rather than risk a false "dead".
 */
import path from "node:path";
import { discoverJavaScriptSourceFiles, introspectImports, type ImportBinding } from "@red-cup-engineering/javascript-computer";
import { type ConsumptionEdge } from "@red-cup-engineering/jsnode-topology";
import { eachWorkspacePackageDir, type WorkspaceFilter } from "@red-cup-engineering/javascript-computer";
import type { WorkspaceTypeIndex } from "@red-cup-engineering/javascript-computer";

/** One resolved demand edge: `consumer` imports `name` (or coarsely reaches the
 *  package, when `name` is absent) from workspace package `provider`. */
export interface RawConsumption {
  readonly consumer: string;
  readonly provider: string;
  readonly name?: string;
  readonly mode: ImportBinding["mode"];
  readonly typeOnly: boolean;
}

export interface ConsumptionIndex {
  readonly edges: readonly RawConsumption[];
  /** Providers reached by at least one coarse import form (namespace, star
   *  re-export, dynamic). Their exports can never be certified unused. */
  readonly indeterminateProviders: ReadonlySet<string>;
}

interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
}

/** Every readable workspace package as (name, dir), minus any excluded names.
 *  A thin view over the shared strata walk; used by the sweep to find a
 *  provider's source directory. */
export function discoverPackageDirs(
  root: string,
  filter: WorkspaceFilter = {},
): readonly WorkspacePackage[] {
  const out: WorkspacePackage[] = [];
  for (const { name, dir } of eachWorkspacePackageDir(root, filter)) out.push({ name, dir });
  return out;
}

// Resolve a module specifier to the workspace package that provides it: an exact
// name match, or a subpath import (`@scope/x/sub` → `@scope/x`). The longest
// matching package name wins, so a subpath never shadows a more specific name.
function resolveProvider(specifier: string, names: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const name of names) {
    if (specifier === name || specifier.startsWith(name + "/")) {
      if (best === undefined || name.length > best.length) best = name;
    }
  }
  return best;
}

export function workspaceConsumptionIndex(
  root: string,
  filter: WorkspaceFilter = {},
): ConsumptionIndex {
  const packages = discoverPackageDirs(root, filter);
  const names = packages.map((p) => p.name);
  const edges: RawConsumption[] = [];
  const indeterminate = new Set<string>();

  for (const pkg of packages) {
    const files = discoverJavaScriptSourceFiles(pkg.dir, { stopAtPackageBoundary: true });
    for (const { bindings } of introspectImports(files)) {
      for (const b of bindings) {
        if (b.specifier === undefined) continue; // dynamic import of a non-literal
        const provider = resolveProvider(b.specifier, names);
        if (provider === undefined || provider === pkg.name) continue; // extern, or self
        if (b.mode === "named" || b.mode === "default") {
          edges.push({
            consumer: pkg.name,
            provider,
            ...(b.name !== undefined ? { name: b.name } : {}),
            mode: b.mode,
            typeOnly: b.typeOnly,
          });
        } else {
          // namespace | star-reexport | dynamic — reaches the package, names no
          // symbol. Records a coarse edge and poisons the provider's certainty.
          edges.push({ consumer: pkg.name, provider, mode: b.mode, typeOnly: b.typeOnly });
          indeterminate.add(provider);
        }
      }
    }
  }
  return { edges, indeterminateProviders: indeterminate };
}

// ---------- analytics ----------

export interface SymbolConsumer {
  readonly consumer: string;
  readonly typeOnly: boolean;
  readonly mode: ImportBinding["mode"];
}

/** Who names `provider:name`? Named/default edges only — the precise consumers.
 *  Coarse reaches are reported separately via `indeterminateProviders`. */
export function consumersOfSymbol(
  index: ConsumptionIndex,
  provider: string,
  name: string,
): readonly SymbolConsumer[] {
  const seen = new Set<string>();
  const out: SymbolConsumer[] = [];
  for (const e of index.edges) {
    if (e.provider !== provider || e.name !== name) continue;
    if (seen.has(e.consumer)) continue;
    seen.add(e.consumer);
    out.push({ consumer: e.consumer, typeOnly: e.typeOnly, mode: e.mode });
  }
  return out;
}

/** Consumers that reach `provider` by a coarse form (namespace/star/dynamic).
 *  These are why a provider may be usage-indeterminate. */
export function coarseConsumersOfPackage(
  index: ConsumptionIndex,
  provider: string,
): readonly SymbolConsumer[] {
  const seen = new Set<string>();
  const out: SymbolConsumer[] = [];
  for (const e of index.edges) {
    if (e.provider !== provider || e.name !== undefined) continue;
    if (seen.has(e.consumer)) continue;
    seen.add(e.consumer);
    out.push({ consumer: e.consumer, typeOnly: e.typeOnly, mode: e.mode });
  }
  return out;
}

export interface ExportedSymbol {
  readonly name: string;
  readonly kind: "function" | "class";
}

/** A provider's public functions and classes, read off the workspace type index
 *  (which projects each package's authored source). Interfaces and type aliases are
 *  excluded — the sweep is about functions and classes per the goal.
 *
 *  Deduplicated by `(name, kind)`: a package may declare the same name in
 *  several internal modules (`add`, `isZero`, …), and the index attributes each
 *  to the package. Consumption resolves at name-within-package granularity, so
 *  those collapse to one symbol here — an honest count and no repeated lines. */
export function exportedFunctionsAndClasses(
  typeIndex: WorkspaceTypeIndex,
  provider: string,
): readonly ExportedSymbol[] {
  const seen = new Set<string>();
  const out: ExportedSymbol[] = [];
  const take = (name: string, kind: ExportedSymbol["kind"]): void => {
    const key = `${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, kind });
  };
  for (const f of typeIndex.functions) {
    if (f.pkg === provider) for (const name of f.imports?.map((entry) => entry.name) ?? [f.name]) take(name, "function");
  }
  for (const t of typeIndex.types) {
    if (t.pkg === provider && t.kind === "class") for (const name of t.imports?.map((entry) => entry.name) ?? [t.name]) take(name, "class");
  }
  return out;
}

export interface UnusedReport {
  readonly provider: string;
  /** True when the provider has an observed source surface to analyse. An unreadable
   *  package yields no exports — `observed: false` distinguishes that from a
   *  genuinely empty API, so the sweep can warn instead of reporting nothing. */
  readonly observed: boolean;
  /** True when a coarse import reaches the provider: no export can be certified
   *  unused, so `unused` is empty regardless of named consumers. */
  readonly indeterminate: boolean;
  readonly unused: readonly ExportedSymbol[];
  readonly used: readonly ExportedSymbol[];
}

/** Partition a provider's exported functions/classes into used and unused,
 *  honouring the fail-safe rule: a usage-indeterminate provider reports nothing
 *  as unused. */
export function classifyUnusedExports(
  index: ConsumptionIndex,
  provider: string,
  exports: readonly ExportedSymbol[],
  observed: boolean,
): UnusedReport {
  const indeterminate = index.indeterminateProviders.has(provider);
  if (indeterminate) {
    return { provider, observed, indeterminate: true, unused: [], used: [...exports] };
  }
  const used: ExportedSymbol[] = [];
  const unused: ExportedSymbol[] = [];
  for (const sym of exports) {
    if (consumersOfSymbol(index, provider, sym.name).length > 0) used.push(sym);
    else unused.push(sym);
  }
  return { provider, observed, indeterminate: false, unused, used };
}

/** Resolve raw demand edges into meme-floor consumption edges, classifying each
 *  named symbol as a provider function or type via the type index. This is the
 *  graph-enrichment surface: fed to `consumptionUtterances`, the edges settle
 *  against the same terms the export side mints. */
export function resolveConsumptionEdges(
  index: ConsumptionIndex,
  typeIndex: WorkspaceTypeIndex,
): readonly ConsumptionEdge[] {
  const fnsByPkg = new Map<string, Set<string>>();
  const typesByPkg = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, pkg: string, name: string): void => {
    let s = m.get(pkg);
    if (!s) m.set(pkg, (s = new Set()));
    s.add(name);
  };
  for (const f of typeIndex.functions) for (const name of f.imports?.map((entry) => entry.name) ?? [f.name]) add(fnsByPkg, f.pkg, name);
  for (const t of typeIndex.types) for (const name of t.imports?.map((entry) => entry.name) ?? [t.name]) add(typesByPkg, t.pkg, name);

  const out: ConsumptionEdge[] = [];
  for (const e of index.edges) {
    if (e.name === undefined) {
      out.push({ consumer: e.consumer, provider: e.provider, kind: "package" });
    } else if (fnsByPkg.get(e.provider)?.has(e.name)) {
      out.push({ consumer: e.consumer, provider: e.provider, kind: "function", name: e.name });
    } else if (typesByPkg.get(e.provider)?.has(e.name)) {
      out.push({ consumer: e.consumer, provider: e.provider, kind: "type", name: e.name });
    } else {
      // Imported a name the provider's observed source surface doesn't expose (an inaccessible module export, or a value that isn't a function/type) — keep it as a package
      // reach so the edge still records the dependency.
      out.push({ consumer: e.consumer, provider: e.provider, kind: "package" });
    }
  }
  return out;
}
