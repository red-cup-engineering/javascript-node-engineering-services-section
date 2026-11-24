# 2026-06-16: Improving the JSNode computer

## Why this note exists

This is a study note before implementation.
The package is now named `@emsenn/computing-with-jsnode`, but much of its shape still comes from the older `jsnode` consolidation: it gathered useful workspace, analysis, documentation, and TypeScript-introspection tools into one package.
That consolidation was correct as a rescue operation, but the repository's current mathematical rules ask for a stronger reading:

- a package is a category, not a namespace bag;
- modules are objects, subcategories, morphism families, or representation boundaries;
- every exported function must have a domain, codomain, and law;
- public records must descend to relational carriers;
- boundary forms such as files, JSON, CLI output, RDF, HTML, and HTTP are witnesses or transports, not ontology;
- composable scripts are concurrent-game strategies, and shell pipes are cut.

So the question is not "how do we make the jsnode utilities nicer?"
The question is: what is the JS Node package ecosystem when read as a computer, and what should this package export when it takes that seriously?

I read the root repository invariant, the root dev notes on Mark-to-settling, category-theoretic Node packaging, library verbs as CGS strategies, and the ontological spine note.
I then read `@emsenn/computing` and `@emsenn/computing-with-jsnode` against those rules.
This entry is the result.

## The invariant I must not forget

The repository invariant is stricter than "prefer relational data models."
It says every core data structure must reduce to configurations of `Mark`s in `Utterance`s.
The normal path is:

```text
domain value
-> relational carrier
-> Mark
-> Utterance
-> settled topology / derived reading
```

A JSON shape, DTO, CLI result, or API payload is unfinished until it is shown to be a projection of carriers and able to normalize back to those carriers.

For JSNode work, this means:

- `package.json` is not ontology.
  It is a boundary document.
- a parsed manifest object is not ontology.
  It is a boundary read.
- a package graph is not primitive.
  It is a reading of package utterances.
- an import graph is not primitive.
  It is demand-side utterances settling against provider-side terms.
- a type-flow graph is not primitive.
  It is a derived category over API-surface type and function carriers.
- a package binary is not "a command string."
  It is a strategy boundary admitted from `package.json#bin` and projected into utterances.

The good news is that `computing-with-jsnode` already contains much of this floor.
The bad news is that its public shape does not yet consistently teach the floor.
Some modules are categorical; the package root and `./compute` are still mostly discovery barrels.

## The category-theoretic packaging rule applied to this package

The root dev note "Category-Theoretic Node Package Modularization Rules" says:

- package = category;
- top-level modules = objects or subcategories;
- exports = commitments;
- functions = morphisms;
- constructors admit; readers derive;
- root import = universal call surface;
- codecs are the only free-data gates;
- public classes are carriers or witnesses;
- morphisms normalize to the base morphism.

For `@emsenn/computing-with-jsnode`, the package category should be something like:

```text
ComputingWithJSNode
  objects:
    Node package carriers
    workspace carriers
    JavaScript type/function carriers
    package-bin strategy carriers
    host-js platform carriers
    package reduction/control carriers

  morphisms:
    manifest admission -> JSNodePackage
    workspace discovery -> JSNodeWorkspace
    package/workspace utterances -> JSNodeTopologyCarrier
    topology carrier -> dependency graph reading
    workspace type index -> type-flow category
    package bin manifest -> PackageBinCarrier
    package bin carrier -> stdio/EAVT strategy boundary
    package reduction -> charged findings

  representation boundaries:
    package.json
    filesystem workspace walk
    TypeScript compiler API introspection
    CLI scripts
    RDF / JSON-LD / SVG / Markdown renderers
```

That map is not fully expressed today.
The subpaths mostly line up, but the root does not yet provide a root admission/call surface analogous to `@emsenn/computing`'s `compute(action, token, ?claim)`.

Today the root is:

```ts
export * as analysis from "./analysis/index.mjs";
export * as conformance from "./conformance/index.mjs";
export * as topology from "./topology/index.mjs";
export * as codecs from "./codecs/index.mjs";
export * as compute from "./compute/index.mjs";
export * as content from "./content/index.mjs";
export * as javascript from "./javascript/index.mjs";
export * as packageBin from "./package-bin/index.mjs";
export * as workspace from "./workspace/index.mjs";
```

That is useful for discoverability, but by the current rules it is a namespace bag.
It names subcategories, but it does not itself admit a computation.
The root should eventually expose the universal JSNode computer call shape.
The barrel can stay as a convenience only if it is secondary to the root morphism.

## What `@emsenn/computing` teaches

`@emsenn/computing` is the local reference for how a computing package should read.
Its package description is dense but exact:

```text
relating -> animating -> gaming -> computing
```

The `computing` package makes CGS operate.
Its subpaths are not arbitrary:

- `./category` is the executable *-autonomous category of CGS: arenas as objects, strategies as morphisms, tensor, dual, par, lollipop, copycat, composition by interaction-plus-hiding, `!
  `, `?
  `, trace, and law witnesses.
- `./cartesian` is the Kleisli sub-CCC over `!
  `, where duplicable typed programs live.
- `./paradigm` gives the four computing paradigms as real subcategories: sequential, nominal, dialectica, and session.
- `./computer` is the running concurrent computer: settled information -> observation -> arena -> strategy -> move.
- `./codecs` are charge-faithful representation boundaries.
- the root exposes `compute(action, token, claim?)
  `, not a pile of exports.

The root function is especially important.
It takes boundary-shaped inputs, but immediately admits or refuses them through existing carriers:

- `observe` reads labeled settled memes into a CGS observation;
- `run` executes one admitted Opponent move against a modeled Player morphism;
- successful admissions are charged with `witnessedPotential`;
- refusals are negated charged obstructions.

That is the model `computing-with-jsnode` should learn from.
It should not invent a new "computer" class.
It should expose a root morphism that admits JSNode operations into the existing carrier path and returns charged admissions or obstructions.

## The spine: why JSNode is downstream of computing

The ontological spine note derives:

```text
relating -> animating -> gaming -> computing -> product/domain computers
```

Relating gives settled bilattice relations.
Animating gives self-modeling agency.
Gaming gives interaction between agents as CGS.
Computing adds the exponential closure, where duplicable programs live.

JSNode is not below that spine.
JSNode is a domain computer inside computing.
A Node package is not merely a folder.
It is a finite public strategy surface:

- it publishes callable morphisms through exports;
- it publishes executable strategies through `bin`;
- it consumes other strategies through imports and dependencies;
- it participates in a workspace category through dependency edges;
- it can be composed with other packages through TypeScript types, module imports, and process protocols.

In other words, JSNode is one concrete computing ecology: the ecosystem where the "programs" are Node packages, their published symbols, their executables, their type surfaces, and their workspace dependency relations.

## The current JSNode carrier floor

The best part of the current package is `./topology`.

`JSNodePackage` is already a real carrier.
Its input is ordinary package metadata, but `jsNodePackage()` normalizes that metadata into utterances:

- package in layer;
- package has tag;
- package has export;
- package depends on package;
- package has version;
- package has description;
- package has lifecycle;
- package has maturity;
- package has license;
- package has private flag;
- package has module type;
- package has engines;
- package has scripts;
- package has bins;
- dependency declaration has range;
- dependency declaration has kind;
- package has type;
- package has function;
- function has domain;
- function has codomain;
- subtype specializes supertype.

The carrier keeps a convenient read surface, but the important fact is that the read surface is backed by `utterances`.
`JSNodeWorkspace` then aggregates package utterances.
`induceWorkspaceTopology()` settles them through `induce()`.

That is the proper relational descent:

```text
package.json / dist declarations
-> JSNodePackageInput
-> JSNodePackage
-> UtteranceCarrier[]
-> JSNodeWorkspace
-> JSNodeTopologyCarrier
-> graph, analysis, RDF, docs, package reductions
```

This means `computing-with-jsnode` does not need a new floor.
It needs a more explicit categorical reading of the floor it already has.

## Package manifests as boundary documents

`./workspace` is the filesystem boundary.
It walks `lib`, `apps`, `services`, `sites`, and `ops`, reads `package.json`, classifies package layer from path, extracts manifest facts, optionally introspects built declarations, and admits the result through `jsNodePackage()`.

This is the correct direction.
The filesystem is not the package category.
The filesystem is a boundary that gives evidence.
The actual package is the carrier.

The package currently says this in several comments, but the module structure should make it unavoidable:

```text
filesystem package.json
-> manifest boundary read
-> JSNodePackage carrier
-> utterance log
-> settled workspace topology
```

The same applies to TypeScript declaration reading.
`workspaceTypeIndex()` is an impure representation boundary over built declaration files.
It produces an attributed index, but the index is not final ontology.
Its role is to support type/category readings and to enrich package carriers with API-surface utterances.

## The JavaScript type category

`./javascript/algebra` already names the pure JavaScript type category:

- `JsType` objects;
- `JsFn` morphisms;
- `TypeCatalog` as the carrier of objects, morphisms, and subtype edges;
- `composableAt()` and `composeAt()` as operadic composition;
- `directlyAssignable()` as the declared one-step subtype relation.

`./javascript/topology` then settles subtype edges to reflexive-transitive assignability and derives section reads:

- functions accepting a type;
- functions producing a type;
- types reachable from seeds under operadic application.

This is exactly the category-theoretic direction we want: algebra first, topology/closure second, readings third.

The package-wide type-flow analysis extends this from one catalog to the whole workspace.
`workspaceTypeFlow()` turns the workspace type index into a category of addressable types and function edges.
A function that takes `A` and produces `B` becomes a composition edge `A -> B`.
This is a crucial JSNode-computer reading because it lets the repository ask:

```text
what can we turn this carrier into, using the functions currently exported by
our package ecology?
```

That is not "documentation analysis."
It is a program-search surface over the workspace as a category.

## Dependency graph versus type-flow category

The dependency graph and the type-flow graph are different readings.

The dependency graph says:

```text
package A imports package B at runtime
```

That is a coarse arena of package-to-package dependency.
Its geometry tells us components, cycles, height, centrality, build order, lifecycle debt, and domain or role quotient structure.

The type-flow category says:

```text
some exported function consumes carrier A and produces carrier B
```

That is closer to actual computation.
It is the category where morphisms are exported functions and composition is type compatibility.

Both descend from the same package carriers, but they answer different questions:

- dependency graph: "which packages must be present for this one to run?"
- type-flow category: "which exported morphisms can transform this carrier?"

The future JSNode computer should make that distinction first-class.
A package dependency is a structural precondition.
A type-flow edge is an executable possibility.

## Imports as demand-side utterances

`./workspace/consumption` reads authored source imports.
This is the demand half of the package ecology.

Provider-side utterances say:

```text
package P has function f
package P has type T
```

Consumer-side utterances say:

```text
package C uses function P:f
package C uses type P:T
package C uses package P
```

The important design choice is that demand settles against the same `functionTerm` and `typeTerm` minted by the provider.
Supply and demand meet on one term.
That makes "is anything still using this symbol?" a reading of the settled topology, not a string search.

This also explains the fail-safe treatment of namespace, star re-export, and dynamic import forms.
Those import modes reach a provider without naming a symbol.
They produce indeterminate demand.
The package refuses to certify exports as unused when a coarse import exists.
That is a good example of a mathematical obstruction instead of an overconfident boolean.

## Package binaries as strategies

The `./package-bin` subpath is the first place the package is explicitly about computing rather than only package topology.

A `package.json#bin` entry is admitted as a `PackageBinCarrier`:

```text
package has bin
bin has target
bin has executable
bin speaks protocol
```

The protocol is currently:

```text
stdio-eavt
```

The library-verb note says composable shell tools are CGS strategies.
A script that reads a carrier from stdin and emits a carrier on stdout is an endomorphism of that carrier.
A pipe is cut.
The session type is the Hoare contract.

That is exactly how package bins should be understood here:

```text
PackageBinCarrier
-> executable strategy boundary
-> stdin/stdout EAVT session
-> composable process morphism
```

The web layer should not own package bins.
It should only transport a generic stdio/EAVT process.
561 Group Operations Manifold should adapt package-bin carriers to that transport.
The previous cleanup moved in that direction: `computing-with-jsnode` owns the package-bin carrier semantics; `web` owns HTTP/process plumbing; 561 Group Operations Manifold owns the mount.

The next step is to make the strategy law explicit.
A bin should declare whether it is:

- an endomorphism of a carrier, suitable for composition;
- a boundary morphism from carrier to representation;
- a responder over a session;
- a non-composable operational command.

The current carrier says "speaks stdio-eavt."
It does not yet say the object of the session or the law of the strategy.

## The workspace as a concurrent game system

Reading JSNode as a concurrent game system is not metaphorical.
The workspace is a finite concurrent arena.

One possible arena reading:

- packages are local systems;
- exports and bins are Player offers;
- imports and dependencies are Opponent demands;
- source files and manifests are boundary evidence;
- type signatures are session propositions;
- dependency edges are enabling constraints;
- conflicts are lifecycle/deprecation/build-boundary obstructions;
- package scripts are strategies over workspace carriers;
- package installation/build/test is a play.

In this arena, a package does not "contain code."
It presents moves:

- import me at this subpath;
- call this function;
- consume this type;
- run this bin;
- build me before depending on me;
- treat this export as private or public;
- accept this Node runtime;
- reject this boundary violation.

The workspace computer observes the package ecology and derives which moves are currently legal.
The conformance checker is not a linter in this reading.
It is a referee that returns charged findings about whether a package strategy inhabits the session promised by the repository rules.

This is why JSNode is a meta-level language.
It is a language whose terms are packages, exports, imports, scripts, declarations, manifests, and package boundaries.
The interpreter is the workspace computer:

```text
manifest/declaration/source evidence
-> package utterances
-> settled workspace topology
-> dependency/type/reduction readings
-> admitted package operations
```

The "program" is the package ecology itself.

## What the current `./analysis` subpath really is

The analysis modules compute derived readings over the package graph:

- components;
- cycles;
- diameter/radius/center;
- centrality;
- stratum/height;
- domain and role catalogs;
- lifecycle and migration debt;
- build order;
- dependency drift;
- consistency checks;
- spectrum;
- type-flow;
- symbol graph.

These should remain derived readings.
They must not define primitive package objects.
Their domain is usually `WorkspaceDependencyGraph` or `WorkspaceTypeIndex`; their codomain is a projection/report.
That is lawful if the docs and exports say so.

The risk is naming.
"Analysis" can become a drawer for arbitrary records.
The category map should split it more sharply:

- graph geometry readings;
- lifecycle/disposition readings;
- role/domain quotient readings;
- type-flow category readings;
- symbol graph readings;
- spectrum readings.

Each reading should state the carrier it derives from and the categorical construction it witnesses.

## Conformance as charged judgment

`./conformance` already follows the repository's house style better than many tools.
It produces `Finding[]` from invariant controls, with bilattice charges:

- potential for conforming evidence;
- active for violations;
- stable for held/allowed violations;
- absurd for no evidence.

The `CheckReport` is still a projection shape, but its comments correctly say that findings are charged cells and package identity/source facts normalize elsewhere through JSNode carriers.

The next improvement is to connect this more directly to the package-computer root.
A conformance check should be one admitted operation:

```text
computeWithJSNode("package.reduce", token, claim?)
```

where the token names a package carrier or package directory boundary, and the codomain is a charged admission containing a conformance judgment.

## Host JS as platform carrier

The `./javascript/holography/host` module is an important clue.
It represents the Node host as a platform with capabilities:

- filesystem;
- process;
- timer;
- crypto;
- network;
- stdio.

Those capabilities are charge values.
That is exactly the right direction for a JSNode computer: Node is not just a runtime version.
It is the platform arena that makes certain package strategies executable.

This matters for package bins and workspace discovery.
A package script that needs `process` and `stdio` inhabits a different host capability profile from a pure topology function.
A future root admission can refuse or obstruct a run when the requested action needs a capability the current host carrier does not hold.

## What is scattered today

Conceptually "computing with jsnode" is spread across:

- `./topology`: package/workspace carrier floor;
- `./workspace`: filesystem and TypeScript boundary;
- `./javascript`: JavaScript type/function algebra and host platform;
- `./analysis`: graph/type-flow readings;
- `./package-bin`: executable package strategy boundaries;
- `./conformance`: charged law checking;
- `./content`: documentation/content production over package surfaces;
- `./codecs`: RDF/JSON-LD/SVG/Markdown projections;
- `./scripts`: CLI entrypoints;
- downstream 561 Group Operations Manifold/web code: HTTP/process mounting of package bins.

This is acceptable as implementation geography, but the package needs one category map explaining the objects and morphisms.
Without that, the package looks like a toolbox.
With it, it becomes a computer.

## The root surface we probably want

Following `@emsenn/computing`, the root should eventually export something like:

```ts
computeWithJSNode(action, token, claim?)
```

or simply:

```ts
compute(action, token, claim?)
```

where `action` is a finite vocabulary witnessed at the boundary, not just any string.
Candidate actions:

- `workspace.discover`
- `workspace.observe`
- `workspace.graph`
- `workspace.type-flow`
- `package.read`
- `package.conformance`
- `package.bin.discover`
- `package.bin.run`
- `content.audit`
- `content.reference`

The token should not be a free DTO.
It should be a boundary carrier or a carrier reference:

- repo root path as filesystem boundary;
- package directory path as filesystem boundary;
- already admitted `JSNodePackage`;
- already admitted `JSNodeWorkspace`;
- `PackageBinCarrier`;
- `HostJsPlatform`;
- maybe a `ComputingToken` compatible with `@emsenn/computing`.

The codomain should be a charged admission:

```text
admitted | refused
charge
observation/read/result
obstruction
```

This would make the root import match shell/API/MCP use: "ask the JSNode computer to perform an action over a token."
Rich internals can remain on subpaths.

## What `./compute` should stop being

Today `./compute` is a flat compatibility barrel:

```ts
export * from "../topology/index.mjs";
export * from "../analysis/index.mjs";
export * from "../workspace/index.mjs";
export * from "../codecs/index.mjs";
export * from "../package-bin/index.mjs";
```

That was useful as a drop-in replacement for the old app.
It is not a categorical compute surface.
It should either:

1. become the actual aggregate computer surface, with an admission function and lawfully named actions; or
2. be renamed/deprecated as a compatibility barrel once the root has the real call surface.

The current name promises more than it delivers.

## Proper exports by categorical role

A future cleanup should classify exports by role.

Topology exports:

- carriers: `JSNodePackage`, `JSNodeWorkspace`, `JSNodeTopologyCarrier`;
- constructors/admissions: `jsNodePackage`, `jsNodeWorkspace`;
- term and predicate vocabularies: lawful finite vocabulary surfaces;
- settlement morphisms: `induceJSNodeTopology`, `extendJSNodeTopology`, `induceWorkspaceTopology`.

Workspace exports:

- representation boundaries: `readJSNodePackage`, `discoverWorkspace`, `eachWorkspacePackageDir`;
- boundary witnesses: `packageBinManifest`;
- impure indices: `workspaceConsumptionIndex`, `workspaceTypeIndex`;
- pure boundary checks: `packageBoundaryFailures`;
- fs wrapper: `lintPackageBoundary`.

JavaScript exports:

- algebra objects/morphisms: `JsType`, `JsFn`, `TypeCatalog`, `composeAt`;
- topology closures: `induceTypeTopology`;
- host platform carriers: `HostJsPlatform`, `platformCarrier`;
- TypeScript compiler boundary: introspection APIs.

Package-bin exports:

- carriers: `PackageBinCarrier`, `PackageBinDiscovery`;
- admissions: `packageBinCarrier`, `packageBins`, `packageBinDiscovery`;
- representation projections: `packageBinEndpoint`, `packageBinFact`;
- finite protocol vocabulary: `EAVT_JSONL`, `PACKAGE_BIN_COMPUTING_ACTION`.

Analysis exports:

- readings over graphs and type indices;
- witnesses/obstructions where possible;
- no primitive objects.

Codecs/content/scripts:

- representation boundaries only.

This classification should be written into package docs and reflected in subpath exports.

## How this informs the Hive computer work

The user asked about reworking `computing-with-hive` only by editing that library.
I did not edit it in this pass, but I did inspect its package shape.
It has the same historical pattern as JSNode: many subpaths and a root barrel.
The lesson from JSNode is the same lesson Hive will need:

- identify the carrier floor first;
- separate wire codecs from ontology;
- make chain, content, curation, market, wallet, execution, and emission into objects/morphism families rather than utility buckets;
- make scripts into declared strategies over carriers;
- make the root a call/admission surface, not a namespace bag;
- make host/network/key boundaries explicit capability carriers or service boundaries;
- keep service instance logic out of the library.

JSNode is a safer place to write this down because its carrier floor is already clear.
Hive should follow the same pattern, but with Hive-specific objects: accounts, operations, blocks, transactions, rewards, vesting, posts, votes, markets, keys, signatures, RPC observations, and strategy boundaries.

## The implementation order I would use for JSNode

1. Write a category map in package docs and module headers.
2. Define a finite action vocabulary for root JSNode computing.
3. Add root `computeWithJSNode` / `compute` admission with charged admissions and obstructions, modeled after `@emsenn/computing`.
4. Convert `./compute` from a compatibility barrel into the aggregate computer surface, or explicitly deprecate it.
5. Add tests that state laws:
   - manifest admission normalizes to package utterances;
   - workspace discovery derives a workspace carrier, not a graph directly;
   - graph analysis derives from `WorkspaceDependencyGraph`;
   - package-bin admission produces utterances and a session/protocol witness;
   - conformance check returns charged findings;
   - root admissions refuse missing carriers with obstructions.
6. Make package-bin session objects explicit:
   - what carrier crosses stdin/stdout?
   - is the bin an endomorphism?
   - does it consume stdin once?
   - does it emit the canonical representation?
7. Reclassify public exports by categorical role.
8. Move any pure "record report" that lacks visible descent behind a projection or add explicit descent comments/tests.
9. Only after that, consider code deletion or old compatibility breaks.

## The mental model

The JSNode computer is the repository reading itself as a program.

The package manager sees packages and dependency ranges.
TypeScript sees files, imports, declarations, and emitted declaration surfaces.
The shell sees executable bins.
HTTP sees mounted routes.
Documentation tooling sees README and reference surfaces.

The JSNode computer should see one thing beneath all of those:

```text
an ecology of strategies over relational carriers
```

Packages are not folders.
Exports are not strings.
Imports are not string matches.
Scripts are not command names.
They are all moves, morphisms, and boundary witnesses in a concurrent game over the workspace.

That is the standard this package should be held to.
