# computing-with-jsnode category map

This package should compute with the Node ecosystem by admitting Node-on-disk evidence into relational carriers, deriving readings from those carriers, and later emitting updated carrier state back to disk.

The package is not one coherent computer yet.
This map is the working inventory for preserving capability while removing false boundaries.

## Base

The base object is not `package.json`, TypeScript source, JSON-LD, SVG, a dependency graph, or a documentation report.

The base object is a JSNode relational carrier whose facts normalize to:

```text
domain evidence
-> relational carrier
-> Mark
-> Utterance
-> settled topology / derived reading
```

The persistent form is the Node ecosystem on disk: manifests, source files, declaration files, workspace strata, module imports, exports, bins, scripts, and eventually registry metadata.
Disk is the durable representation of the computer state, not the ontology.

## Layer Stack

### typing

Role: object fiber over JavaScript/TypeScript types.

Current capability:

- constructs `JsType` values;
- constructs `TypeCatalog`;
- reads assignability and type topology;
- reads workspace-wide attributed type indexes from built declarations.

Current defect:

- type evidence is still partly free strings;
- declaration reading lives beside topology but is not admitted as a boundary witness first;
- type identity is useful, but not yet visibly downstream of `Mark`/`Utterance`.

Target:

- type objects are admitted from declaration evidence;
- assignability is a derived closure over admitted type facts;
- no workspace layer should invent type facts.

### functions

Role: morphism fiber over typing.

Current capability:

- constructs `JsFn` morphisms;
- composes functions by typed slot;
- derives type-flow neighborhoods and shortest pipelines;
- derives package symbol graphs.

Current defect:

- functions are mostly declaration-derived free records;
- composition exists mathematically but is not tied to package/module admission;
- symbol graph and type-flow are readings, but live beside lower constructors.

Target:

- functions are morphisms between admitted type objects;
- type-flow is a derived reading over function utterances;
- update support can rewrite function documentation/source only through module/package boundaries.

### modules

Role: module boundary fiber: imports, exports, source symbols, and documentation surfaces.

Current capability:

- reads TS declaration surfaces;
- reads import demand surfaces;
- locates and edits JSDoc for symbols;
- computes consumption edges between packages.

Current defect:

- this is the biggest conceptual crossing: compiler reads, import reads, and doc editing are all boundary effects but are not represented as one module carrier;
- documentation functions are operationally useful but not yet strategies over a module carrier;
- consumption currently jumps from source scan to workspace reading without an explicit module object.

Target:

- module carrier admits export/import/source-symbol facts;
- doc edits become update strategies over the module carrier plus file boundary;
- consumption is derived from module import utterances, not a separate model.

### packages

Role: package carrier fiber.

Current capability:

- reads a package directory and manifest into `JSNodePackage`;
- admits parsed package manifest evidence into `JSNodePackage`;
- derives package terms, layer terms, lifecycle, maturity, manifest facts, dependency facts, API facts, and bin facts;
- checks package conformance;
- projects package bins as executable strategy boundaries;
- names package-bin strategy/session terms for the `stdio-eavt` computing action while preserving package-bin discovery.

Current defect:

- manifest parsing and carrier construction have begun to separate, but package manifest evidence is still plain boundary data before admission;
- conformance and scaffolding are useful boundary tools but not core package ontology;
- package-bin names strategy/session terms but does not yet inhabit a full `@emsenn/gaming` strategy carrier.

Target:

- manifest/file evidence is admitted at a package boundary;
- `JSNodePackage` is the central carrier for package facts;
- read, update, and write operations share the same admitted package-manifest evidence path;
- bin commands are strategies with declared carrier/session boundaries;
- conformance reads carriers and returns obstructions/findings, not loose findings over files.

### workspaces

Role: indexed family/sheaf of packages over repo strata.

Current capability:

- walks workspace strata;
- discovers packages;
- builds `JSNodeWorkspace`;
- derives internal dependency graphs, ego graphs, build order, domain/role catalogs, lifecycle, consistency, dependency drift, type indexes, consumption indexes, type flow, symbol flow, and spectra.

Current defect:

- this layer has too many analyses presented as peers;
- several readings compute from graphs or raw workspace data without naming the carrier map they preserve;
- workspace discovery is still an impure reader rather than an admission strategy.

Target:

- workspace admission produces an indexed package carrier;
- graph, domain, role, build, lifecycle, consistency, spectrum, demand, and supply are named readings over the workspace carrier;
- update support composes package/module update strategies and writes the persistent form back to disk.

### registries

Role: external package/registry fiber.

Current capability:

- none in this package.

Current defect:

- an empty public `registries` module was a false boundary.

Target:

- reintroduce only when external npm facts have carriers: package identity, version, dist-tags, tarball integrity, dependency ranges, provenance, vulnerability/deprecation facts, and registry fetch/write boundaries.

## Boundaries

### compute

Role: universal admission surface.

Current capability:

- admits action/token/claim calls for package read, workspace read, workspace graph read, package-bin discovery, and conformance check;
- returns charged admission or obstruction.

Current defect:

- read-side only;
- action names are boundary strings, not witnessed finite vocabulary;
- it delegates to old internal shapes instead of a single carrier-server model.

Target:

- this becomes the JSNode computer server core: read, update, and emit strategies over admitted carriers;
- every action is a witnessed finite move;
- every result is a charged reading or obstruction.

### codecs

Role: representation boundaries.

Current capability:

- RDF Turtle/JSON-LD for packages, workspaces, domains, roles, and type-flow;
- SVG renderings for dependency and symbol graphs;
- graph layout.

Current defect:

- representation code is not public now but still built as package internals;
- graph layout is a renderer concern, not JSNode ontology;
- codecs sometimes import broad topology surfaces.

Target:

- codecs remain boundaries over carriers/readings;
- no codec defines a JSNode object;
- only promoted if there is a public representation boundary with membership/witness law.

### content

Role: documentation/update boundary.

Current capability:

- deterministic README/AGENTS/CLAUDE/reference generation;
- documentation audit and coverage;
- source surface cultivation and symbol documentation flows.

Current defect:

- content tools are not integrated with module/package carriers;
- LLM/content operations are boundaries, not JSNode ontology;
- capability is valuable but currently placed as a side computer.

Target:

- documentation updates become strategies over module/package carriers and file persistence;
- content generation depends on admitted source/module/package readings;
- LLM output is boundary evidence that must be checked before admission.

### conformance

Role: audit boundary returning obstructions/findings over package carriers.

Current capability:

- package boundary/conformance checking;
- scaffolding.

Current defect:

- check logic reads files directly and reports findings before the package carrier boundary is clean;
- scaffold is a creation boundary, not analysis.

Target:

- checks consume admitted package/workspace carriers plus boundary evidence;
- findings normalize into charged obstructions;
- scaffolding becomes a write strategy with explicit session type.

## Current Capability Inventory

Keep these capabilities while consolidating:

- read package manifests and directories;
- classify package layer, lifecycle, maturity, manifest facts, dependencies, exports, bins, scripts, engines, repository, homepage, license, and privacy;
- construct package/workspace utterances and settle topology;
- discover workspaces across repo strata;
- derive dependency graphs and ego graphs;
- search packages;
- parse package coordinates into domain/role/qualifier;
- derive role and domain catalogs;
- derive build order, lifecycle, consistency, dependency drift, graph analysis, and spectra;
- inspect TS declarations into type/function catalogs;
- inspect imports into demand edges;
- derive type-flow, symbol graph, consumption, unused-export candidates, and resolved consumption edges;
- render RDF and SVG representations;
- audit package conformance and package boundaries;
- read and write JSDoc/doc surfaces;
- generate package documentation surfaces;
- discover package bins and project them as executable computing boundaries;
- expose a charged compute admission surface.

## Consolidation Rule

Do not delete a capability.
Move it only when its domain, codomain, and carrier descent identify the target layer.

Do not keep a module public or internal merely because it was historically convenient.
Keep it only if it is one of:

- carrier constructor;
- morphism/strategy;
- derived reading;
- boundary witness;
- finite vocabulary;
- obstruction/admission surface.

If a symbol is only a helper for one of those, it stays private to that object.
