/**
 * mcp — the JSNodeServer's Model Context Protocol surface.
 *
 * Owns the MCP contract (tool descriptors, `instructions`, `tools/call`
 * argument parsing); data comes from the service via `JSNodeMcpDeps`,
 * sharing its in-process indices — no round-trip, one cache, invalidated
 * by refresh(). Tools mirror the HTTP agent surface documented there.
 */
import type { McpDispatch, McpTool } from "@red-cup-engineering/http-server/server";

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

export interface JSNodeDuplicationFilter {
  readonly scope?: string;
  readonly minimumBytes?: number;
  readonly limit?: number;
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
  types(match: string): unknown;
  functions(taking: string | undefined, producing: string | undefined): unknown;
  domains(): unknown;
  query(filter: JSNodeQueryFilter): unknown;
  duplication(filter: JSNodeDuplicationFilter): unknown;
  /** Plans (never applies) migrating one jsnode_duplication candidate onto a
   *  canonical owner. Returns the plan JSON (`applicable`, `refusals`, ...);
   *  applying an `applicable` plan is `--apply` on the jsnode-computer CLI. */
  duplicationMigration(selector: JSNodeDuplicationMigrationFilter): unknown;
  /** The same freshness fields `/healthz` reports: packages/types/functions
   *  counts, root, `lastRefreshedAt`, and `refreshIntervalSeconds`. */
  status(): unknown;
  /** Re-reads manifests and built declarations now, invalidating every held
   *  index, and returns the post-refresh status payload. */
  refresh(): Promise<unknown>;
  /** Resolves a glossary term/concept/topic by identity, name, or alias
   *  across every glossary in the tree. */
  term(lookup: JSNodeTermLookup): unknown;
  /** Scores every `*-services-section` directory against a free-text query. */
  section(query: JSNodeSectionQuery): unknown;
  /** The fabrication work-order and receipt graph, joined to packages. */
  fabricationRecords(limit: number | undefined): unknown;
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false, destructiveHint: false } as const;
// Re-reads the filesystem and rebuilds in-process caches; idempotent and
// local-only, so not destructive, but not a pure read either.
const REFRESHES_INDEX = { readOnlyHint: false, openWorldHint: false, destructiveHint: false } as const;

export const JSNODE_TOOLS: readonly McpTool[] = [
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
  },
  {
    name: "jsnode_package",
    description:
      "The full record for one workspace package by exact name (e.g. @red-cup-engineering/jsnode-computer): its description, layer, tags, coordinate, and its dependencies and dependents within the workspace.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Exact package name" } },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "jsnode_atlas",
    description:
      "The domain atlas: the workspace browsed by subject. Each domain with its representative description, role coverage, and import degree — the best whole-workspace overview.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "jsnode_domains",
    description:
      "The domain quotient: the dependency graph contracted to subjects (which subject areas depend on which). The bird's-eye dependency structure.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "jsnode_analysis",
    description:
      "The geometry of the dependency graph: connected components, acyclicity/cycles, distance (diameter/radius/centre), and per-package centrality and strata.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "jsnode_typeflow",
    description:
      "The type-flow category: types as objects and functions as morphisms, with composition (codomain meets domain) made explicit — the hub types, sources, and sinks across the built workspace. Building the index runs the TypeScript compiler over every package's declarations, so the first call may be slow; it is then cached.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
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
  },
  {
    name: "jsnode_types",
    description:
      "Attributed types across the built workspace, optionally filtered to those whose name contains a substring. Each type is attributed to the package that declares it.",
    inputSchema: {
      type: "object",
      properties: { match: { type: "string", description: "Optional case-insensitive substring of the type name" } },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "jsnode_functions",
    description:
      "Attributed functions across the built workspace, optionally filtered by a type in their domain (`taking`) and/or their codomain (`producing`). Find the functions that move you between two types.",
    inputSchema: {
      type: "object",
      properties: {
        taking: { type: "string", description: "Optional: substring of a parameter type" },
        producing: { type: "string", description: "Optional: substring of the return type" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "jsnode_duplication",
    description:
      "Find repeated executable behavior by normalized TypeScript AST, ranked by removable source bytes and real package consumers. Local names and literal policy values may vary; encoding direction, invoked APIs, and control flow must match. Generated carriers and physical package/file replicas are excluded. `owner` is a hint, never proof of a usable public contract by itself: `ownerBasis` names whether it came from an existing dependency edge (\"dependency-graph\") or from the org-layering law naming the sole computer-data/code/networking-seated package with no edge required (\"layering-law\"); `ownerEvidence` carries source manifest declarations only. Assay its published public contract and specialized consumer behavior before migration. Use this before manual semantic-dedup searches or agent dispatch.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Optional package-name or package-path substring, such as sites or a domain name" },
        minimumBytes: { type: "number", description: "Ignore behavior implementations smaller than this many bytes; default 48" },
        limit: { type: "number", description: "Maximum ranked candidates returned; total candidateCount remains uncapped" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "jsnode_duplication_migration",
    description:
      "Plan migrating one jsnode_duplication candidate (selected by exact fingerprint or a 1-based rank among its cross-package, consumer-backed candidates) onto a canonical owner: the owner's exported implementation, every non-owner site to replace with an import, and the manifest edits that wire the dependency. Every refusal — missing-selector (neither or both of fingerprint/rank given), no-owner, owner-not-exporting-fingerprint, owner-file-unreadable, site-in-owner-only, local-name-collision — comes back as a datum (in the plan's `refusals` array, or as this tool's own refusal datum for a bad selector), never a thrown error; a plan carrying any refusal has `applicable: false`. This tool only plans and never writes to disk — applying an `applicable` plan's AST edits is `--apply` on the jsnode-computer CLI's `duplication-migration` command, not offered over MCP.",
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
  },
  {
    name: "jsnode_query",
    description:
      "Structured filter query over the package graph (quasi-SPARQL: pick a WHERE clause and a SELECT list). Filters combine as AND, each optional: scope (exact npm scope, e.g. \"@561-group\"), layer (exact: lib|apps|services|sites|ops), tag (case-insensitive substring against a package's keywords/tags), name (case-insensitive substring), description (case-insensitive substring). `return` projects each match to the named fields (default [\"name\"]; choices: name, version, description, layer, scope, tags, lifecycle, maturity, exports, dependencies). `limit` caps the returned `packages` array; `count` always reports the full match total regardless of `limit`. Example — every package whose keywords contain \"eavt\", by name: { tag: \"eavt\" }.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Exact npm scope match, e.g. \"@561-group\" (including the @)" },
        layer: { type: "string", enum: ["lib", "apps", "services", "sites", "ops"], description: "Exact workspace layer match" },
        tag: { type: "string", description: "Case-insensitive substring matched against any keyword/tag" },
        name: { type: "string", description: "Case-insensitive substring matched against the package name" },
        description: { type: "string", description: "Case-insensitive substring matched against the package description" },
        return: {
          type: "array",
          items: { type: "string", enum: ["name", "version", "description", "layer", "scope", "tags", "lifecycle", "maturity", "exports", "dependencies"] },
          description: "Fields to project per match; default [\"name\"]",
        },
        limit: { type: "number", description: "Maximum number of matches to include in `packages`; `count` is unaffected" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "jsnode_status",
    description:
      "Index freshness: packages/types/functions counts, the workspace root, lastRefreshedAt (ISO timestamp of the last manifest read, or null before the first refresh), and refreshIntervalSeconds (the configured periodic-refresh interval, or null if none is configured). Call this when staleness is suspected before trusting jsnode_package/jsnode_query results; call jsnode_refresh to force a fresh read.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "jsnode_refresh",
    description:
      "Force an immediate re-read of package manifests and built declarations, invalidating every held index (search, atlas, typeflow, query, ...). Use after a publish, a build, or any change to package.json/dist under the workspace root, instead of waiting for the periodic refresh or restarting the process. Returns the post-refresh jsnode_status payload.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: REFRESHES_INDEX,
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
  },
  {
    name: "jsnode_section",
    description:
      "Walks the section taxonomy: every *-services-section directory (not node_modules, not lib/legacy), scored by name match and README first-paragraph match against the query's words. Answers which section owns a capability and what that section looks like: path, name, custody (the top ancestor directly under lib/emsenn/services/561-group/services/), README first paragraph, direct children names, and the section form record (ServicesSectionForm: readme/package/content/code/data/services/legacy/stray/laws) folded from the section's own entries and package.json.",
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
  },
];

/** Server-level orientation handed to the model on connect. */
export function jsnodeInstructions(name: string): string {
  return [
    `The ${name} workspace package graph, read off package.json manifests and built TypeScript declarations. Read-only.`,
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
    "4. jsnode_duplication before semantic-dedup work; inspect its highest-removable-byte consumer-backed candidates, then jsnode_duplication_migration for the ranked candidate before dispatching implementation lots.",
    "5. jsnode_query for a structured filter (scope/layer/tag/name/description, AND-combined) projected to chosen fields — e.g. every package tagged \"eavt\", by name.",
    "",
    "The type-flow tools read built declarations; a package that has never been built contributes no types.",
  ].join("\n");
}

function requireString(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing required string argument: ${key}`);
  }
  return value;
}

function optionalString(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringArray(args: Readonly<Record<string, unknown>>, key: string): readonly string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    throw new Error(`argument must be an array of strings: ${key}`);
  }
  return value;
}

function optionalBoolean(args: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`argument must be a boolean: ${key}`);
  return value;
}

function optionalNumber(args: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`argument must be a number: ${key}`);
  }
  return value;
}

/** Route a `tools/call` to the in-process data accessors. */
export function jsnodeDispatch(deps: JSNodeMcpDeps): McpDispatch {
  return async (name, args) => {
    switch (name) {
      case "jsnode_search": {
        const query = requireString(args, "query");
        const limit = optionalNumber(args, "limit");
        const offset = optionalNumber(args, "offset");
        const detail = optionalBoolean(args, "detail");
        return deps.search({
          query,
          ...(limit !== undefined ? { limit } : {}),
          ...(offset !== undefined ? { offset } : {}),
          ...(detail !== undefined ? { detail } : {}),
        });
      }
      case "jsnode_package": {
        const pkgName = requireString(args, "name");
        const record = deps.package(pkgName);
        if (record === undefined) throw new Error(`package not found: ${pkgName}`);
        return record;
      }
      case "jsnode_atlas":
        return deps.atlas();
      case "jsnode_domains":
        return deps.domains();
      case "jsnode_analysis":
        return deps.analysis();
      case "jsnode_typeflow":
        return deps.typeFlow();
      case "jsnode_typeflow_type": {
        const type = requireString(args, "type");
        const record = deps.typeFlowType(type, optionalString(args, "to"));
        if (record === undefined) throw new Error(`type not addressable in the flow: ${type}`);
        return record;
      }
      case "jsnode_types":
        return deps.types(optionalString(args, "match") ?? "");
      case "jsnode_functions":
        return deps.functions(optionalString(args, "taking"), optionalString(args, "producing"));
      case "jsnode_duplication": {
        const scope = optionalString(args, "scope");
        const minimumBytes = optionalNumber(args, "minimumBytes");
        const limit = optionalNumber(args, "limit");
        return deps.duplication({
          ...(scope !== undefined ? { scope } : {}),
          ...(minimumBytes !== undefined ? { minimumBytes } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
      }
      case "jsnode_duplication_migration": {
        const fingerprint = optionalString(args, "fingerprint");
        const rank = optionalNumber(args, "rank");
        if ((fingerprint === undefined) === (rank === undefined)) {
          return {
            kind: "jsnode.duplication-migration.refusal",
            reason: "missing-selector",
            detail: "jsnode_duplication_migration needs exactly one of fingerprint or rank",
          };
        }
        const owner = optionalString(args, "owner");
        const scope = optionalString(args, "scope");
        const minimumBytes = optionalNumber(args, "minimumBytes");
        return deps.duplicationMigration({
          ...(fingerprint !== undefined ? { fingerprint } : {}),
          ...(rank !== undefined ? { rank } : {}),
          ...(owner !== undefined ? { owner } : {}),
          ...(scope !== undefined ? { scope } : {}),
          ...(minimumBytes !== undefined ? { minimumBytes } : {}),
        });
      }
      case "jsnode_query": {
        const scope = optionalString(args, "scope");
        const layer = optionalString(args, "layer");
        const tag = optionalString(args, "tag");
        const pkgName = optionalString(args, "name");
        const description = optionalString(args, "description");
        const fields = optionalStringArray(args, "return");
        const limit = optionalNumber(args, "limit");
        return deps.query({
          ...(scope !== undefined ? { scope } : {}),
          ...(layer !== undefined ? { layer } : {}),
          ...(tag !== undefined ? { tag } : {}),
          ...(pkgName !== undefined ? { name: pkgName } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(fields !== undefined ? { return: fields } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
      }
      case "jsnode_status":
        return deps.status();
      case "jsnode_refresh":
        return await deps.refresh();
      case "jsnode_term": {
        const name = requireString(args, "name");
        const includeLegacy = optionalBoolean(args, "includeLegacy");
        return deps.term({ name, ...(includeLegacy !== undefined ? { includeLegacy } : {}) });
      }
      case "jsnode_section": {
        const query = requireString(args, "query");
        const limit = optionalNumber(args, "limit");
        return deps.section({ query, ...(limit !== undefined ? { limit } : {}) });
      }
      case "jsnode_fabrication_records":
        return deps.fabricationRecords(optionalNumber(args, "limit"));
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  };
}
