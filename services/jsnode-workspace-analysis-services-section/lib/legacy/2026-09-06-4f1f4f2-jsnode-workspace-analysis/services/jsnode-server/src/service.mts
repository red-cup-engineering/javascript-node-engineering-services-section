/**
 * service — JSNodeServer: jsnode-computer bound to transports.
 *
 * A persistent process that discovers the workspace at startup (and
 * on each call to refresh()) and serves the package index over HTTP.
 * No wall-clock timestamps: the workspace state is the state of the
 * filesystem at the moment of the last refresh.
 *
 * Human surface (HTML, for a browser):
 *   GET /                — the package atlas: the workspace browsed by *subject*,
 *                          every domain a card with its description, role
 *                          coverage, and import degree (search-filterable). The
 *                          semantic homepage; the DAG is one click away.
 *   GET /graph           — the whole workspace as one clickable, pan/zoom SVG
 *                          DAG (search + stratum legend); the former homepage.
 *   GET /graph.svg       — that DAG as a standalone image/svg+xml document
 *   GET /packages/:name  — with Accept: text/html, the package's page (deps,
 *                          dependents, coordinates, and both graphs inline);
 *                          otherwise RDF as below
 *   GET /packages/:name/ego.svg      — the package's neighbourhood (deps +
 *                          dependents) as a focused dependency subgraph SVG;
 *                          /ego returns the same {nodes,edges} as JSON
 *   GET /packages/:name/symbols.svg  — the package's internal structure (types
 *                          as objects, functions as morphisms) as a shaped SVG;
 *                          /symbols returns the symbol graph as JSON
 *
 * Agent surface. `/packages/:name`, `/workspace`, and `/search`
 * content-negotiate JSON (default), Turtle, and JSON-LD:
 *   GET /healthz        — JSON { status, packages, types, functions, root,
 *                          lastRefreshedAt, refreshIntervalSeconds } — the
 *                          same freshness fields `POST /refresh` returns, so
 *                          staleness is measurable without forcing a refresh
 *   POST /refresh        — re-reads manifests and built declarations now,
 *                          invalidating every held index, and returns the
 *                          post-refresh /healthz payload — the deterministic
 *                          alternative to restarting the process
 *   GET /packages       — JSON array of JSNodePackage
 *   GET /packages/:name — JSNodePackage as JSON | Turtle | JSON-LD
 *   GET /workspace      — JSNodeWorkspace as JSON | Turtle | JSON-LD
 *   GET /search?q=<term>— ranked matches (name > tag > description) as JSON
 *   GET /atlas          — the domain atlas (the subject-facet catalog) as JSON
 *   GET /domains        — the domain quotient (subject dependency graph; the
 *                          dual of /quotient) as JSON | HTML
 *   GET /domains/:name  — one domain's catalog entry as JSON | Turtle | JSON-LD,
 *                          or its page as HTML
 *   GET /roles          — the role lexicon: the role facet as a defined
 *                          vocabulary (each role a concept with its authored
 *                          definition and live coverage) as JSON | HTML
 *   GET /roles/:role    — one role's concept as JSON | Turtle | JSON-LD (a SKOS
 *                          concept with its members), or its page as HTML
 *   GET /dependencies   — every declared dependency (registry + internal) with
 *                          usage, version ranges, and version drift, as JSON | HTML
 *   GET /consistency    — workspace health (node engines, script coverage,
 *                          module systems, hygiene gaps, drift) as JSON | HTML
 *   GET /build-order    — the dependency-respecting build tiers as JSON | HTML
 *   GET /lifecycle      — cohorts by disposition (deprecated/abandoned/…) and
 *                          maturity, the retirement queue with its migration
 *                          debt, and the frozen contracts, as JSON | HTML
 *   GET /typeflow       — the type-flow category (types as objects, functions as
 *                          morphisms, composition made explicit; hubs/sources/
 *                          sinks) as JSON | HTML
 *   GET /typeflow/:type — one type's hom-functor presentation (producers,
 *                          consumers, neighbours, reachability) as JSON | Turtle
 *                          | JSON-LD | HTML; ?to=<type> adds a shortest pipeline
 *   GET /vocab          — the factual RDF vocabulary as Turtle
 *
 * The type category — the ecosystem's types and functions read off the built
 * `dist` declarations and attributed to packages — is the topological analysis
 * served at:
 *   GET /types?match=<substring>            — attributed types whose name matches
 *   GET /functions?taking=<t>&producing=<t> — attributed functions by domain/codomain
 * The index behind these is heavy to build (one TypeScript program over every
 * package's declarations), so it is built once and HELD in process state, then
 * invalidated by refresh() — a live index, not a per-request recompute.
 */
import type { App, Repr, Context } from "@red-cup-engineering/http-server/server";
import { jsonRepr, textRepr, htmlRepr, mergeApps } from "@red-cup-engineering/http-server/server";
import { createMcpApp, type McpAuth } from "@red-cup-engineering/http-server/server";
import { JSNODE_TOOLS, jsnodeDispatch, jsnodeInstructions, type JSNodeDuplicationFilter, type JSNodeDuplicationMigrationFilter, type JSNodeMcpDeps, type JSNodeQueryFilter, type JSNodeSearchFilter, type JSNodeSectionQuery, type JSNodeTermLookup } from "./mcp.mjs";
import { wrapDispatchWithSearchJournal } from "./journal.mjs";
import {
  buildGlossaryIndex,
  buildSectionIndex,
  fabricationRecordsGraph,
  resolveGlossaryTerm,
  searchSections,
  type GlossaryEntry,
  type SectionEntry,
} from "./discovery.mjs";
import { fileURLToPath } from "node:url";
import {
  discoverWorkspace,
  workspaceTypeIndex,
  workspaceDependencyGraph,
  workspaceAnalysis,
  roleDomainGrid,
  roleQuotientGraph,
  workspaceSpectrum,
  packageNeighbourhoodSpectrum,
  dependencyGraphSvg,
  egoGraph,
  packageSymbolGraph,
  symbolGraphSvg,
  domainAtlas,
  domainQuotientGraph,
  roleCatalog,
  roleCatalogEntry,
  workspaceDependencies,
  workspaceConsistency,
  buildOrder,
  workspaceLifecycle,
  workspaceTypeFlow,
  typeFlowNeighbourhood,
  shortestPipeline,
  workspaceDuplication,
  planDuplicationMigration,
  type WorkspaceTypeIndex,
  type WorkspaceDependencyGraph,
  type WorkspaceSpectrum,
  type DomainAtlas,
  type DomainQuotientGraph,
  type RoleCatalog,
  type WorkspaceDependencies,
  type WorkspaceConsistency,
  type BuildOrder,
  type WorkspaceLifecycle,
  type WorkspaceTypeFlow,
} from "@red-cup-engineering/jsnode-computer";
import {
  renderDagPage,
  renderPackagePage,
  renderAnalysisPage,
  renderGridPage,
  renderQuotientPage,
  renderSpectrumPage,
  renderAtlasPage,
  renderDomainPage,
  renderDomainQuotientPage,
  renderRoleCatalogPage,
  renderRoleConceptPage,
  renderDependenciesPage,
  renderConsistencyPage,
  renderBuildOrderPage,
  renderLifecyclePage,
  renderTypeFlowPage,
  renderTypeFlowTypePage,
} from "./views.mjs";
import { searchPackages, packageCoordinate, roleConcept } from "@red-cup-engineering/jsnode-topology";
import type { JSNodePackage, JSNodeWorkspace } from "@red-cup-engineering/jsnode-topology";
import {
  packageTurtle,
  packageJsonLd,
  workspaceTurtle,
  workspaceJsonLd,
  domainTurtle,
  domainJsonLd,
  roleTurtle,
  roleJsonLd,
  typeFlowTurtle,
  typeFlowJsonLd,
  vocabulary,
} from "@red-cup-engineering/jsnode-codecs";

export type { JSNodePackage, JSNodeWorkspace, WorkspaceTypeIndex };

const TURTLE = "text/turtle; charset=utf-8";
const JSONLD = "application/ld+json; charset=utf-8";
const SVG = "image/svg+xml; charset=utf-8";
const HTML = "text/html";
const RDF_PRODUCES = ["application/json", "text/turtle", "application/ld+json"] as const;
// /packages/:name keeps RDF as the default (the agent contract) and adds HTML
// last, so a browser's explicit text/html still wins but `curl` stays JSON.
const PACKAGE_PRODUCES = [...RDF_PRODUCES, HTML] as const;

type EnrichedPackageMatch = ReturnType<typeof searchPackages>[number] & Readonly<{
  reasons?: readonly string[];
  consumers?: readonly string[];
  consumerDeclarations?: readonly Readonly<{ package: string; kind: string; range: string }>[];
  paths?: unknown;
}>;

/** Per-consumer detail (declarations, consumer names) beyond this count is
 *  trimmed under the default compact `detail: false` mode, since a widely
 *  depended-on package's full declaration list is what pushes a jsnode_search
 *  result over the MCP tool-result size limit (measured 2026-09-05: a single
 *  match's consumerDeclarations reached 161 entries, ~26KB alone). */
const CONSUMER_DETAIL_CAP = 20;

/**
 * MCP and HTTP share this evidence-preserving search projection. The fallbacks
 * keep the transport useful while jsnode-server remains pinned to an older
 * published jsnode-topology: they derive consumer declarations from the same
 * JSNode carriers and explicitly mark delivery paths unassayed.
 *
 * `options.limit`/`options.offset` page the (still fully computed) match set;
 * `count` always reports the full, unpaged total. `options.detail` (default
 * `false`) caps each match's `consumers`/`consumerDeclarations` arrays at
 * {@link CONSUMER_DETAIL_CAP}, adding a `*Total` field when a cap truncated
 * one; pass `true` for the previous, uncapped behavior.
 */
export function capabilitySearchPayload(
  packages: readonly JSNodePackage[],
  term: string,
  options?: Readonly<{ limit?: number; offset?: number; detail?: boolean }>,
) {
  const matches = searchPackages(packages, term) as readonly EnrichedPackageMatch[];
  const offset = options?.offset ?? 0;
  const limit = options?.limit;
  const detail = options?.detail ?? false;
  const paged = limit === undefined ? matches.slice(offset) : matches.slice(offset, offset + limit);
  return Object.freeze({
    term,
    count: matches.length,
    offset,
    ...(limit !== undefined ? { limit } : {}),
    matches: Object.freeze(paged.map((match) => {
      const declarations = packages.flatMap((consumer) => consumer.deps
        .filter((dependency) => dependency.name === match.package.name)
        .map((dependency) => Object.freeze({ package: consumer.name, kind: dependency.kind, range: dependency.range })))
        .sort((a, b) => a.package.localeCompare(b.package) || a.kind.localeCompare(b.kind));
      const fullConsumers = match.consumers ?? Object.freeze([...new Set(declarations
        .filter(({ kind }) => kind === "runtime")
        .map(({ package: consumer }) => consumer))]);
      const fullDeclarations = match.consumerDeclarations ?? Object.freeze(declarations);
      const consumers = detail || fullConsumers.length <= CONSUMER_DETAIL_CAP
        ? fullConsumers
        : Object.freeze(fullConsumers.slice(0, CONSUMER_DETAIL_CAP));
      const consumerDeclarations = detail || fullDeclarations.length <= CONSUMER_DETAIL_CAP
        ? fullDeclarations
        : Object.freeze(fullDeclarations.slice(0, CONSUMER_DETAIL_CAP));
      return Object.freeze({
        name: match.package.name,
        field: match.field,
        rank: match.rank,
        ...(match.tag !== undefined ? { tag: match.tag } : {}),
        layer: match.package.layer,
        tags: match.package.tags,
        description: match.package.description,
        reasons: match.reasons ?? Object.freeze([`${match.field} matches "${term}"`]),
        consumers,
        ...(consumers.length !== fullConsumers.length ? { consumersTotal: fullConsumers.length } : {}),
        consumerDeclarations,
        ...(consumerDeclarations.length !== fullDeclarations.length ? { consumerDeclarationsTotal: fullDeclarations.length } : {}),
        paths: match.paths ?? Object.freeze({
          source: Object.freeze({ status: "observed", version: match.package.version }),
          published: Object.freeze([]),
          installed: Object.freeze([]),
          live: Object.freeze([]),
          sourceOnly: null,
          classification: "source-with-unassayed-delivery",
        }),
      });
    })),
  });
}

/** Fields `jsnode_query`'s `return` may project. Kept in one place so the tool
 *  description, the input schema's enum, and the projector agree. */
const QUERY_FIELDS = [
  "name", "version", "description", "layer", "scope",
  "tags", "lifecycle", "maturity", "exports", "dependencies",
] as const;
type QueryField = typeof QUERY_FIELDS[number];

function queryFieldValue(pkg: JSNodePackage, field: QueryField): unknown {
  switch (field) {
    case "name": return pkg.name;
    case "version": return pkg.version;
    case "description": return pkg.description;
    case "layer": return pkg.layer;
    case "scope": return packageCoordinate(pkg.name).scope;
    case "tags": return pkg.tags;
    case "lifecycle": return pkg.lifecycle;
    case "maturity": return pkg.maturity;
    case "exports": return pkg.exports;
    case "dependencies": return pkg.dependencies;
  }
}

/**
 * The structured (quasi-SPARQL) filter behind `jsnode_query`: an AND of exact
 * (scope, layer) and case-insensitive substring (tag, name, description)
 * predicates over the package graph, projected to the requested `return`
 * fields. `count` is the full match total; `limit`, when given, only caps the
 * `packages` array — so a caller can tell a limited page from the whole set.
 */
export function packageQueryPayload(packages: readonly JSNodePackage[], filter: JSNodeQueryFilter) {
  const fields = (filter.return && filter.return.length > 0 ? filter.return : ["name"]) as readonly string[];
  for (const field of fields) {
    if (!(QUERY_FIELDS as readonly string[]).includes(field)) {
      throw new Error(`unknown return field: ${field} (choices: ${QUERY_FIELDS.join(", ")})`);
    }
  }
  const nameNeedle = filter.name?.toLowerCase();
  const tagNeedle = filter.tag?.toLowerCase();
  const descriptionNeedle = filter.description?.toLowerCase();
  const matches = packages
    .filter((pkg) => filter.scope === undefined || packageCoordinate(pkg.name).scope === filter.scope)
    .filter((pkg) => filter.layer === undefined || pkg.layer === filter.layer)
    .filter((pkg) => tagNeedle === undefined || pkg.tags.some((tag) => tag.toLowerCase().includes(tagNeedle)))
    .filter((pkg) => nameNeedle === undefined || pkg.name.toLowerCase().includes(nameNeedle))
    .filter((pkg) => descriptionNeedle === undefined || pkg.description.toLowerCase().includes(descriptionNeedle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const page = filter.limit !== undefined ? matches.slice(0, filter.limit) : matches;
  return Object.freeze({
    count: matches.length,
    packages: Object.freeze(page.map((pkg) => Object.freeze(
      Object.fromEntries((fields as readonly QueryField[]).map((field) => [field, queryFieldValue(pkg, field)])),
    ))),
  });
}

export type JSNodeServerConfig = Readonly<{
  name: string;
  root: string;
  /** Only the standalone CLI binds a port. When this app is mounted into a
   *  host (agrodao), it has no port of its own — so port is optional. */
  port?: number;
  /** Public base IRI for emitted linked data; defaults to "/". */
  base?: string;
  intervalSeconds?: number;
  /** When present, the service also exposes a Model Context Protocol endpoint
   *  (default `/mcp`, relative — so it rides any mount, e.g. `/jsnode/mcp`).
   *  `auth` is injected by the host that knows this resource's public identity;
   *  omit it for a loopback-only (local) MCP server. */
  mcp?: Readonly<{
    path?: string;
    auth?: McpAuth;
  }>;
}>;

/** Reported in the MCP `initialize` → `serverInfo.version` (both the HTTP and
 *  stdio transports — exported so the CLI's stdio path reports the same
 *  version without a second constant to keep in sync). */
export const MCP_SERVER_VERSION = "0.3.5";

// This file lives at <packageRoot>/dist/service.mjs (built from src/service.mts);
// the journal is owned by the package itself, independent of config.root
// (the workspace being indexed).
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

export interface JSNodeServer {
  readonly config: JSNodeServerConfig;
  readonly app: App;
  /** The in-process MCP data accessors, always built regardless of
   *  config.mcp, so a stdio transport (or any other host) can serve the same
   *  tool surface the HTTP /mcp route reads — one construction, shared. */
  readonly mcpDeps: JSNodeMcpDeps;
  refresh(): Promise<void>;
  snapshot(): JSNodeWorkspace | undefined;
  /** The held type-category index, built once on first read and on demand
   *  after refresh() invalidates it. Building runs the TypeScript compiler
   *  over every package's `dist`, so callers get a cached reference. */
  typeIndex(): WorkspaceTypeIndex;
  start(intervalMs?: number): void;
  stop(): void;
}

function packageMatcher(urlPath: string): Record<string, string> | null {
  const m = /^\/packages\/(.+)$/.exec(urlPath);
  return m ? { encodedName: m[1] ?? "" } : null;
}

function domainMatcher(urlPath: string): Record<string, string> | null {
  const m = /^\/domains\/(.+)$/.exec(urlPath);
  return m ? { encodedDomain: m[1] ?? "" } : null;
}

function typeFlowMatcher(urlPath: string): Record<string, string> | null {
  const m = /^\/typeflow\/(.+)$/.exec(urlPath);
  return m ? { encodedName: m[1] ?? "" } : null;
}

function roleMatcher(urlPath: string): Record<string, string> | null {
  const m = /^\/roles\/(.+)$/.exec(urlPath);
  return m ? { encodedRole: m[1] ?? "" } : null;
}

// A standalone SVG shown when a package contributes no symbols — almost always
// because it has never been built (`workspaceTypeIndex` reads `dist`). Says so
// rather than rendering a blank box that reads as a bug.
function emptySymbolSvg(name: string): string {
  const safe = name.replace(/[&<>]/g, "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 96" width="520" height="96" ` +
    `font-family="ui-monospace,Menlo,monospace" role="img">` +
    `<title>${safe} — no symbol surface</title>` +
    `<desc>This package has no built dist declarations, so its types and functions cannot be read. Build it to populate the symbol graph.</desc>` +
    `<rect width="520" height="96" fill="#0d1117"/>` +
    `<text x="260" y="44" text-anchor="middle" font-size="13" fill="#8b949e">no symbol surface — not built</text>` +
    `<text x="260" y="66" text-anchor="middle" font-size="11" fill="#6e7681">run the package's build to read its types &amp; functions</text>` +
    `</svg>`
  );
}

// Per-package sub-resource matchers (the two graphs). Anchored on a literal
// suffix the percent-encoded package name can't contain, so the greedy capture
// is unambiguous. These must be registered BEFORE the catch-all packageMatcher,
// which would otherwise swallow `<name>/ego.svg` as part of the name.
const subResourceMatcher = (suffix: string) => (urlPath: string): Record<string, string> | null => {
  const m = new RegExp(`^/packages/(.+)/${suffix}$`).exec(urlPath);
  return m ? { encodedName: m[1] ?? "" } : null;
};

export function createJSNodeServer(config: JSNodeServerConfig): JSNodeServer {
  let workspace: JSNodeWorkspace | undefined;
  let cachedTypeIndex: WorkspaceTypeIndex | undefined;
  let cachedGraph: WorkspaceDependencyGraph | undefined;
  let cachedSpectrum: WorkspaceSpectrum | undefined;
  let cachedAtlas: DomainAtlas | undefined;
  let cachedDomainQuotient: DomainQuotientGraph | undefined;
  let cachedRoleCatalog: RoleCatalog | undefined;
  let cachedDependencies: WorkspaceDependencies | undefined;
  let cachedConsistency: WorkspaceConsistency | undefined;
  let cachedBuildOrder: BuildOrder | undefined;
  let cachedLifecycle: WorkspaceLifecycle | undefined;
  let cachedTypeFlow: WorkspaceTypeFlow | undefined;
  const cachedDuplication = new Map<string, unknown>();
  const cachedDuplicationMigration = new Map<string, unknown>();
  let cachedGlossaryIndex: readonly GlossaryEntry[] | undefined;
  let cachedSectionIndex: readonly SectionEntry[] | undefined;
  const cachedFabricationRecords = new Map<number | undefined, unknown>();
  let timer: ReturnType<typeof setInterval> | undefined;
  // Server-process metadata only (when the in-memory index was last read off
  // disk), never folded into the workspace domain model itself — the package
  // graph stays timestamp-free; this answers "how stale can this be" for a
  // caller deciding whether to force a refresh.
  let lastRefreshedAt: string | undefined;
  const base = config.base ?? "/";
  const baseSlash = base.endsWith("/") ? base : base + "/";
  const pkgHref = (name: string): string => baseSlash + "packages/" + encodeURIComponent(name);
  const lookupPkg = (encoded: string): JSNodePackage | undefined => {
    const name = decodeURIComponent(encoded);
    return workspace?.packages.find((p) => p.name === name);
  };

  async function refresh(): Promise<void> {
    workspace = await discoverWorkspace(config.root);
    // Invalidate the held indices; the next read rebuilds them from the
    // filesystem state this refresh captured.
    cachedTypeIndex = undefined;
    cachedGraph = undefined;
    cachedSpectrum = undefined;
    cachedAtlas = undefined;
    cachedDomainQuotient = undefined;
    cachedRoleCatalog = undefined;
    cachedDependencies = undefined;
    cachedConsistency = undefined;
    cachedBuildOrder = undefined;
    cachedLifecycle = undefined;
    cachedTypeFlow = undefined;
    cachedDuplication.clear();
    cachedDuplicationMigration.clear();
    cachedGlossaryIndex = undefined;
    cachedSectionIndex = undefined;
    cachedFabricationRecords.clear();
    lastRefreshedAt = new Date().toISOString();
  }

  /** Shared by `/healthz`, `POST /refresh`, and the `jsnode_status`/
   *  `jsnode_refresh` MCP tools, so every freshness surface reports the same
   *  fields off the same state. Never forces the heavy type-index build. */
  function statusPayload(): Readonly<{
    status: "ok";
    packages: number;
    types: number | null;
    functions: number | null;
    root: string;
    lastRefreshedAt: string | null;
    refreshIntervalSeconds: number | null;
  }> {
    return Object.freeze({
      status: "ok" as const,
      packages: workspace?.packages.length ?? 0,
      types: cachedTypeIndex?.types.length ?? null,
      functions: cachedTypeIndex?.functions.length ?? null,
      root: config.root,
      lastRefreshedAt: lastRefreshedAt ?? null,
      refreshIntervalSeconds: config.intervalSeconds ?? null,
    });
  }

  // The internal dependency DAG over the held workspace. Cheap (a pure
  // projection of the manifests already read), but held so the SVG and the
  // package pages share one graph and refresh() invalidates it in lockstep.
  function ensureGraph(): WorkspaceDependencyGraph {
    if (cachedGraph === undefined) {
      cachedGraph = workspaceDependencyGraph(workspace ?? emptyWorkspace());
    }
    return cachedGraph;
  }

  // The workspace spectral field: every package's neighbourhood spanning-tree
  // count and cyclomatic number, computed off the held graph (one exact bignum
  // determinant per package, ~half a second whole), then held so /spectrum is a
  // lookup and refresh() invalidates it with the graph.
  function ensureSpectrum(): WorkspaceSpectrum {
    if (cachedSpectrum === undefined) {
      cachedSpectrum = workspaceSpectrum(ensureGraph());
    }
    return cachedSpectrum;
  }

  // The domain atlas (the subject-facet catalog) and the domain quotient (the
  // subject dependency graph), both pure projections of the held dependency
  // graph — cheap, but held so the homepage is a lookup and refresh()
  // invalidates them with the graph.
  function ensureAtlas(): DomainAtlas {
    if (cachedAtlas === undefined) {
      cachedAtlas = domainAtlas(ensureGraph());
    }
    return cachedAtlas;
  }

  function ensureDomainQuotient(): DomainQuotientGraph {
    if (cachedDomainQuotient === undefined) {
      cachedDomainQuotient = domainQuotientGraph(ensureGraph());
    }
    return cachedDomainQuotient;
  }

  // The role catalog (the Energy-facet vocabulary): every role joined to the
  // packages that instantiate it. A pure projection of the held dependency graph
  // plus the static lexicon — cheap, held so /roles is a lookup and refresh()
  // invalidates it with the graph.
  function ensureRoleCatalog(): RoleCatalog {
    if (cachedRoleCatalog === undefined) {
      cachedRoleCatalog = roleCatalog(ensureGraph());
    }
    return cachedRoleCatalog;
  }

  // The normie surface — the dependency report, the consistency report, and the
  // build order. The first two read the workspace carrier directly (every
  // declared dependency and manifest fact); the build order reads the internal
  // graph. All held off the workspace, so refresh() invalidates them.
  function ensureDependencies(): WorkspaceDependencies {
    if (cachedDependencies === undefined) {
      cachedDependencies = workspaceDependencies(workspace ?? emptyWorkspace());
    }
    return cachedDependencies;
  }

  function ensureConsistency(): WorkspaceConsistency {
    if (cachedConsistency === undefined) {
      cachedConsistency = workspaceConsistency(workspace ?? emptyWorkspace());
    }
    return cachedConsistency;
  }

  function ensureBuildOrder(): BuildOrder {
    if (cachedBuildOrder === undefined) {
      cachedBuildOrder = buildOrder(ensureGraph());
    }
    return cachedBuildOrder;
  }

  function ensureLifecycle(): WorkspaceLifecycle {
    if (cachedLifecycle === undefined) {
      cachedLifecycle = workspaceLifecycle(ensureGraph());
    }
    return cachedLifecycle;
  }

  // The glossary index behind jsnode_term — every glossary carrier in the
  // tree, read and folded once per refresh epoch (a tree-wide walk plus one
  // markdown parse per carrier), then held until refresh() clears it.
  function ensureGlossaryIndex(): readonly GlossaryEntry[] {
    if (cachedGlossaryIndex === undefined) {
      cachedGlossaryIndex = buildGlossaryIndex(config.root);
    }
    return cachedGlossaryIndex;
  }

  // The section index behind jsnode_section — every *-services-section
  // directory, folded once per refresh epoch, then held until refresh().
  function ensureSectionIndex(): readonly SectionEntry[] {
    if (cachedSectionIndex === undefined) {
      cachedSectionIndex = buildSectionIndex(config.root);
    }
    return cachedSectionIndex;
  }

  // Build the type-category index once and hold it. This is the costly read
  // (a TypeScript program over every package's declarations), so it must not
  // run per request — only on first use and after refresh() clears it.
  function ensureTypeIndex(): WorkspaceTypeIndex {
    if (cachedTypeIndex === undefined) {
      cachedTypeIndex = workspaceTypeIndex(config.root);
    }
    return cachedTypeIndex;
  }

  // The type-flow category — types as objects, functions as morphisms,
  // composition (codomain meets domain) made explicit. A pure projection of the
  // held type index, so its cost is the index build (held, not per-request) plus
  // a cheap pass; held so /typeflow is a lookup and refresh() invalidates it.
  function ensureTypeFlow(): WorkspaceTypeFlow {
    if (cachedTypeFlow === undefined) {
      cachedTypeFlow = workspaceTypeFlow(ensureTypeIndex());
    }
    return cachedTypeFlow;
  }

  function negotiatePackage(ctx: Context, pkg: JSNodePackage): Repr {
    if (ctx.negotiatedType === "text/turtle") return textRepr(packageTurtle(pkg, { base }), { type: TURTLE });
    if (ctx.negotiatedType === "application/ld+json") return textRepr(packageJsonLd(pkg, { base }), { type: JSONLD });
    return jsonRepr(pkg);
  }

  function negotiateWorkspace(ctx: Context, ws: JSNodeWorkspace): Repr {
    if (ctx.negotiatedType === "text/turtle") return textRepr(workspaceTurtle(ws, { base }), { type: TURTLE });
    if (ctx.negotiatedType === "application/ld+json") return textRepr(workspaceJsonLd(ws, { base }), { type: JSONLD });
    return jsonRepr(ws);
  }

  const emptyWorkspace = (): JSNodeWorkspace =>
    ({ kind: "jsnode.workspace", root: config.root, packages: [], utterances: [] }) as JSNodeWorkspace;

  const dagTitle = `${config.name} — workspace dependency DAG`;
  const atlasTitle = `${config.name} — package atlas`;
  const membersOfDomain = (domain: string): JSNodePackage[] =>
    (workspace?.packages ?? []).filter((p) => packageCoordinate(p.name).domain === domain);
  const membersOfRole = (role: string): JSNodePackage[] =>
    (workspace?.packages ?? []).filter((p) => packageCoordinate(p.name).role === role);

  const baseApp: App = {
    resources: [
      {
        // The homepage is the catalog: the workspace browsed by subject, with
        // names and descriptions — not the dependency DAG (now at /graph).
        match: "/",
        methods: ["GET"],
        produces: ["text/html"],
        handler: () => htmlRepr(renderAtlasPage(ensureAtlas(), { base, title: atlasTitle })),
      },
      {
        // The whole-workspace dependency DAG viewer — the former homepage.
        match: "/graph",
        methods: ["GET"],
        produces: ["text/html"],
        handler: () => htmlRepr(renderDagPage(ensureGraph(), { base, title: dagTitle })),
      },
      {
        match: "/graph.svg",
        methods: ["GET"],
        produces: ["image/svg+xml"],
        handler: () =>
          textRepr(
            dependencyGraphSvg(ensureGraph(), {
              title: dagTitle,
              href: (n) => pkgHref(n.name),
            }),
            { type: SVG },
          ),
      },
      {
        match: "/healthz",
        methods: ["GET"],
        produces: ["application/json"],
        handler: () => jsonRepr(statusPayload()),
      },
      {
        // Forces an immediate re-read of package manifests and built
        // declarations, invalidating every held index in lockstep — the
        // deterministic alternative to restarting the process when a caller
        // (an agent, a publish step) knows the workspace just changed.
        match: "/refresh",
        methods: ["POST"],
        produces: ["application/json"],
        handler: async () => {
          await refresh();
          return jsonRepr(statusPayload());
        },
      },
      {
        match: "/packages",
        methods: ["GET"],
        produces: ["application/json"],
        handler: () => jsonRepr(workspace?.packages ?? []),
      },
      {
        // The package's neighbourhood as a focused dependency subgraph (its
        // deps and dependents), the same renderer as the whole DAG with the
        // focus node outlined. `?up=`/`?down=` set the hop radius.
        match: subResourceMatcher("ego\\.svg"),
        route: "/packages/:name/ego.svg",
        methods: ["GET"],
        produces: ["image/svg+xml"],
        handler: (ctx) => {
          const name = decodeURIComponent(ctx.params["encodedName"] ?? "");
          const up = Number(ctx.url.searchParams.get("up") ?? "1");
          const down = Number(ctx.url.searchParams.get("down") ?? "1");
          const ego = egoGraph(ensureGraph(), name, {
            upDepth: Number.isFinite(up) ? up : 1,
            downDepth: Number.isFinite(down) ? down : 1,
          });
          return textRepr(
            dependencyGraphSvg(ego, { title: `${name} — neighbourhood`, focus: name, href: (n) => pkgHref(n.name) }),
            { type: SVG },
          );
        },
      },
      {
        match: subResourceMatcher("ego"),
        route: "/packages/:name/ego",
        methods: ["GET"],
        produces: ["application/json"],
        handler: (ctx) => {
          const name = decodeURIComponent(ctx.params["encodedName"] ?? "");
          const up = Number(ctx.url.searchParams.get("up") ?? "1");
          const down = Number(ctx.url.searchParams.get("down") ?? "1");
          const ego = egoGraph(ensureGraph(), name, {
            upDepth: Number.isFinite(up) ? up : 1,
            downDepth: Number.isFinite(down) ? down : 1,
          });
          return jsonRepr({ focus: name, nodes: ego.nodes, edges: ego.edges });
        },
      },
      {
        // The package's internal structure as a symbol graph (types as objects,
        // functions as morphisms; see jsnode-computer/symbol-graph). Built off
        // the held type index, so it reflects the last `dist` build.
        match: subResourceMatcher("symbols\\.svg"),
        route: "/packages/:name/symbols.svg",
        methods: ["GET"],
        produces: ["image/svg+xml"],
        handler: (ctx) => {
          const name = decodeURIComponent(ctx.params["encodedName"] ?? "");
          const sg = packageSymbolGraph(ensureTypeIndex(), name);
          if (!sg.populated) return textRepr(emptySymbolSvg(name), { type: SVG });
          return textRepr(symbolGraphSvg(sg, { title: `${name} — symbol graph` }), { type: SVG });
        },
      },
      {
        match: subResourceMatcher("symbols"),
        route: "/packages/:name/symbols",
        methods: ["GET"],
        produces: ["application/json"],
        handler: (ctx) => {
          const name = decodeURIComponent(ctx.params["encodedName"] ?? "");
          const sg = packageSymbolGraph(ensureTypeIndex(), name);
          return jsonRepr(sg);
        },
      },
      {
        // The exact spectral signature of this package's radius-1 dependency
        // neighbourhood: order, edges, components, the Kirchhoff spanning-tree
        // count, the cyclomatic number, and the full Laplacian characteristic
        // polynomial — the entire exact content of the neighbourhood's spectrum.
        // Computed off the held dependency graph (no type index), one bounded
        // bignum determinant.
        match: subResourceMatcher("spectrum"),
        route: "/packages/:name/spectrum",
        methods: ["GET"],
        produces: ["application/json"],
        handler: (ctx) => {
          const name = decodeURIComponent(ctx.params["encodedName"] ?? "");
          const spectrum = packageNeighbourhoodSpectrum(ensureGraph(), name);
          if (spectrum === undefined) return jsonRepr({ error: `package not found: ${name}` }, 404);
          return jsonRepr(spectrum);
        },
      },
      {
        match: packageMatcher,
        route: "/packages/:name",
        methods: ["GET"],
        produces: [...PACKAGE_PRODUCES],
        handler: (ctx) => {
          const encoded = ctx.params["encodedName"] ?? "";
          const name = decodeURIComponent(encoded);
          const pkg = workspace?.packages.find((p) => p.name === name);
          if (pkg === undefined) {
            if (ctx.negotiatedType === HTML) {
              return htmlRepr(`<!doctype html><meta charset=utf-8><title>not found</title>` +
                `<body style="background:#0d1117;color:#e6edf3;font-family:monospace;padding:2rem">` +
                `package not found: ${name.replace(/[&<>]/g, "")} — <a style="color:#79c0ff" href="${base}">back to the DAG</a>`, 404);
            }
            return jsonRepr({ error: `package not found: ${name}` }, 404);
          }
          if (ctx.negotiatedType === HTML) {
            const ego = egoGraph(ensureGraph(), name, { upDepth: 1, downDepth: 1 });
            const egoSvg = dependencyGraphSvg(ego, { title: `${name} — neighbourhood`, focus: name, href: (n) => pkgHref(n.name) });
            const sg = packageSymbolGraph(ensureTypeIndex(), name);
            const symbolSvg = sg.populated ? symbolGraphSvg(sg, { title: `${name} — symbol graph` }) : emptySymbolSvg(name);
            return htmlRepr(renderPackagePage(pkg, ensureGraph(), {
              base,
              egoSvg,
              symbolSvg,
              symbolBuilt: sg.populated,
              symbolCounts: { nodes: sg.nodes.length, edges: sg.edges.length },
            }));
          }
          return negotiatePackage(ctx, pkg);
        },
      },
      {
        match: "/workspace",
        methods: ["GET"],
        produces: [...RDF_PRODUCES],
        handler: (ctx) => negotiateWorkspace(ctx, workspace ?? emptyWorkspace()),
      },
      {
        match: "/search",
        methods: ["GET"],
        produces: ["application/json"],
        handler: (ctx) => {
          const term = ctx.url.searchParams.get("q") ?? "";
          const limitParam = ctx.url.searchParams.get("limit");
          const offsetParam = ctx.url.searchParams.get("offset");
          const detailParam = ctx.url.searchParams.get("detail");
          return jsonRepr(capabilitySearchPayload(workspace?.packages ?? [], term, {
            ...(limitParam !== null ? { limit: Number(limitParam) } : {}),
            ...(offsetParam !== null ? { offset: Number(offsetParam) } : {}),
            ...(detailParam !== null ? { detail: detailParam === "true" } : {}),
          }));
        },
      },
      {
        match: "/types",
        methods: ["GET"],
        produces: ["application/json"],
        handler: (ctx) => {
          const match = ctx.url.searchParams.get("match") ?? "";
          const needle = match.toLowerCase();
          const index = ensureTypeIndex();
          const types = match === ""
            ? index.types
            : index.types.filter((t) => t.name.toLowerCase().includes(needle));
          return jsonRepr({ match, count: types.length, types });
        },
      },
      {
        match: "/functions",
        methods: ["GET"],
        produces: ["application/json"],
        handler: (ctx) => {
          const taking = ctx.url.searchParams.get("taking");
          const producing = ctx.url.searchParams.get("producing");
          const index = ensureTypeIndex();
          let functions = index.functions;
          if (taking !== null && taking !== "") {
            functions = functions.filter((f) => f.domain.some((d) => d.includes(taking)));
          }
          if (producing !== null && producing !== "") {
            functions = functions.filter((f) => f.codomain !== undefined && f.codomain.includes(producing));
          }
          return jsonRepr({
            ...(taking !== null ? { taking } : {}),
            ...(producing !== null ? { producing } : {}),
            count: functions.length,
            functions,
          });
        },
      },
      {
        // The geometry and analysis of the dependency graph: components,
        // acyclicity/cycles, distance (diameter/radius/centre), and per-package
        // centrality and strata. JSON for agents, HTML for a browser.
        match: "/analysis",
        methods: ["GET"],
        produces: ["application/json", HTML],
        handler: (ctx) => {
          const analysis = workspaceAnalysis(ensureGraph());
          if (ctx.negotiatedType === HTML) {
            return htmlRepr(renderAnalysisPage(analysis, { base, title: `${config.name} — workspace analysis` }));
          }
          return jsonRepr(analysis);
        },
      },
      {
        // The flat layout as the (domain, role) fibration grid — the workspace's
        // naming convention read back as the 2-D structure it encodes.
        match: "/grid",
        methods: ["GET"],
        produces: ["application/json", HTML],
        handler: (ctx) => {
          const grid = roleDomainGrid((workspace?.packages ?? []).map((p) => p.name));
          if (ctx.negotiatedType === HTML) {
            return htmlRepr(renderGridPage(grid, { base, title: `${config.name} — fibration grid` }));
          }
          return jsonRepr(grid);
        },
      },
      {
        // The role quotient of the dependency graph — the base of the fibration
        // whose fibres /grid draws. Computed off the cached dependency graph (no
        // type index), so it is as cheap as /analysis. JSON for agents, HTML for
        // a browser.
        match: "/quotient",
        methods: ["GET"],
        produces: ["application/json", HTML],
        handler: (ctx) => {
          const graph = ensureGraph();
          const quotient = roleQuotientGraph(graph);
          if (ctx.negotiatedType === HTML) {
            // The package graph's own acyclicity, for contrast with the
            // quotient's — the sharp version of the finding.
            const packageAcyclic = workspaceAnalysis(graph).acyclic;
            return htmlRepr(renderQuotientPage(quotient, { base, title: `${config.name} — role quotient`, packageAcyclic }));
          }
          return jsonRepr(quotient);
        },
      },
      {
        // The spectral field: every package's radius-1 dependency neighbourhood
        // read through its exact graph Laplacian (Kirchhoff spanning-tree count,
        // cyclomatic number), ranked most redundantly-wired first. Held off the
        // dependency graph, so refresh() invalidates it. JSON for agents, HTML
        // for a browser; the per-neighbourhood characteristic polynomial is on
        // each package's /packages/:name/spectrum.
        match: "/spectrum",
        methods: ["GET"],
        produces: ["application/json", HTML],
        handler: (ctx) => {
          const spectrum = ensureSpectrum();
          if (ctx.negotiatedType === HTML) {
            return htmlRepr(renderSpectrumPage(spectrum, { base, title: `${config.name} — spectral field` }));
          }
          return jsonRepr(spectrum);
        },
      },
      {
        // The domain atlas: the workspace as a browsable catalog of subjects,
        // each with its representative description, role coverage, and import
        // degree. JSON for agents, HTML for a browser (the same page as `/`).
        match: "/atlas",
        methods: ["GET"],
        produces: ["application/json", HTML],
        handler: (ctx) => {
          const atlas = ensureAtlas();
          if (ctx.negotiatedType === HTML) {
            return htmlRepr(renderAtlasPage(atlas, { base, title: atlasTitle }));
          }
          return jsonRepr(atlas);
        },
      },
      {
        // The domain quotient — the dependency graph contracted to subjects, the
        // dual of /quotient. JSON for agents, HTML for a browser.
        match: "/domains",
        methods: ["GET"],
        produces: ["application/json", HTML],
        handler: (ctx) => {
          const quotient = ensureDomainQuotient();
          if (ctx.negotiatedType === HTML) {
            return htmlRepr(renderDomainQuotientPage(quotient, { base, title: `${config.name} — domain quotient` }));
          }
          return jsonRepr(quotient);
        },
      },
      {
        // One domain: its catalog entry as JSON (default), the domain as
        // linked data (Turtle | JSON-LD), or its page (HTML).
        match: domainMatcher,
        route: "/domains/:domain",
        methods: ["GET"],
        produces: [...PACKAGE_PRODUCES],
        handler: (ctx) => {
          const domain = decodeURIComponent(ctx.params["encodedDomain"] ?? "");
          const entry = ensureAtlas().domains.find((d) => d.domain === domain);
          if (entry === undefined) {
            if (ctx.negotiatedType === HTML) {
              return htmlRepr(`<!doctype html><meta charset=utf-8><title>not found</title>` +
                `<body style="background:#0d1117;color:#e6edf3;font-family:monospace;padding:2rem">` +
                `domain not found: ${domain.replace(/[&<>]/g, "")} — <a style="color:#79c0ff" href="${base}">back to the atlas</a>`, 404);
            }
            return jsonRepr({ error: `domain not found: ${domain}` }, 404);
          }
          if (ctx.negotiatedType === "text/turtle") {
            return textRepr(domainTurtle(domain, membersOfDomain(domain), { base }), { type: TURTLE });
          }
          if (ctx.negotiatedType === "application/ld+json") {
            return textRepr(domainJsonLd(domain, membersOfDomain(domain), { base }), { type: JSONLD });
          }
          if (ctx.negotiatedType === HTML) {
            return htmlRepr(renderDomainPage(entry, { base }));
          }
          return jsonRepr(entry);
        },
      },
      {
        // The role lexicon: the workspace's roles as a defined vocabulary —
        // every role a concept with its authored definition and live coverage.
        // The Energy-facet dual of /atlas. JSON for agents, HTML for a browser.
        match: "/roles",
        methods: ["GET"],
        produces: ["application/json", HTML],
        handler: (ctx) => {
          const catalog = ensureRoleCatalog();
          if (ctx.negotiatedType === HTML) {
            return htmlRepr(renderRoleCatalogPage(catalog, { base, title: `${config.name} — role lexicon` }));
          }
          return jsonRepr(catalog);
        },
      },
      {
        // One role: its catalog entry as JSON (default), the role as linked data
        // (a SKOS concept — Turtle | JSON-LD), or its concept page (HTML).
        match: roleMatcher,
        route: "/roles/:role",
        methods: ["GET"],
        produces: [...PACKAGE_PRODUCES],
        handler: (ctx) => {
          const role = decodeURIComponent(ctx.params["encodedRole"] ?? "");
          const entry = roleCatalogEntry(ensureGraph(), role);
          if (entry === undefined) {
            if (ctx.negotiatedType === HTML) {
              return htmlRepr(`<!doctype html><meta charset=utf-8><title>not found</title>` +
                `<body style="background:#0d1117;color:#e6edf3;font-family:monospace;padding:2rem">` +
                `not a known role: ${role.replace(/[&<>]/g, "")} — <a style="color:#79c0ff" href="${base}roles">back to the role lexicon</a>`, 404);
            }
            return jsonRepr({ error: `not a known role: ${role}` }, 404);
          }
          // The pure concept (role, stratum, classification, gloss, source) for
          // the codecs; the full member packages for the RDF member blocks.
          if (ctx.negotiatedType === "text/turtle") {
            return textRepr(roleTurtle(roleConcept(entry.role), membersOfRole(entry.role), { base }), { type: TURTLE });
          }
          if (ctx.negotiatedType === "application/ld+json") {
            return textRepr(roleJsonLd(roleConcept(entry.role), membersOfRole(entry.role), { base }), { type: JSONLD });
          }
          if (ctx.negotiatedType === HTML) {
            return htmlRepr(renderRoleConceptPage(entry, { base }));
          }
          return jsonRepr(entry);
        },
      },
      {
        // The type-flow category: types as objects, functions as morphisms, and
        // the composition edges (codomain meets domain) made explicit, with the
        // hub carriers, sources, and sinks. JSON for agents, HTML for a browser.
        match: "/typeflow",
        methods: ["GET"],
        produces: ["application/json", HTML],
        handler: (ctx) => {
          const flow = ensureTypeFlow();
          if (ctx.negotiatedType === HTML) {
            const total = workspace?.packages.length;
            return htmlRepr(renderTypeFlowPage(flow, {
              base,
              title: `${config.name} — type flow`,
              ...(total !== undefined ? { totalPackages: total } : {}),
            }));
          }
          return jsonRepr(flow);
        },
      },
      {
        // One type's hom-functor presentation: the functions that produce and
        // consume it, its one-step neighbours, and what it reaches by
        // composition. `?to=<type>` adds a shortest pipeline to that target.
        // JSON (default) | Turtle | JSON-LD | HTML.
        match: typeFlowMatcher,
        route: "/typeflow/:name",
        methods: ["GET"],
        produces: [...PACKAGE_PRODUCES],
        handler: (ctx) => {
          const name = decodeURIComponent(ctx.params["encodedName"] ?? "");
          const flow = ensureTypeFlow();
          const nb = typeFlowNeighbourhood(ensureTypeIndex(), flow, name);
          if (nb === undefined) {
            const ambiguous = flow.ambiguousNames.includes(name);
            const safe = name.replace(/[&<>]/g, "");
            if (ctx.negotiatedType === HTML) {
              const msg = ambiguous
                ? `<b>${safe}</b> is declared in more than one package, so it is not addressable in the type-flow category — it is held out of the confident graph.`
                : `type not found in the flow: ${safe}`;
              return htmlRepr(`<!doctype html><meta charset=utf-8><title>not addressable</title>` +
                `<body style="background:#0d1117;color:#e6edf3;font-family:monospace;padding:2rem;line-height:1.5">` +
                `${msg} — <a style="color:#79c0ff" href="${base}typeflow">back to type flow</a>`, ambiguous ? 409 : 404);
            }
            return jsonRepr(
              ambiguous
                ? { error: "ambiguous type name; not addressable", name, addressable: false }
                : { error: `type not found in the flow: ${name}` },
              ambiguous ? 409 : 404,
            );
          }
          const to = ctx.url.searchParams.get("to");
          const steps = to !== null && to !== "" ? shortestPipeline(flow, name, to) : undefined;
          if (ctx.negotiatedType === "text/turtle") return textRepr(typeFlowTurtle(nb, { base }), { type: TURTLE });
          if (ctx.negotiatedType === "application/ld+json") return textRepr(typeFlowJsonLd(nb, { base }), { type: JSONLD });
          if (ctx.negotiatedType === HTML) {
            const desc = workspace?.packages.find((p) => p.name === nb.pkg)?.description;
            return htmlRepr(renderTypeFlowTypePage(nb, {
              base,
              ...(to !== null && to !== "" ? { pipeline: { to, steps: steps ?? null } } : {}),
              ...(desc ? { packageDescription: desc } : {}),
            }));
          }
          return jsonRepr(to !== null && to !== "" ? { ...nb, pipeline: { to, steps: steps ?? null } } : nb);
        },
      },
      {
        match: "/vocab",
        methods: ["GET"],
        produces: ["text/turtle"],
        handler: () => textRepr(vocabulary(base), { type: TURTLE }),
      },
      {
        // The dependency report: every declared dependency (registry and
        // internal), who uses it, at which version ranges, and the drift where
        // those ranges diverge. Convention-agnostic. JSON for agents, HTML for a
        // browser.
        match: "/dependencies",
        methods: ["GET"],
        produces: ["application/json", HTML],
        handler: (ctx) => {
          const rep = ensureDependencies();
          if (ctx.negotiatedType === HTML) {
            return htmlRepr(renderDependenciesPage(rep, { base, title: `${config.name} — dependencies` }));
          }
          return jsonRepr(rep);
        },
      },
      {
        // The consistency report: Node engine spread, script coverage, module
        // system split, hygiene gaps, and the dependency drift folded in — the
        // workspace's plain health. JSON for agents, HTML for a browser.
        match: "/consistency",
        methods: ["GET"],
        produces: ["application/json", HTML],
        handler: (ctx) => {
          const rep = ensureConsistency();
          if (ctx.negotiatedType === HTML) {
            return htmlRepr(renderConsistencyPage(rep, { base, title: `${config.name} — consistency` }));
          }
          return jsonRepr(rep);
        },
      },
      {
        // The build order: the dependency-respecting tiers the workspace builds
        // in (tier 0 first), with any cycle called out. JSON for agents, HTML for
        // a browser.
        match: "/build-order",
        methods: ["GET"],
        produces: ["application/json", HTML],
        handler: (ctx) => {
          const bo = ensureBuildOrder();
          if (ctx.negotiatedType === HTML) {
            return htmlRepr(renderBuildOrderPage(bo, { base, title: `${config.name} — build order` }));
          }
          return jsonRepr(bo);
        },
      },
      {
        // The lifecycle report: cohorts by disposition (active/maintenance/
        // deprecated/abandoned) and maturity (experimental/alpha/beta/stable),
        // the retirement queue with its migration debt, and the frozen contracts.
        // JSON for agents, HTML for a browser.
        match: "/lifecycle",
        methods: ["GET"],
        produces: ["application/json", HTML],
        handler: (ctx) => {
          const lc = ensureLifecycle();
          if (ctx.negotiatedType === HTML) {
            return htmlRepr(renderLifecyclePage(lc, { base, title: `${config.name} — lifecycle` }));
          }
          return jsonRepr(lc);
        },
      },
    ],
  };

  // The in-process MCP data accessors. Built unconditionally — every closure
  // it reads (ensureAtlas, ensureGraph, etc.) already exists regardless of
  // config.mcp — so both the HTTP /mcp route and a stdio transport can share
  // exactly one construction, one cache, invalidated by refresh() in lockstep.
  const mcpDeps: JSNodeMcpDeps = {
    search: (filter: JSNodeSearchFilter) => {
      return capabilitySearchPayload(workspace?.packages ?? [], filter.query, {
        limit: filter.limit ?? 10,
        offset: filter.offset ?? 0,
        detail: filter.detail ?? false,
      });
    },
    package: (name) => {
      const pkg = workspace?.packages.find((p) => p.name === name);
      if (pkg === undefined) return undefined;
      // The tool's own description promises "dependencies and dependents";
      // `pkg` only carries `dependencies` (a source-declared field). `dependents`
      // is the reverse edge, held nowhere on the package record itself — it is
      // read off the graph the same way the HTML package page already does
      // (views.mts renderPackagePage), so both surfaces agree.
      const dependents = ensureGraph().edges.filter((e) => e.to === pkg.name).map((e) => e.from).sort();
      return { ...pkg, dependents };
    },
    atlas: () => ensureAtlas(),
    domains: () => ensureDomainQuotient(),
    analysis: () => workspaceAnalysis(ensureGraph()),
    typeFlow: () => ensureTypeFlow(),
    typeFlowType: (type, to) => {
      const flow = ensureTypeFlow();
      const nb = typeFlowNeighbourhood(ensureTypeIndex(), flow, type);
      if (nb === undefined) return undefined;
      if (to !== undefined) {
        const steps = shortestPipeline(flow, type, to);
        return { ...nb, pipeline: { to, steps: steps ?? null } };
      }
      return nb;
    },
    types: (match) => {
      const index = ensureTypeIndex();
      const needle = match.toLowerCase();
      const types = match === "" ? index.types : index.types.filter((t) => t.name.toLowerCase().includes(needle));
      return { match, count: types.length, types };
    },
    functions: (taking, producing) => {
      const index = ensureTypeIndex();
      let functions = index.functions;
      if (taking !== undefined) functions = functions.filter((f) => f.domain.some((d) => d.includes(taking)));
      if (producing !== undefined) {
        functions = functions.filter((f) => f.codomain !== undefined && f.codomain.includes(producing));
      }
      return {
        ...(taking !== undefined ? { taking } : {}),
        ...(producing !== undefined ? { producing } : {}),
        count: functions.length,
        functions,
      };
    },
    duplication: (filter: JSNodeDuplicationFilter) => {
      const key = JSON.stringify(filter);
      let report = cachedDuplication.get(key);
      if (report === undefined) {
        report = workspaceDuplication(config.root, filter);
        cachedDuplication.set(key, report);
      }
      return report;
    },
    duplicationMigration: (selector: JSNodeDuplicationMigrationFilter) => {
      const key = JSON.stringify(selector);
      let plan = cachedDuplicationMigration.get(key);
      if (plan === undefined) {
        plan = planDuplicationMigration(
          config.root,
          {
            ...(selector.fingerprint !== undefined ? { fingerprint: selector.fingerprint } : {}),
            ...(selector.rank !== undefined ? { rank: selector.rank } : {}),
          },
          {
            ...(selector.scope !== undefined ? { scope: selector.scope } : {}),
            ...(selector.minimumBytes !== undefined ? { minimumBytes: selector.minimumBytes } : {}),
            ...(selector.owner !== undefined ? { owner: selector.owner } : {}),
          },
        );
        cachedDuplicationMigration.set(key, plan);
      }
      return plan;
    },
    query: (filter) => packageQueryPayload(workspace?.packages ?? [], filter),
    status: () => statusPayload(),
    refresh: async () => {
      await refresh();
      return statusPayload();
    },
    term: (lookup: JSNodeTermLookup) => {
      const matches = resolveGlossaryTerm(ensureGlossaryIndex(), lookup.name, { includeLegacy: lookup.includeLegacy ?? false });
      return { name: lookup.name, includeLegacy: lookup.includeLegacy ?? false, count: matches.length, matches };
    },
    section: (query: JSNodeSectionQuery) => searchSections(ensureSectionIndex(), query.query, query.limit ?? 10),
    fabricationRecords: (limit: number | undefined) => {
      let report = cachedFabricationRecords.get(limit);
      if (report === undefined) {
        report = fabricationRecordsGraph(config.root, workspace?.packages ?? [], limit);
        cachedFabricationRecords.set(limit, report);
      }
      return report;
    },
  };

  // The MCP HTTP endpoint (optional). The resource path is relative, so when
  // this app is mounted at /jsnode it serves at /jsnode/mcp; auth, when
  // present, is injected by the host (agrodao) that knows this resource's
  // public identity.
  let app: App = baseApp;
  if (config.mcp !== undefined) {
    const { app: mcpApp } = createMcpApp({
      path: config.mcp.path ?? "/mcp",
      serverInfo: { name: config.name, version: MCP_SERVER_VERSION },
      instructions: jsnodeInstructions(config.name),
      tools: JSNODE_TOOLS,
      dispatch: wrapDispatchWithSearchJournal(jsnodeDispatch(mcpDeps), { packageRoot: PACKAGE_ROOT, server: "jsnode-server" }),
      ...(config.mcp.auth !== undefined ? { auth: config.mcp.auth } : {}),
    });
    app = mergeApps(baseApp, mcpApp);
  }

  return {
    config,
    app,
    mcpDeps,
    refresh,
    snapshot: () => workspace,
    typeIndex: ensureTypeIndex,
    start(intervalMs?: number) {
      const ms = intervalMs ?? (config.intervalSeconds !== undefined ? config.intervalSeconds * 1000 : undefined);
      if (ms !== undefined) {
        timer = setInterval(() => { void refresh(); }, ms);
      }
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}

export function jsNodeServerConfigFromManifest(manifest: Record<string, unknown>): JSNodeServerConfig {
  const raw = manifest["561:jsnode-server"];
  if (raw === null || typeof raw !== "object") {
    throw new Error("package.json missing 561:jsnode-server configuration");
  }
  const cfg = raw as Record<string, unknown>;
  const name = typeof cfg["name"] === "string" ? cfg["name"] : "jsnode-server";
  const port = typeof cfg["port"] === "number" ? cfg["port"] : 18808;
  const root = typeof cfg["root"] === "string" && cfg["root"].length > 0 ? cfg["root"] : "";
  const base = typeof cfg["base"] === "string" && cfg["base"].length > 0 ? cfg["base"] : undefined;
  const intervalSeconds = typeof cfg["intervalSeconds"] === "number" ? cfg["intervalSeconds"] : undefined;
  // `mcp: true` enables a loopback-only MCP endpoint for the standalone server
  // (no auth — local processes only). A host that fronts this with OAuth injects
  // `auth` in code instead, so the manifest can only ever turn it on locally.
  const mcp = cfg["mcp"] === true ? {} : undefined;
  return {
    name,
    root,
    port,
    ...(base !== undefined ? { base } : {}),
    ...(intervalSeconds !== undefined ? { intervalSeconds } : {}),
    ...(mcp !== undefined ? { mcp } : {}),
  };
}
