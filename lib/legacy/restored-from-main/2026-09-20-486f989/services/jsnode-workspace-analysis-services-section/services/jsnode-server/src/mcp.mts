import { journalOperation, type SearchJournalOptions } from "./journal.mjs";
export type JSNodeReportQuery = Readonly<{ kind: string; name?: string; up?: number; down?: number }>;
/**
 * mcp — the JSNodeServer's Model Context Protocol surface.
 *
 * Owns the MCP contract (tool descriptors, `instructions`, `tools/call`
 * argument parsing); data comes from the service via `JSNodeMcpDeps`,
 * sharing its in-process indices — no round-trip, one cache, invalidated
 * by refresh(). Tools mirror the HTTP agent surface documented there.
 */
import { defineType, type DataType } from "@red-cup-engineering/computer-data-engine";
import { declareCapabilityOperation, type Operation } from "@red-cup-engineering/computer-platform/operations";
import { createComputerPlatform, bindingsProviders, type CapabilityProvider } from "@red-cup-engineering/computer-platform";
import { mcpToolsOfOperations, type McpTool } from "@red-cup-engineering/computer-platform/mcp-server";

/** `jsnode_search`'s query: `limit` (default 10) and `offset` (default 0)
 *  page the ranked match set without affecting the reported `count`; `detail`
 *  (default `false`, compact) caps each match's `consumers`/
 *  `consumerDeclarations` arrays rather than returning every consumer
 *  declaration — pass `true` for the full, uncapped per-consumer detail. */
export interface JSNodeSearchFilter {
  readonly query: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly detail?: boolean;
}

/** A structured, AND-combined filter over the package graph for `jsnode_query`
 *  (see that tool's description for the field semantics). `return` selects
 *  which fields to project per match (default `["name"]`); `limit` caps the
 *  returned packages array without affecting the reported `count`. */
export interface JSNodeQueryFilter {
  readonly scope?: string;
  readonly layer?: string;
  readonly tag?: string;
  readonly name?: string;
  readonly description?: string;
  readonly pathContains?: string;
  readonly dependsOn?: string;
  readonly lacksDependency?: string;
  readonly return?: readonly string[];
  readonly limit?: number;
}

/** `jsnode_term`'s lookup: `name` resolves by identity, frontmatter name, or
 *  alias; `includeLegacy` widens the pool to `lib/legacy` carriers (default
 *  excluded). */
export interface JSNodeTermLookup {
  readonly name: string;
  readonly includeLegacy?: boolean;
}

/** `jsnode_section`'s search: `query` words are matched against each
 *  section's significant name words and README first paragraph. */
export interface JSNodeSectionQuery {
  readonly query: string;
  readonly limit?: number;
}

/** `jsnode_duplication`'s filter: `limit`/`offset` page the ranked candidate
 *  set without affecting the reported `candidateCount`; `detail` (default
 *  `false`, compact) caps each candidate's `implementations`/`ownerEvidence`
 *  arrays rather than returning every site — pass `true` for the full,
 *  uncapped per-implementation detail. Mirrors jsnode_search's own filter. */
export interface JSNodeDuplicationFilter {
  readonly scope?: string;
  readonly minimumBytes?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly detail?: boolean;
}

export interface JSNodeContextQuery {
  readonly prompt: string;
  readonly focus?: string;
  readonly limit?: number;
  readonly maxBytes?: number;
}

/** Selects one jsnode_duplication candidate to plan a migration for (exactly
 *  one of `fingerprint`/`rank`, enforced by the dispatcher, not this shape)
 *  and narrows/overrides the plan the same way jsnode_duplication's own
 *  filter does, plus `owner` to override the candidate's upstream-owner hint. */
export interface JSNodeDuplicationMigrationFilter {
  readonly fingerprint?: string;
  readonly rank?: number;
  readonly owner?: string;
  readonly scope?: string;
  readonly minimumBytes?: number;
}

/** The in-process data accessors the tools delegate to. Each returns the same
 *  JSON value the corresponding HTTP route emits; `undefined` means not found. */
export interface JSNodeMcpDeps {
  search(filter: JSNodeSearchFilter): unknown;
  package(name: string): unknown | undefined;
  atlas(): unknown;
  analysis(): unknown;
  typeFlow(): unknown;
  typeFlowType(type: string, to: string | undefined): unknown | undefined;
  types(match: string, page?: { limit?: number; offset?: number }): unknown;
  functions(taking: string | undefined, producing: string | undefined, page?: { match?: string; limit?: number; offset?: number }): unknown;
  domains(): unknown;
  query(filter: JSNodeQueryFilter): unknown;
  duplication(filter: JSNodeDuplicationFilter): unknown;
  /** Plans (never applies) migrating one jsnode_duplication candidate onto a
   *  canonical owner. Returns the plan JSON (`applicable`, `refusals`, ...);
   *  applying an `applicable` plan is `--apply` on the jsnode-engineering-cli CLI. */
  duplicationMigration(selector: JSNodeDuplicationMigrationFilter): unknown;
  /** The same freshness fields `/healthz` reports: packages/types/functions
   *  counts, root, `lastRefreshedAt`, and `refreshIntervalSeconds`. */
  status(): unknown;
  /** Re-reads manifests and authored source declarations now, invalidating every held
   *  index, and returns the post-refresh status payload. */
  refresh(): Promise<unknown>;
  /** Resolves a glossary term/concept/topic by identity, name, or alias
   *  across every glossary in the tree. */
  term(lookup: JSNodeTermLookup): unknown;
  /** Scores every `*-services-section` directory against a free-text query. */
  section(query: JSNodeSectionQuery): unknown;
  /** The fabrication work-order and receipt graph, joined to packages. */
  fabricationRecords(limit: number | undefined): unknown;
  context(query: JSNodeContextQuery): unknown;
  report(query: JSNodeReportQuery): unknown;
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false, destructiveHint: false } as const;
// Re-reads the filesystem and rebuilds in-process caches; idempotent and
// local-only, so not destructive, but not a pure read either.
const REFRESHES_INDEX = { readOnlyHint: false, openWorldHint: false, destructiveHint: false } as const;

type JSNodeOperationHost = (input: unknown) => unknown | Promise<unknown>;
type JSNodeToolDefinition = McpTool & Readonly<{ bind: (deps: JSNodeMcpDeps) => JSNodeOperationHost }>;

const JSNODE_TOOL_DEFINITIONS = [
  {
    name: "jsnode_report", description: "Read the workspace, dependency graph, role grid/quotient, spectral field, roles, dependency/consistency/build/lifecycle reports, RDF data, or graph SVG.",
    inputSchema: { type: "object", required: ["kind"], properties: { kind: { enum: ["workspace", "graph", "graph-svg", "grid", "quotient", "spectrum", "roles", "dependencies", "consistency", "build-order", "lifecycle", "vocabulary", "workspace-turtle", "workspace-jsonld", "package-graph", "package-graph-svg", "package-symbols", "package-symbols-svg", "package-spectrum", "package-turtle", "package-jsonld", "domain-turtle", "domain-jsonld", "role", "role-turtle", "role-jsonld", "type-turtle", "type-jsonld"] }, name: { type: "string", minLength: 1 }, up: { type: "integer", minimum: 0 }, down: { type: "integer", minimum: 0 } }, additionalProperties: false },
    annotations: READ_ONLY, bind: (deps) => (args) => deps.report(args as JSNodeReportQuery),
  },
  {
    name: "jsnode_context",
    description: "Project bounded relevant package, bin, and export evidence for an exact prompt from the held workspace manifest index. It never builds the TypeScript declaration index; unavailable type evidence is stated explicitly.",
    inputSchema: { type: "object", properties: { prompt: { type: "string" }, focus: { type: "string" }, limit: { type: "number" }, maxBytes: { type: "number" } }, required: ["prompt"], additionalProperties: false },
    annotations: READ_ONLY,
    bind: (deps) => (args) => deps.context(args as JSNodeContextQuery),
  },
  {
    name: "jsnode_search",
    description:
      "Search conceptually for capability owners, ranked (name > keyword > description). Results explain the match, list current source-declared consumers, and keep source evidence distinct from assayed published, installed, and live paths. Ranked matches are paged (limit default 10, offset default 0); count always reports the full unpaged total. detail (default false) keeps each match compact by capping its consumers/consumerDeclarations arrays — a widely-depended-on package's full declaration list is what can push a broad query's result past the tool's size limit; pass detail:true for the full per-consumer list on a single already-narrowed match. Use this FIRST, then jsnode_package for detail.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Capability term or alias, matched against package name, keywords, and description" },
        limit: { type: "number", description: "Maximum ranked matches returned; default 10. count reports the full match total regardless of limit" },
        offset: { type: "number", description: "Ranked matches to skip before applying limit; default 0" },
        detail: { type: "boolean", description: "Return every consumer/consumerDeclarations entry uncapped per match; default false (capped, compact)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    bind: (deps) => (args) => deps.search(args as JSNodeSearchFilter),
  },
  {
    name: "jsnode_package",
    description:
      "The full record for one workspace package by exact name (e.g. @red-cup-engineering/jsnode-engineering-cli): its description, layer, tags, coordinate, and its dependencies and dependents within the workspace.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Exact package name" } },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    bind: (deps) => (args) => {
      const record = deps.package((args as JSNodeQueryFilter).name ?? "");
      if (record === undefined) throw new Error(`package not found: ${(args as JSNodeQueryFilter).name ?? ""}`);
      return record;
    },
  },
  {
    name: "jsnode_atlas",
    description:
      "The domain atlas: the workspace browsed by subject. Each domain with its representative description, role coverage, and import degree — the best whole-workspace overview.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    bind: (deps) => () => deps.atlas(),
  },
  {
    name: "jsnode_domains",
    description:
      "The domain quotient: the dependency graph contracted to subjects (which subject areas depend on which). The bird's-eye dependency structure.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    bind: (deps) => () => deps.domains(),
  },
  {
    name: "jsnode_analysis",
    description:
      "The geometry of the dependency graph: connected components, acyclicity/cycles, distance (diameter/radius/centre), and per-package centrality and strata.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    bind: (deps) => () => deps.analysis(),
  },
  {
    name: "jsnode_typeflow",
    description:
      "The type-flow category: types as objects and functions as morphisms, with composition (codomain meets domain) made explicit — the hub types, sources, and sinks across current workspace source. Source is parsed without loading the TypeScript type checker or requiring builds; the index is then cached.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    bind: (deps) => () => deps.typeFlow(),
  },
  {
    name: "jsnode_typeflow_type",
    description:
      "One type's hom-functor presentation: the functions that produce and consume it, its one-step neighbours, and what it reaches by composition. Pass `to` to also get a shortest pipeline of functions from this type to that one.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "The type name (must be addressable — declared in exactly one package)" },
        to: { type: "string", description: "Optional target type; returns a shortest function pipeline from `type` to `to`" },
      },
      required: ["type"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    bind: (deps) => (args) => {
      const input = args as { type: string; to?: string };
      const record = deps.typeFlowType(input.type, input.to);
      if (record === undefined) throw new Error(`type not addressable in the flow: ${input.type}`);
      return record;
    },
  },
  {
    name: "jsnode_types",
    description:
      "Attributed types across current workspace source, optionally filtered to those whose name contains a substring. Each result includes its source coordinates and observed public imports. Results are paged (default 50, maximum 200).",
    inputSchema: {
      type: "object",
      properties: { match: { type: "string", description: "Optional case-insensitive substring of the type name" }, limit: { type: "integer", minimum: 1, maximum: 200, default: 50 }, offset: { type: "integer", minimum: 0, default: 0 } },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    bind: (deps) => (args) => { const input = args as { match?: string; limit?: number; offset?: number }; return deps.types(input.match ?? "", input); },
  },
  {
    name: "jsnode_functions",
    description:
      "Attributed functions across current workspace source, optionally filtered by a type in their domain (`taking`) and/or their codomain (`producing`). Name search includes untyped JavaScript; missing annotations remain unknown. Results include definition coordinates and observed public imports, paged at 50 by default (maximum 200).",
    inputSchema: {
      type: "object",
      properties: {
        match: { type: "string", description: "Optional case-insensitive function-name substring" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        offset: { type: "integer", minimum: 0, default: 0 },
        taking: { type: "string", description: "Optional: substring of a parameter type" },
        producing: { type: "string", description: "Optional: substring of the return type" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    bind: (deps) => (args) => {
      const input = args as { taking?: string; producing?: string; match?: string; limit?: number; offset?: number };
      return deps.functions(input.taking, input.producing, input);
    },
  },
  {
    name: "jsnode_duplication",
    description:
      "Find repeated executable behavior by normalized TypeScript AST, ranked by removable source bytes and real package consumers. Local names and literal policy values may vary; encoding direction, invoked APIs, and control flow must match. Generated carriers and physical package/file replicas are excluded. `owner` is a hint, never proof of a usable public contract by itself: `ownerBasis` names whether it came from an existing dependency edge (\"dependency-graph\") or from the org-layering law naming the sole computer-data/code/networking-seated package with no edge required (\"layering-law\"); `ownerEvidence` carries source manifest declarations only. Assay its published public contract and specialized consumer behavior before migration. Ranked candidates are paged (limit uncapped by default, offset default 0); candidateCount always reports the full unpaged total. detail (default false) keeps each candidate compact by capping its implementations/ownerEvidence arrays and reporting implementationCount for the true total — a broad, unscoped scan's full per-implementation detail is what can push its result past the tool's size limit; pass detail:true for the full per-implementation detail on an already-narrowed scope.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Optional package-name or package-path substring, such as sites or a domain name" },
        minimumBytes: { type: "number", description: "Ignore behavior implementations smaller than this many bytes; default 48" },
        limit: { type: "number", description: "Maximum ranked candidates returned; total candidateCount remains uncapped" },
        offset: { type: "number", description: "Ranked candidates to skip before applying limit; default 0. candidateCount is unaffected" },
        detail: { type: "boolean", description: "Return every implementation/ownerEvidence entry uncapped per candidate; default false (compact, capped, with implementationCount reporting the true total)" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    bind: (deps) => (args) => deps.duplication(args as JSNodeDuplicationFilter),
  },
  {
    name: "jsnode_duplication_migration",
    description:
      "Plan migrating one jsnode_duplication candidate (selected by exact fingerprint or a 1-based rank among its cross-package, consumer-backed candidates) onto a canonical owner: the owner's exported implementation, every non-owner site to replace with an import, and the manifest edits that wire the dependency. Every refusal — missing-selector (neither or both of fingerprint/rank given), no-owner, owner-not-exporting-fingerprint, owner-file-unreadable, site-in-owner-only, local-name-collision — comes back as a datum (in the plan's `refusals` array, or as this tool's own refusal datum for a bad selector), never a thrown error; a plan carrying any refusal has `applicable: false`. This tool only plans and never writes to disk — applying an `applicable` plan's AST edits is `--apply` on the jsnode-engineering-cli CLI's `duplication-migration` command, not offered over MCP.",
    inputSchema: {
      type: "object",
      properties: {
        fingerprint: { type: "string", description: "Exact semanticFingerprint of a jsnode_duplication candidate; exactly one of fingerprint or rank is required" },
        rank: { type: "number", description: "1-based rank among jsnode_duplication's cross-package, consumer-backed candidates; exactly one of fingerprint or rank is required" },
        owner: { type: "string", description: "Canonical package to migrate onto, overriding the candidate's own owner hint" },
        scope: { type: "string", description: "Optional package-name or package-path substring narrowing the duplication scan, as in jsnode_duplication" },
        minimumBytes: { type: "number", description: "Ignore behavior implementations smaller than this many bytes; default 48, as in jsnode_duplication" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    bind: (deps) => (args) => {
      const input = args as JSNodeDuplicationMigrationFilter;
      if ((input.fingerprint === undefined) === (input.rank === undefined)) {
        return { kind: "jsnode.duplication-migration.refusal", reason: "missing-selector", detail: "jsnode_duplication_migration needs exactly one of fingerprint or rank" };
      }
      return deps.duplicationMigration(input);
    },
  },
  {
    name: "jsnode_query",
    description:
      "Structured AND filter over indexed package.json records. Exact filters: scope and layer. Case-insensitive substrings: tag, name, description, pathContains. Direct dependency predicates: dependsOn and lacksDependency. `return` projects fields (default [\"name\"]; choices include path and dependencies). `packages` defaults to 50 rows while count remains the full match total.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Exact npm scope match, e.g. \"@561-group\" (including the @)" },
        layer: { type: "string", enum: ["lib", "apps", "services", "sites", "ops"], description: "Exact workspace layer match" },
        tag: { type: "string", description: "Case-insensitive substring matched against any keyword/tag" },
        name: { type: "string", description: "Case-insensitive substring matched against the package name" },
        description: { type: "string", description: "Case-insensitive substring matched against the package description" },
        pathContains: { type: "string", description: "Case-insensitive substring matched against the indexed workspace-relative package path" },
        dependsOn: { type: "string", description: "Exact direct package.json dependency name that must be declared" },
        lacksDependency: { type: "string", description: "Exact direct package.json dependency name that must not be declared" },
        return: {
          type: "array",
          items: { type: "string", enum: ["name", "version", "description", "layer", "scope", "path", "tags", "lifecycle", "maturity", "exports", "dependencies"] },
          description: "Fields to project per match; default [\"name\"]",
        },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum rows in `packages` (default 50); `count` is unaffected" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    bind: (deps) => (args) => deps.query(args as JSNodeQueryFilter),
  },
  {
    name: "jsnode_status",
    description:
      "Index freshness: packages/types/functions counts, the workspace root, lastRefreshedAt (ISO timestamp of the last manifest read, or null before the first refresh), and refreshIntervalSeconds (the configured periodic-refresh interval, or null if none is configured). Call this when staleness is suspected before trusting jsnode_package/jsnode_query results; call jsnode_refresh to force a fresh read.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    bind: (deps) => () => deps.status(),
  },
  {
    name: "jsnode_refresh",
    description:
      "Force an immediate re-read of package manifests and authored source declarations, invalidating every held index (search, atlas, typeflow, query, ...). Use after any change to package.json or source under the workspace root, instead of waiting for the periodic refresh or restarting the process. Returns the post-refresh jsnode_status payload.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: REFRESHES_INDEX,
    bind: (deps) => () => deps.refresh(),
  },
  {
    name: "jsnode_term",
    description:
      "Resolves a glossary term, concept, or topic by identity, frontmatter name, or alias across every glossary in the tree (content/text/glossary/{terms,concepts,topics} and the legacy-shaped content/glossary/{terms,concepts,topics}), excluding lib/legacy unless includeLegacy is set. Each hit carries path, kind (term|concept|topic), name, description, aliases, and admitted (the term-engineering recognizer's verdict and finding count; null when the recognizer refused to run over that carrier, e.g. a non-term concept/topic). The index is built once per refresh epoch, so the first call after a refresh may be slower than later ones.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The term's identity (filename stem), frontmatter name, or an alias, matched case-insensitively" },
        includeLegacy: { type: "boolean", description: "Include carriers under lib/legacy (default false)" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    bind: (deps) => (args) => deps.term(args as JSNodeTermLookup),
  },
  {
    name: "jsnode_section",
    description:
      "Finds *-services-section directories (excluding node_modules and lib/legacy), ranked by name and README first-paragraph matches. Returns the directory path and name, README first paragraph, child directory names, observed relative entries, and the parsed package.json object (null when absent, unreadable or invalid). Nested sections are indexed separately; directory location does not establish ownership or custody.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text words matched against section name words and the README's first paragraph" },
        limit: { type: "number", description: "Maximum ranked sections returned; default 10. count reports the full match total regardless of limit" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    bind: (deps) => (args) => deps.section(args as JSNodeSectionQuery),
  },
  {
    name: "jsnode_fabrication_records",
    description:
      "The jsnode fabrication line's own graph: Markdown work orders under any content/**/specifications/ directory and fabrication receipts under data/records/*fabrication-receipt.json, joined to the workspace package graph by each receipt's birthed packageName. Use this to see what the fabrication line has already produced before authoring a script by hand.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Maximum combined work orders and receipts walked; default covers the whole tree" } },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    bind: (deps) => (args) => deps.fabricationRecords((args as { limit?: number }).limit),
  },
] as const satisfies readonly JSNodeToolDefinition[];

/** Server-level orientation handed to the model on connect. */
export function jsnodeInstructions(name: string): string {
  return [
    `The ${name} workspace package graph, read off package.json manifests and authored JavaScript and TypeScript declarations. Read-only.`,
    "",
    "Two complementary views:",
    "- The package graph — packages and their workspace dependencies. Tools: jsnode_search, jsnode_package, jsnode_atlas, jsnode_domains, jsnode_analysis, jsnode_query.",
    "- Freshness — jsnode_status reports when the index was last read off disk (lastRefreshedAt) and the configured periodic-refresh interval; jsnode_refresh forces an immediate re-read after a publish or build.",
    "- The executable-behavior graph — normalized function/method bodies joined to packages and consumers. Tools: jsnode_duplication, jsnode_duplication_migration.",
    "- The type-flow category — types as objects, functions as morphisms. Tools: jsnode_typeflow, jsnode_typeflow_type, jsnode_types, jsnode_functions.",
    "- Corpus context discovery — jsnode_term resolves a glossary term/concept/topic by identity, name, or alias; jsnode_section finds and describes the *-services-section that owns a capability; jsnode_fabrication_records lists the fabrication line's own work orders and receipts, joined to packages.",
    "",
    "Typical workflow:",
    "1. jsnode_atlas for the whole-workspace overview by subject, or jsnode_search to find the package(s) that own a concept.",
    "2. jsnode_package for one package's dependencies and dependents.",
    "3. jsnode_typeflow_type to see what produces/consumes a type, and `to` for a pipeline between two types.",
    "4. jsnode_duplication is available when investigating repeated executable behavior; use jsnode_duplication_migration for an identified candidate.",
    "5. jsnode_query for a structured filter (scope/layer/tag/name/description, AND-combined) projected to chosen fields — e.g. every package tagged \"eavt\", by name.",
    "",
    "Type and function results include current definition coordinates and observed public import routes. Missing source type annotations stay unknown; no types are inferred.",
  ].join("\n");
}

type JSNodeToolName = (typeof JSNODE_TOOL_DEFINITIONS)[number]["name"];

function requiredType(id: string, description: string, schema: unknown): DataType {
  const admitted = defineType({ id, name: id, description, schema: schema as DataType["schema"], parents: [] });
  if (!admitted.ok) throw new TypeError(admitted.refusal.message);
  return admitted.value;
}

function jsnodeOperations(): readonly Operation[] {
  const operations: Operation[] = [];
  for (const tool of JSNODE_TOOL_DEFINITIONS) {
    const domain = requiredType(`jsnode-server:${tool.name}:input`, tool.description, tool.inputSchema);
    const codomain = requiredType(`jsnode-server:${tool.name}:output`, tool.description, true);
    const capability = `jsnode-server.mcp.${tool.name}`;
    const admitted = declareCapabilityOperation({
      id: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      domain,
      codomain,
      effects: [capability],
      capability,
    });
    if (!admitted.ok) throw new TypeError(admitted.refusal.message);
    operations.push(admitted.value);
  }
  return Object.freeze(operations);
}

const JSNODE_OPERATIONS = jsnodeOperations();
/** The admitted operation catalog supplies names, descriptions, and schemas;
 * MCP annotations remain transport metadata on that same declaration. */
export const JSNODE_TOOLS: readonly McpTool[] = Object.freeze(mcpToolsOfOperations(JSNODE_OPERATIONS).map(({ outputSchema: _unknownOutputSchema, ...tool }) => {
  const source = JSNODE_TOOL_DEFINITIONS.find((definition) => definition.name === tool.name);
  if (source === undefined) throw new TypeError(`missing JSNode MCP declaration for admitted operation: ${tool.name}`);
  return Object.freeze({ ...tool, ...(source.annotations === undefined ? {} : { annotations: source.annotations }) });
}));

/** Domain declarations and providers join the one platform registry. */
export function createJsnodePlatform(deps: JSNodeMcpDeps, providers: readonly CapabilityProvider[] = [], journal?: SearchJournalOptions) {
  return createComputerPlatform({ id: "jsnode-workspace", operations: JSNODE_OPERATIONS, providers: [
    ...providers,
    ...bindingsProviders(Object.fromEntries(JSNODE_TOOL_DEFINITIONS.map(definition => [`jsnode-server.mcp.${definition.name}`, journal ? journalOperation(definition.name, definition.bind(deps), journal) : definition.bind(deps)]))),
  ] });
}
