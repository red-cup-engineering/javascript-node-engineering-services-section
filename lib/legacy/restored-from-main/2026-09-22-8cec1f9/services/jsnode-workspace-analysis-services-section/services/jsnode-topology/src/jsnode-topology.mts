/**
 * node-topology — Node.js packages as a meme-topology carrier.
 *
 * A Node.js package occupies a position in a layered workspace (lib, apps,
 * services, sites, ops). Its coordinates are: the layer it inhabits, the
 * subpath exports it publishes, and the packages it depends on. Each
 * coordinate is a relational utterance on the meme floor: settling them
 * gives the workspace dependency graph as a topology carrier.
 *
 * This library models knowledge ABOUT Node packages. A JSNodePackage's
 * coordinates admit onto the meme floor as utterances; settlement is
 * `induceJSNodeTopology` and readings come back as sections and charges.
 * The filesystem reading lives in apps/jsnode-computer; this library is pure.
 */
import type { UtteranceCarrier } from "@red-cup-engineering/sign-cell/utterance";
import { isMark, mark, utterance } from "@red-cup-engineering/sign-cell/utterance";
import { witnessedPotential } from "@lenticule-science/metrologic/articulation/predicating/positing";
import {
  fixedPointReadingsOfUtterances,
  settleUtterances,
  settlementClosureProfile,
  type MemeTopologyFixedPointReadings,
  type SettlementFiltration,
  type UtteranceSettlementAdmission,
} from "@lenticule-science/metrologic/articulation/predicating/positing/settling";
import { typeCatalog, type JsType, type JsFn, type TypeCatalog } from "@red-cup-engineering/javascript-algebra";
import { predicate } from "./predicate.mjs";

export type { UtteranceCarrier };
export interface MemeTopologyCarrier {
  readonly kind: "meme-topology.carrier";
  readonly witnesses: readonly UtteranceCarrier[];
  readonly fixedPointReadings: MemeTopologyFixedPointReadings;
  readonly settling: SettlementFiltration;
}
// The type category is defined once, in @emsenn/javascript-algebra. jsnode
// consumes it and projects names onto the meme floor; it does not redefine it.
export type { JsType, JsFn, TypeCatalog };

// ---------- layer vocabulary ----------

export type JSNodeLayer = "lib" | "apps" | "services" | "sites" | "ops";

export const JSNODE_LAYERS: readonly JSNodeLayer[] =
  Object.freeze(["lib", "apps", "services", "sites", "ops"] as const);

// ---------- term constructors ----------

export function packageTerm(name: string): string {
  return `jsnode.package.${name}`;
}

export function layerTerm(layer: JSNodeLayer): string {
  return `jsnode.layer.${layer}`;
}

export function exportTerm(pkg: string, subpath: string): string {
  return `jsnode.export.${pkg}:${subpath}`;
}

export function tagTerm(tag: string): string {
  return `jsnode.tag.${tag}`;
}

/** A type's canonical identity is its defining package and name. A type used
 *  as a function's domain/codomain but defined outside the workspace (a Node
 *  builtin, an external dependency, a structural type) has no defining package;
 *  it is addressed under the reserved `extern` package so the morphism cells
 *  still settle against a stable term. */
export function typeTerm(pkg: string, name: string): string {
  return `jsnode.type.${pkg}:${name}`;
}

export function externTypeTerm(name: string): string {
  return typeTerm("extern", name);
}

export function functionTerm(pkg: string, name: string): string {
  return `jsnode.function.${pkg}:${name}`;
}

// ---------- predicate constructors ----------

export const inLayerPredicate = predicate("in-layer");
export const hasExportPredicate = predicate("has-export");
export const dependsOnPredicate = predicate("depends-on");
export const hasTagPredicate = predicate("has-tag");
export const hasTypePredicate = predicate("has-type");
export const hasFunctionPredicate = predicate("has-function");
/** A function morphism's domain: `function --has-domain--> type`. A function of
 *  several parameters utters one domain cell per parameter type. */
export const hasDomainPredicate = predicate("has-domain");
/** A function morphism's codomain: `function --has-codomain--> type`. */
export const hasCodomainPredicate = predicate("has-codomain");
/** A specialization morphism in the type lattice: `subtype --specializes--> supertype`. */
export const specializesPredicate = predicate("specializes");

// ---------- type-flow (composition) predicates ----------
//
// The one-hop composition consequences of `has-domain`/`has-codomain`, read
// across packages. Where `has-domain`/`has-codomain` relate a *function* to its
// argument and result *types*, these relate two *types* directly: type A
// transforms-to type B when some function carries A in its domain and B as its
// codomain — the edge of the workspace's type-flow category. Composition only
// type-checks when codomain meets domain (identity-mismatch-is-the-type-error),
// so these edges are exactly the valid one-step compositions. Factual: a direct
// consequence of declared signatures, no contrary.

/** A composition edge between two types: `A --transforms-to--> B` when some
 *  function takes A (in its domain) and produces B (its codomain). */
export const transformsToPredicate = predicate("transforms-to");
/** A type names a function that produces it: `type --produced-by--> function`
 *  (the function's codomain is this type). The arrows-in half of the type's
 *  hom-functor presentation. */
export const producedByPredicate = predicate("produced-by");
/** A type names a function that consumes it: `type --consumed-by--> function`
 *  (the type appears in the function's domain). The arrows-out half. */
export const consumedByPredicate = predicate("consumed-by");

// ---------- consumption (demand) predicates ----------
//
// The dual of `has-function`/`has-type`. Where a provider package *has* a
// function, a consumer package *uses* it. Crucially, a consumption edge settles
// against the very same `functionTerm`/`typeTerm` the provider's export side
// mints — so on the meme floor supply and demand meet at one term, and "does
// anything use `jsnode.function.X:foo`?" is read directly off its in-edges.

/** A consumer names a specific provider function: `consumer --uses-function--> function`. */
export const usesFunctionPredicate = predicate("uses-function");
/** A consumer names a specific provider type/class: `consumer --uses-type--> type`. */
export const usesTypePredicate = predicate("uses-type");
/** A consumer reaches a provider package without naming a symbol (namespace
 *  import, star re-export, dynamic import): `consumer --uses-package--> package`.
 *  This is the coarse mode: it proves the package is reached but leaves which of
 *  its symbols are used *indeterminate*, so it can never witness non-use. */
export const usesPackagePredicate = predicate("uses-package");

// ---------- type-category projection ----------

/** Project a `JsType`/`JsFn` type *name* onto its meme-floor term. A name
 *  declared in this package's own catalog mints a package-scoped `typeTerm`; a
 *  name used but not declared here (a Node builtin, an external dependency, a
 *  primitive or structural type) is addressed under the reserved `extern`
 *  package so its morphism cells still settle against a stable term. This is
 *  the one place names cross onto the floor; the codec reuses it so there is a
 *  single name→term resolution in the workspace. */
export function resolveTypeTerm(pkgName: string, catalog: TypeCatalog, typeName: string): string {
  return catalog.types.some((t) => t.name === typeName)
    ? typeTerm(pkgName, typeName)
    : externTypeTerm(typeName);
}

// ---------- JSNodePackage carrier ----------

/** A package's lifecycle — the team's *intent*, read from its keywords. This is
 *  about disposition, not release maturity (that is {@link PackageMaturity}):
 *   - `active`      — the default: a live part of the ecosystem.
 *   - `maintenance` — kept working but not developed (keyword `maintenance` or
 *                     `legacy`): bug-fixes only, no new surface expected.
 *   - `deprecated`  — on the way out ("we're trying to get rid of this"). Held
 *                     out of the default/active picture and surfaced as its own
 *                     set; anything still depending on it is migration debt.
 *   - `abandoned`   — intentionally frozen ("should stay stable regardless of
 *                     what else changes"). Not junk — a stable contract, exempt
 *                     from the consistency/drift pressure applied to active
 *                     packages.
 *  Precedence when several keywords are present: deprecated > abandoned >
 *  maintenance — a package being removed is no longer a contract to depend on. */
export type PackageLifecycle = "active" | "maintenance" | "deprecated" | "abandoned";

/** The lifecycle keywords recognized, by the status they imply. */
const LIFECYCLE_KEYWORDS: ReadonlyArray<readonly [PackageLifecycle, readonly string[]]> = [
  ["deprecated", ["deprecated"]],
  ["abandoned", ["abandoned"]],
  ["maintenance", ["maintenance", "legacy"]],
];

/** Derive a package's lifecycle from its keywords (case-insensitive). Pure. */
export function packageLifecycle(tags: readonly string[]): PackageLifecycle {
  const set = new Set(tags.map((t) => t.toLowerCase()));
  for (const [status, keywords] of LIFECYCLE_KEYWORDS) {
    if (keywords.some((k) => set.has(k))) return status;
  }
  return "active";
}

/** A package's maturity — its *release stage*, inferred from the SemVer version
 *  (a keyword override wins, for the rare package that disagrees with its number):
 *   - `experimental` — `0.0.0`: nothing released, a placeholder/prototype.
 *   - `alpha`        — `0.0.x` (x>0): early development, surface churns freely.
 *   - `beta`         — `0.x.y` (x>0): pre-1.0, API may still break (SemVer §4).
 *   - `stable`       — `>=1.0.0`: a released, SemVer-governed surface.
 *  A prerelease tag (`-alpha`/`-beta`/`-rc`) or an explicit keyword
 *  (`experimental`/`alpha`/`beta`/`stable`) overrides the numeric inference. */
export type PackageMaturity = "experimental" | "alpha" | "beta" | "stable";

const MATURITY_KEYWORDS: readonly PackageMaturity[] = ["experimental", "alpha", "beta", "stable"];

/** Derive a package's maturity from its version (and any overriding keyword). Pure. */
export function packageMaturity(version: string, tags: readonly string[] = []): PackageMaturity {
  const set = new Set(tags.map((t) => t.toLowerCase()));
  for (const m of MATURITY_KEYWORDS) if (set.has(m)) return m;
  const [core, pre] = version.split("-", 2);
  if (pre !== undefined) {
    if (/^alpha/i.test(pre)) return "alpha";
    if (/^(beta|rc)/i.test(pre)) return "beta";
  }
  const [maj = 0, min = 0, pat = 0] = (core ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  if (maj >= 1) return "stable";
  if (min > 0) return "beta";
  if (pat > 0) return "alpha";
  return "experimental";
}

/** RDF term for a lifecycle status (`jsnode.lifecycle.<status>`). */
export function lifecycleTerm(lifecycle: PackageLifecycle): string {
  return `jsnode.lifecycle.${lifecycle}`;
}

/** RDF term for a maturity stage (`jsnode.maturity.<stage>`). */
export function maturityTerm(maturity: PackageMaturity): string {
  return `jsnode.maturity.${maturity}`;
}

/** Which package.json field a dependency was declared in. The graph reads only
 *  `runtime`; the normie tools (drift, consistency) read every kind. */
export type DependencyKind = "runtime" | "dev" | "peer" | "optional";

/** One dependency exactly as declared: its name, the SemVer range string, and
 *  which dependency field it came from. The version range is the fact the bare
 *  `dependencies` name-list throws away — and the fact drift analysis needs. */
export interface PackageDependency {
  readonly name: string;
  readonly range: string;
  readonly kind: DependencyKind;
}

/** The plain manifest facts every Node package carries beyond its workspace
 *  coordinates — the metadata a reader looks at first, which the carrier used to
 *  discard. All optional on input and defaulted, so the convention machinery and
 *  minimal test carriers are unaffected. */
export interface PackageManifestFacts {
  /** SPDX license id, or null when the manifest declares none. */
  readonly license: string | null;
  /** The `private` flag (publishability). */
  readonly private: boolean;
  /** The `type` field: ES modules vs CommonJS, or null when unstated. */
  readonly moduleType: "module" | "commonjs" | null;
  /** The `engines` map (notably `node`), empty when unstated. */
  readonly engines: Readonly<Record<string, string>>;
  /** The names of the `scripts` a package defines, sorted. */
  readonly scripts: readonly string[];
  /** A repository URL (normalized to a string), or null. */
  readonly repository: string | null;
  /** A homepage URL, or null. */
  readonly homepage: string | null;
}

export interface JSNodePackage {
  readonly kind: "jsnode.package";
  readonly term: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly layer: JSNodeLayer;
  /** The package's `keywords` (the meme-floor tags). `keywords` is the plain
   *  alias readers expect; the two are the same list. */
  readonly tags: readonly string[];
  /** The lifecycle status read from the keywords — the team's intent. */
  readonly lifecycle: PackageLifecycle;
  /** The release maturity inferred from the version (keyword-overridable). */
  readonly maturity: PackageMaturity;
  readonly exports: readonly string[];
  /** Runtime dependency *names* — the internal dependency graph reads this. */
  readonly dependencies: readonly string[];
  /** Every declared dependency across all kinds, with its version range — the
   *  superset of `dependencies` the drift/consistency tools read. */
  readonly deps: readonly PackageDependency[];
  /** The plain manifest facts (license, engines, scripts, …). */
  readonly manifest: PackageManifestFacts;
  readonly api?: TypeCatalog;
  readonly serve?: Readonly<Record<string, unknown>>;
  readonly utterances: readonly UtteranceCarrier[];
}

export interface JSNodePackageInput {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly layer: JSNodeLayer;
  readonly exports: readonly string[];
  readonly dependencies: readonly string[];
  readonly tags?: readonly string[];
  /** Every declared dependency with its range and kind. When omitted, `deps` is
   *  synthesized from `dependencies` as runtime deps with an unknown ("*")
   *  range, so older callers still get a coherent (if range-less) list. */
  readonly deps?: readonly PackageDependency[];
  readonly license?: string | null;
  readonly private?: boolean;
  readonly moduleType?: "module" | "commonjs" | null;
  readonly engines?: Readonly<Record<string, string>>;
  readonly scripts?: readonly string[];
  readonly repository?: string | null;
  readonly homepage?: string | null;
  readonly api?: TypeCatalog;
  readonly serve?: Readonly<Record<string, unknown>>;
}

function apiUtterances(pkgName: string, pkgTerm: string, api: TypeCatalog): UtteranceCarrier[] {
  const out: UtteranceCarrier[] = [];
  for (const type of api.types) {
    out.push(utterance(
      mark({ subject: pkgTerm, object: typeTerm(pkgName, type.name) }),
      mark(hasTypePredicate()),
    ));
  }
  for (const fn of api.functions) {
    const fnTerm = functionTerm(pkgName, fn.name);
    out.push(utterance(
      mark({ subject: pkgTerm, object: fnTerm }),
      mark(hasFunctionPredicate()),
    ));
    // domain/codomain are type *names*; resolve each onto the floor here.
    for (const domain of fn.domain) {
      out.push(utterance(
        mark({ subject: fnTerm, object: resolveTypeTerm(pkgName, api, domain) }),
        mark(hasDomainPredicate()),
      ));
    }
    if (fn.codomain !== undefined) {
      out.push(utterance(
        mark({ subject: fnTerm, object: resolveTypeTerm(pkgName, api, fn.codomain) }),
        mark(hasCodomainPredicate()),
      ));
    }
  }
  // the type lattice: each declared subtype edge is a specialization morphism.
  for (const [sub, sup] of api.subtypes) {
    out.push(utterance(
      mark({
        subject: resolveTypeTerm(pkgName, api, sub),
        object: resolveTypeTerm(pkgName, api, sup),
      }),
      mark(specializesPredicate()),
    ));
  }
  return out;
}

export function jsNodePackage(input: JSNodePackageInput): JSNodePackage {
  const term = packageTerm(input.name);
  const tags = input.tags ?? [];
  const utterances: UtteranceCarrier[] = [
    utterance(
      mark({ subject: term, object: layerTerm(input.layer) }),
      mark(inLayerPredicate()),
    ),
    ...tags.map((tag) =>
      utterance(
        mark({ subject: term, object: tagTerm(tag) }),
        mark(hasTagPredicate()),
      )
    ),
    ...input.exports.map((sub) =>
      utterance(
        mark({ subject: term, object: exportTerm(input.name, sub) }),
        mark(hasExportPredicate()),
      )
    ),
    ...input.dependencies.map((dep) =>
      utterance(
        mark({ subject: term, object: packageTerm(dep) }),
        mark(dependsOnPredicate()),
      )
    ),
    ...(input.api !== undefined ? apiUtterances(input.name, term, input.api) : []),
  ];
  const deps: readonly PackageDependency[] = input.deps
    ? input.deps.map((d) => Object.freeze({ name: d.name, range: d.range, kind: d.kind }))
    : input.dependencies.map((name) => Object.freeze({ name, range: "*", kind: "runtime" as const }));
  const manifest: PackageManifestFacts = Object.freeze({
    license: input.license ?? null,
    private: input.private ?? false,
    moduleType: input.moduleType ?? null,
    engines: Object.freeze({ ...(input.engines ?? {}) }),
    scripts: Object.freeze([...(input.scripts ?? [])].sort()),
    repository: input.repository ?? null,
    homepage: input.homepage ?? null,
  });
  return Object.freeze({
    kind: "jsnode.package" as const,
    term,
    name: input.name,
    version: input.version,
    description: input.description,
    layer: input.layer,
    tags: Object.freeze([...tags]),
    lifecycle: packageLifecycle(tags),
    maturity: packageMaturity(input.version, tags),
    exports: Object.freeze([...input.exports]),
    dependencies: Object.freeze([...input.dependencies]),
    deps: Object.freeze(deps),
    manifest,
    ...(input.api !== undefined ? { api: typeCatalog(input.api) } : {}),
    ...(input.serve !== undefined ? { serve: Object.freeze({ ...input.serve }) } : {}),
    utterances: Object.freeze(utterances),
  });
}

// ---------- JSNodeWorkspace carrier ----------

export interface JSNodeWorkspace {
  readonly kind: "jsnode.workspace";
  readonly root: string;
  readonly packages: readonly JSNodePackage[];
  readonly utterances: readonly UtteranceCarrier[];
}

export function jsNodeWorkspace(
  root: string,
  packages: readonly JSNodePackage[],
): JSNodeWorkspace {
  const utterances: UtteranceCarrier[] = packages.flatMap((p) => [...p.utterances]);
  return Object.freeze({
    kind: "jsnode.workspace" as const,
    root,
    packages: Object.freeze([...packages]),
    utterances: Object.freeze(utterances),
  });
}

// ---------- consumption edges ----------

/** A resolved consumption: `consumer` uses something the workspace provides.
 *  `kind` selects the term the edge settles against — a named provider function
 *  (`function`) or type/class (`type`), or the provider package itself
 *  (`package`) for a coarse reach that names no symbol. */
export interface ConsumptionEdge {
  readonly consumer: string;
  readonly provider: string;
  readonly kind: "function" | "type" | "package";
  /** The provider symbol name; required for `function`/`type`, unused for `package`. */
  readonly name?: string;
}

/** Mint the meme-floor utterance for one consumption edge. The object term is
 *  the same `functionTerm`/`typeTerm`/`packageTerm` the provider already utters,
 *  so demand and supply settle onto a shared term — this is the one place the
 *  consumer side resolves a name onto the floor. */
export function consumptionUtterance(edge: ConsumptionEdge): UtteranceCarrier {
  const subject = packageTerm(edge.consumer);
  if (edge.kind === "function") {
    return utterance(
      mark({ subject, object: functionTerm(edge.provider, edge.name ?? "") }),
      mark(usesFunctionPredicate()),
    );
  }
  if (edge.kind === "type") {
    return utterance(
      mark({ subject, object: typeTerm(edge.provider, edge.name ?? "") }),
      mark(usesTypePredicate()),
    );
  }
  return utterance(
    mark({ subject, object: packageTerm(edge.provider) }),
    mark(usesPackagePredicate()),
  );
}

export function consumptionUtterances(
  edges: readonly ConsumptionEdge[],
): readonly UtteranceCarrier[] {
  return edges.map(consumptionUtterance);
}

// ---------- topology settlement ----------

export interface JSNodeTopologyCarrier extends MemeTopologyCarrier {
  readonly _jsNodeTopologyBrand: never;
}

/** Self-witness one utterance: in the absence of independent evidence, an
 *  utterance's own token mark is the witness for its admitted charge (the same
 *  convention articulating's own consumers use via `witnessedPotential`). */
function admissionOf(carrier: UtteranceCarrier): UtteranceSettlementAdmission {
  if (!isMark(carrier.token.mark)) throw new TypeError("topology utterance token must carry a Mark");
  return { utterance: carrier, charge: witnessedPotential(carrier.token.mark) };
}

const JSNODE_CLOSURE_PROFILE = settlementClosureProfile("knowledge");

export function induceJSNodeTopology(utterances: readonly UtteranceCarrier[]): JSNodeTopologyCarrier {
  const witnesses = Object.freeze([...utterances]);
  const admissions = witnesses.map(admissionOf);
  return Object.freeze({
    kind: "meme-topology.carrier" as const,
    witnesses,
    fixedPointReadings: fixedPointReadingsOfUtterances(admissions, JSNODE_CLOSURE_PROFILE),
    settling: settleUtterances(admissions, JSNODE_CLOSURE_PROFILE),
  }) as JSNodeTopologyCarrier;
}

export function extendJSNodeTopology(
  carrier: JSNodeTopologyCarrier,
  delta: readonly UtteranceCarrier[],
): JSNodeTopologyCarrier {
  if (carrier.kind !== "meme-topology.carrier") throw new TypeError("extendJSNodeTopology: expected a JSNode topology carrier");
  return induceJSNodeTopology([...carrier.witnesses, ...delta]);
}

// ---------- workspace topology ----------

export function induceWorkspaceTopology(workspace: JSNodeWorkspace): JSNodeTopologyCarrier {
  return induceJSNodeTopology(workspace.utterances);
}
