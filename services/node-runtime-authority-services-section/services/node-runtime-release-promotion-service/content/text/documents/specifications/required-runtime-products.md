# Required runtime products

Owner: `@red-cup-engineering/node-runtime-release-promotion-service`.
Status: proposed native-generation contract for source integration; implementation and supplier migration are received together before production adoption.

## Governing sources

- [HouseArchitectureNorms, Code 32a793ab](https://github.com/red-cup-engineering/computer-code-engineering-services-section/blob/32a793ab655b354f8acaaca0bc0ef8a5c22c1047/services/javascript-engineering-services-section/services/javascript-node-services-section/data/records/house-architecture-norms.json), blob `3f8d1689b341e9d99b3e5d42d30ada1d6cec5cab`: authored plain JavaScript, source publication, owned capabilities and explicit import contracts.
- [LAGOON architecture, Computer Engineering b11c4098](https://github.com/red-cup-engineering/computer-engineering-services-section/blob/b11c409892d03007e314b68adf092c45d1720080/services/computer-systems-engineering-services-section/services/computer-operating-system-services-section/apps/computer-deployment-engine/content/text/documents/articles/notes/2026/08/29/2026-08-29-lagoon-architecture.md), blob `3a0a9d2b86aeb44e1d9624c4601ab26c927d4fce`: the section “Production composition and migration — revised 2026-10-14” governs the recursive native source, registry supply, necessary generation and sole LAGOON/ordinary Guix deployment ownership.

## Purpose and inputs

Fabricate the common runtime from one recorded recursive source hierarchy, its authoritative root PNPM lock and the workspace's existing registry/build policy. The caller supplies the runtime consumer and its owner-qualified entry and asset declarations. The result supplies ordinary native packing and LAGOON's Guix construction.

Inputs are:

- the source root, its recorded Git commit and recursive Gitlink revisions;
- the actual PNPM workspace membership and frozen native lock;
- the source-owned runtime entry, publication and delivered-asset declarations;
- each reached product owner's declaration, authored inputs and producer programme;
- the actual installed compiler or module supplier bindings selected by that source;
- explicit producer parameters, including a publication instant only where the product contract requires one.

The same selected source and consumer declarations govern source assessment, generation and packed receiving. Later upstream owner revisions are changes to that composition and receive their affected contracts and lock together.

## Requirements

R1. Every required generated path has exactly one owning producer. Its authored input set and complete output set are explicit before producer execution.

R2. Required generation follows actual consumer paths. Trace runtime modules, relevant published entrances and delivered assets to their producer. A build-script string alone establishes no production demand. Each refusal identifies the owning consumer, source path and unresolved edge.

R3. Planning completes before importing a producer or writing output. Missing inputs, ambiguous owners, overlapping output paths, committed-source collisions and producer cycles refuse the plan. Authored source import cycles remain lawful.

R4. A producer's complete output set is one construction unit. Dependency-first order is deterministic and each selected producer runs once. Generated prerequisites are admitted only after their producing unit completes and their current bytes match its result.

R5. Planning and execution bind the same actual supplier instance and bytes. Package name/version, a first matching installation or a previously cached module is insufficient evidence. Distinct installations retain their dependency contexts.

R6. Native source and lock remain unchanged throughout realization. The existing committed-source reader authenticates authored inputs and confines outputs. Each emitted file belongs to the planned set, and every planned file is present before packing can proceed.

R7. Scope comes from actual owner declarations. Machine programmes, auxiliary services and prechecks, commands, active-role instance modules and jobs contribute their native projections. Delivered non-JavaScript assets receive path/format checks appropriate to their owners. Inactive actor declarations do not start worker factories or acquire operational authority.

R8. Useful functions and semantic contracts survive migrations. Current source normalization favors plain JavaScript and source publication. Selected legacy compiler products are explicit transition obligations, with a concrete consumer and owner-managed migration, rather than a permanent TypeScript enrollment inferred from scripts.

R9. Actual outputs, native packed files and useful consumers discharge their respective requirements. Pure graph tests establish planning properties; they do not establish compiler execution, complete packing, Guix realization or operation.

## Analysis and architecture decisions

### One aggregate realization owner

`generateWorkspaceArtifacts` is the public aggregate. Its source-reader, declaration reader, graph planning and emitter components form one required path. `generateWorkspaceTypeScript` remains a compatibility entrance only insofar as it delegates the same admitted product semantics. The native caller consumes one aggregate result before packing.

Use the existing JavaScript resolver/module corpus for authored JavaScript and its existing immutable programme facility where the actual producer qualifies. Resolve selected TypeScript obligations through owned plain-JavaScript or schema migrations and exact consumer replacement. When the current adoption sequence requires an existing compiler transition, reuse that compiler's own configuration/program resolution for a bounded, explicitly temporary step. This increment introduces no enduring TypeScript planning subsystem. The graph contains authored source vertices and atomic producer vertices; a producer edge records which unfinished product it needs and the source chain that demands it.

A source-only strongly connected component is legal. A cycle containing a producer prerequisite is an incomplete construction and is reported with its concrete cycle. Package-manifest dependency cycles alone neither prove nor disprove a product cycle.

### Declaration ownership

Product declarations live with their owning package. Portable inputs are owner-relative paths or explicit package/path coordinates resolved through the admitted source catalogue. Producer source, declaration files and recursively demanded helpers are authenticated parts of the plan. Generated products remain separate from committed authored input.

The module declaration evolves the existing `nodeRuntimeGeneration` contract by declaring `kind: module` and `inputs` alongside its existing `module`, `export` and `outputs`. All existing producers migrate in the same coherent source composition. Module exports continue returning the complete `{files: [{path, text}]}` set to the Code writer. They receive explicit source and owner roots, authenticated declared input reading and declared parameters.

An explicitly temporary existing compiler transition records its configuration, required inputs, actual output mapping and concrete consumer obligation. Its owner identifies the plain-JavaScript or schema replacement and the adoption step that removes the transition. The actual compiler resolves source/type inputs without importing an unfinished runtime; its mapping covers each required consumer path. New durable producer contracts are developed in the house's plain-JavaScript/schema form. Internal dist paths may change or disappear when every actual consumer and public interface is coherently replaced and received.

### Supplier identity

The resolver owns the mapping from each request and resolution mode to the actual file, package root, manifest and source identity. The existing module-closure owner exposes or verifies the same binding during capture and execution. Preserve distinct same-name/version instances and all import edges. The fabricator compares actual binding records; it does not infer origins by trimming printable instance suffixes.

Compiler suppliers receive the same treatment. Their real loading semantics must pass qualification, including any supported CommonJS imports, before adopting an execution mechanism. Runtime output cannot be silently substituted for the authored source and installed supplier admitted by the plan.

Installed package scope stops at the nearest package directory even when that
directory lacks `package.json`; it must not search onward for a different
supplier. This is Node 24's `getPackageJSONURL` directory-selection rule. The
shared JavaScript module-closure resolver supplies this selection to both
programme capture and Code's static compiler before esbuild inspects symbols.
An incomplete nearby scope remains an unresolved interface. Reading and resolving
source does not execute the application or establish a complete fabrication.

### Runtime declarations and generated descriptors

An operation's declaration belongs to its actual provider, separately from its effectful implementation. Runtime construction and descriptor aggregation consume the same independent declaration modules or schema inputs. MetroPlat owns the composition and its public family names; the supplying packages retain their schemas and operation contracts.

For the existing MetroPlat descriptor migration, preserve every current family and operation field, including domain, codomain, refusal/authority information, references, effects and descriptions. The existing tracked generated snapshot is a compatibility witness. Independently relate each extracted declaration to its authored owner and compare complete descriptors, then receive runtime construction against those declarations with operational ports denied.

A context-dependent contract takes a declared typed parameter and a source-owned derivation. Once the complete migration is received, the descriptor product replaces its tracked generated counterpart at the existing consumer path and joins generic generation. Remove the caller's separate descriptor-generation phase in the same adoption. Committed-source collision protection remains in force.

## Component contracts

### Source and consumer projection

Input: native root and consumer/target declarations. Analysis: use `readNodeWorkspace`, exact committed manifests and the existing owners' parsing/projection rules. Output: owner-qualified source roots and asset obligations with their declaring source paths. Check: every root maps uniquely into the admitted hierarchy; actual actor/worker role selection is preserved. Continuation: read reached producer declarations and source dependencies.

### Declaration and input resolution

Input: reached paths, owned product declarations and actual resolver/compiler bindings. Analysis: classify each path as admitted authored source, declared product or unresolved interface, preserving dependency and resolution mode. Output: a finite source/product relation plus exact owner/supplier records. Check: canonical confined paths, unique named source owners, disjoint authored and generated paths, complete explicit input/output sets. Continuation: determine required producer closure and order.

### Required product planning

Input: consumer roots and resolved source/product relation. Analysis: follow source edges and producer inputs; include every output of a selected atomic producer; compute producer prerequisites. Output: deterministic dependency-first producer schedule, required product set and traceable source obligations. Check: missing/ambiguous bindings, duplicate writers and producer cycles refuse before emission. Continuation: realize the admitted schedule.

### Realization and output receiving

Input: complete schedule, unchanged admitted source and actual supplier bindings. Analysis: reverify inputs; execute each producer through its qualified owner mechanism; validate the complete returned or compiler-reported output set. Output: actual generated bytes with their producer, input and supplier identities. Check: source/lock unchanged, supplier binding unchanged, prerequisite bytes unchanged, no undeclared or missing outputs and no committed-source overwrite. A failed producer prevents its consumers and native packing. Continuation: ordinary native pack followed by existing static and declared package receiving.

## Current adoption obligations

The runtime caller's present explicit entry list is the first shared source/packed projection. Its owner completes target/role/asset coverage using native declarations rather than a separate hand-maintained inventory.

Content Mill's five authored newsroom schemas produce one plain-JavaScript carriers module through the existing Code schema renderer. The current module declaration and real schema-to-carrier receiving remain usable while its explicit input declaration is migrated with the aggregate. Its development renderer stays outside the packed runtime.

Ethereum's current four-contract product proposal binds ArticulationCell, Articulating, Mark and Utterance JSON outputs to their authored Solidity selections. The compilation declaration, owning package manifest and four source files are genuine producer inputs. Qualify the compiler selected by the actual producer and receive ABI/bytecode consumers without chain operation.

For each selected legacy compiler output, preserve its exact publication or runtime consumer edge while comparing the current owner's migration. A newer plain-source contract replaces the old product only when the changed owner and its consumers are received coherently. The source-owned migration boundaries already identified are:

- Data TOML: preserve encode/decode behavior used directly by Markdown read, dump and mutate-frontmatter consumers, replacing the root dist entrance with an owned plain-JavaScript contract.
- Data JSON Schema: receive the published root and census command independently from the existing authored-JavaScript contracts and validation subpaths. A package dependency on JSON Schema does not prove that a specific consumer needs its compiled root.
- Data HTML document rendering, file cryptographic integrity, file projection kernel and HTML/JSON/XML codecs: migrate the actual value imports and public re-exports together. Preserve digest/HMAC, projection, escaping/rendering and JSON/JSONL/EAVT interfaces through their own contract tests.
- Data YAML codec: establish an actual runtime/publication consumer before retaining its compiled product. Markdown's authored-JavaScript YAML-frontmatter provider is a different owner.
- Web computing-with-the-web, computing-with-http, http-edge, http-server-core and web-mesh: migrate their declared protocol/theming/policy interfaces and intra-owner imports as one coherent source change when consumer demand is established.
- Semiotic-system witness-journal-coherence: preserve its actual exported journal/coherence boundary and exact source layout when replacing the compiler product.

The inspected partial package graph establishes a lower bound of JSON Schema and TOML reachability, with additional supplier owners unresolved. Package reachability, a published interface and active-role import reachability are recorded separately. Source-contract migration proceeds from the proved consumer edges; unscanned owners remain explicit completion work.

MetroPlat's operation-family declarations, complete descriptor equivalence and tracked-product migration precede removal of its dedicated caller phase. These source changes must preserve actor-only suppression and worker capabilities.

## Receiving and continuation

1. Receive the exact consumer/product inventory and owner migration decisions.
2. Receive all migrated declarations and actual supplier/compile input resolution.
3. Exercise the single aggregate against real module and compiler fixtures, including cross-kind prerequisites, same-version distinct suppliers, import/source cycles, producer cycles, changed inputs, incomplete outputs and committed collisions.
4. Receive complete MetroPlat field preservation and non-effect declaration construction.
5. Run frozen installation, actual generation, native packing and source/packed receiving on one coherent selected composition. Preserve failed and unrun stages explicitly.
6. Supply the received runtime to LAGOON for ordinary Guix construction and the existing authorized deployment path. Actual service effects and compatible durable state complete deployment acceptance.

This specification defines the next required implementation and its receiving gates. An unresolved owner contract keeps its dependent adoption open; it is not converted into a fabricated product or a successful build result.
