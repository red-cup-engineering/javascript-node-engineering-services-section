/**
 * symbol-graph — one package's API surface as a categorical / systems diagram.
 *
 * The workspace type index (javascript-computer workspaceTypeIndex) reads every package's authored source
 * into attributed types, functions (with their domain and codomain type names),
 * and subtype edges. This projects the slice for one package into a graph in the
 * "objects and morphisms" / Petri-net reading:
 *
 *   - **objects** — the package's exported *types*: classes, interfaces, type
 *     aliases. Each is a node.
 *   - **morphisms** — the package's exported *functions*. Each is a node too (a
 *     transition), so a multi-argument function `f: A × B → C` is honest: arcs
 *     run *into* it from each domain type that is itself a package type, and one
 *     arc runs *out* to the codomain type. (A function over only foreign types —
 *     `string`, `Promise`, `Error` — is a node with no internal arcs.)
 *   - **subtyping** — `class extends`/`interface extends` becomes an `extends`
 *     edge between two type objects.
 *
 * Edges are internal-only, matching graph.mts's drop-external precedent: a
 * function returning `Error`, or extending a foreign base, simply draws no edge.
 * The result is the plain `{ nodes, edges }` a layout/renderer wants — pure over
 * a `WorkspaceTypeIndex`, no filesystem, no rendering.
 */
import type { WorkspaceTypeIndex, SourceLocation } from "@red-cup-engineering/javascript-computer";

export type SymbolNodeKind = "class" | "interface" | "type-alias" | "function";

export interface SymbolNode {
  /** Stable id within this graph (`type:Name` or `fn:name`). */
  readonly id: string;
  readonly name: string;
  readonly kind: SymbolNodeKind;
  /** For functions: a human signature `name(domain…) → codomain`. */
  readonly signature?: string;
  readonly source?: SourceLocation;
}

/** param: a type flows *into* a function (it appears in the domain). returns: a
 *  function flows *out* to a type (its codomain). extends: a subtype relation
 *  between two type objects (`from` extends `to`). */
export type SymbolEdgeKind = "param" | "returns" | "extends";

export interface SymbolEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: SymbolEdgeKind;
}

export interface PackageSymbolGraph {
  readonly pkg: string;
  readonly nodes: readonly SymbolNode[];
  readonly edges: readonly SymbolEdge[];
  /** True when the package contributed any symbol at all. A package with no
   *  authored source yields an empty graph — callers distinguish "no readable declarations" from
   *  "genuinely empty surface" so they can show the right empty state. */
  readonly populated: boolean;
}

const TYPE_KINDS = new Set(["class", "interface", "type-alias"]);
const typeId = (name: string): string => `type:${name}`;
const fnId = (name: string): string => `fn:${name}`;

// Pull the identifier tokens out of a type expression. `readonly Foo[]` →
// ["readonly","Foo"]; `Map<string, Bar>` → ["Map","string","Bar"]. Intersecting
// these with the package's own type names is how a structured type reference is
// resolved back to an internal object without a full type parser.
const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const identsOf = (typeExpr: string): readonly string[] => typeExpr.match(IDENT) ?? [];

/** Project the type index onto one package's internal symbol graph. */
export function packageSymbolGraph(
  index: WorkspaceTypeIndex,
  pkg: string,
): PackageSymbolGraph {
  // Type objects, deduplicated by name (the index attributes a name once per
  // declaring file; a re-export can list it twice). First kind seen wins.
  const typeKind = new Map<string, SymbolNodeKind>();
  for (const t of index.types) {
    if (t.pkg !== pkg || !TYPE_KINDS.has(t.kind)) continue;
    if (!typeKind.has(t.name)) typeKind.set(t.name, t.kind as SymbolNodeKind);
  }

  // Function morphisms, deduplicated by name (a package may declare `add` in
  // several modules; consumption resolves at name-within-package granularity,
  // so they collapse to one node here). First signature seen wins.
  interface FnInfo { readonly domain: readonly string[]; readonly codomain?: string }
  const fnInfo = new Map<string, FnInfo>();
  for (const f of index.functions) {
    if (f.pkg !== pkg || fnInfo.has(f.name)) continue;
    fnInfo.set(f.name, f.codomain === undefined ? { domain: f.domain } : { domain: f.domain, codomain: f.codomain });
  }

  const sourceByName = new Map<string, SourceLocation>();
  for (const value of [...index.types, ...index.functions]) {
    if (value.pkg === pkg && value.source && !sourceByName.has(value.name)) sourceByName.set(value.name, value.source);
  }
  const evidence = (name: string): { source?: SourceLocation } => {
    const source = sourceByName.get(name); return source ? { source } : {};
  };
  const nodes: SymbolNode[] = [];
  for (const [name, kind] of typeKind) nodes.push({ id: typeId(name), name, kind, ...evidence(name) });
  for (const [name, info] of fnInfo) {
    const dom = info.domain.map((d) => d.replace(/\s+/g, " ").trim()).join(", ");
    const sig = `${name}(${dom})${info.codomain ? ` → ${info.codomain.replace(/\s+/g, " ").trim()}` : ""}`;
    nodes.push({ id: fnId(name), name, kind: "function", signature: sig, ...evidence(name) });
  }

  // Edges, deduplicated by (from, to, kind).
  const seen = new Set<string>();
  const edges: SymbolEdge[] = [];
  const add = (from: string, to: string, kind: SymbolEdgeKind): void => {
    if (from === to) return;
    const key = `${from}|${to}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, kind });
  };

  for (const [name, info] of fnInfo) {
    for (const d of info.domain) {
      for (const id of identsOf(d)) if (typeKind.has(id)) add(typeId(id), fnId(name), "param");
    }
    if (info.codomain) {
      for (const id of identsOf(info.codomain)) if (typeKind.has(id)) add(fnId(name), typeId(id), "returns");
    }
  }
  for (const s of index.subtypes) {
    if (s.pkg !== pkg) continue;
    if (typeKind.has(s.sub) && typeKind.has(s.base)) add(typeId(s.sub), typeId(s.base), "extends");
  }

  return { pkg, nodes, edges, populated: nodes.length > 0 };
}
