---
builds-on:
  - 2026-06-21-theory-of-jsnode-esm-ts-as-shadow-of-the-relating-descent.md
  - 2026-06-21-package-composition-by-carrier-node-mounting.md
  - 2026-06-22-survey-of-561-group-jsnode-ecosystem.md
  - 2026-06-25-strata-and-the-across-site.md
  - 2026-06-26-information-coherence-kernel-service.md
  - 2026-06-26-pre-ick-cutover-ledger.md
  - 2026-06-27-ick-mounting-ownership.md
date: 2026-06-27
description: Study note on how the theory and current code read JS/Node packages, the workspace package mesh, and sites/ directories as both packages and actuating configured places.
status: study
tiles:
  - computing
  - organizing
  - ICK
  - JSNode
  - sites
title: JSNode packages, workspaces, and package-sites
---
This note studies a narrow but load-bearing question: how this corpus currently conceives JS/Node packages and workspaces, and how that conception relates to `sites/` directories that are themselves JS/Node packages.

The short answer:

> A JSNode package is a manifest-admitted carrier with library, operator, dependency, declaration, and lifecycle faces.
> A workspace is the dependency-and-consumption site on which those carriers are glued into a topology.
> A `sites/*` directory is a package in that workspace, but it is also a configured place with points, policy, and state: a package-site.
> JSNode ICK reads the former; the ICK service is the stable contract a site should mount for kernel capability.

The current repo holds a real contradiction that should not be erased: `apps/jsnode-ick/package.json` is marked `decommissioned`, while the agent orientation still names `@emsenn/jsnode-ick` as the JS/Node-domain application for package/workspace facts, and several live sites still import it.
Read that as migration pressure.
The JSNode readings remain implemented and useful; package-bin transport as a general site/kernel transport is the part being retired.

## Read set

Theory and architecture read:

- `../papers/2026-06-26-ick-whitepaper.md`
- `../papers/2026-06-26-infotiles-bilattice-sofic-tilings.md`
- `2026-06-21-theory-of-jsnode-esm-ts-as-shadow-of-the-relating-descent.md`
- `2026-06-21-package-composition-by-carrier-node-mounting.md`
- `2026-06-22-survey-of-561-group-jsnode-ecosystem.md`
- `2026-06-25-strata-and-the-across-site.md`
- `2026-06-26-information-coherence-kernel-service.md`
- `2026-06-26-dev-emsenn-net-as-rck-in-site.md`
- `2026-06-26-package-capability-rehoming-audit.md`
- `2026-06-26-pre-ick-cutover-ledger.md`
- `2026-06-27-ick-mounting-ownership.md`

Current code read:

- `../../../../pnpm-workspace.yaml`
- `../../../../apps/jsnode-ick/package.json`
- `../../../../apps/jsnode-ick/src/index.mts`
- `../../../../apps/jsnode-ick/src/kernel.mts`
- `../../../../apps/jsnode-ick/src/actions.mts`
- `../../../../apps/jsnode-ick/src/jsnode/workspace.mts`
- `../../../../apps/jsnode-ick/src/jsnode/session-workspace.mts`
- `../../../../apps/jsnode-ick/src/jsnode/analysis.mts`
- `../../../../apps/jsnode-ick/src/jsnode/package-scripts.mts`
- `../../../../apps/jsnode-ick/src/jsnode/ecosystem-infotiling.mts`
- `../../../../apps/jsnode-ick/src/package-bin-transport.mts`
- `../../../../apps/jsnode-ick/src/package-bin-web.mts`
- `../../../../apps/jsnode-ick/src/topology.mts`
- `../../../../sites/ops. 561.group/src/app.mts`
- `../../../../sites/ops. 561.group/src/package-surface.mts`
- `../../../../sites/turntide-islands.discord.com/src/serve.mts`

## Theory: package as strategy surface

The older JSNode theory note says computation is strategy composition in concurrent games with symmetry: strategy versus world is computation; strategy versus self is agency; strategy versus chosen opponent is play.
In code-facing terms, an action is a strategy/morphism, a CLI pipe is cut, and a witnessed invocation becomes EAVT/RWIL evidence.

So a JS/Node package is not merely an npm install unit.
It is an authored bundle of strategies around carriers:

- its `exports` are the library surface, the importable morphisms and carrier constructors;
- its `bin` entries are operator surfaces, executable strategies at a process boundary;
- its `scripts` are local operational rituals, not always public capabilities;
- its dependencies are declared wiring against other package carriers;
- its declaration files in `dist/` are the typed carrier/morphism shadow of the runtime surface;
- its lifecycle and maturity tags are part of the package's current admissibility.

The carrier-node mounting note generalizes this: packages should mount their apex at the node whose carrier they act on.
The path is not arbitrary; the carrier `$id` / descent path is the namespace location.
CLI, MCP, OpenAPI, and WebUX are then four faces of the same apex at that node.
This is the theory behind treating package surfaces as mounted sections over a namespace site rather than as scattered utilities.

## Workspace as package topology

`pnpm-workspace.yaml` is the active workspace register.
In the current file it includes `apps/`, `lib/`, `services/`, and `sites/` package patterns.
Current source also has manifest-only packages outside that register, so workspace membership and "has a package.json" are deliberately different facts.

`apps/jsnode-ick/src/jsnode/workspace.mts` implements the practical reader:

- it discovers `package.json` files through the filesystem admission layer;
- it decodes manifests with `@emsenn/computing`'s manifest carrier;
- it records each package as `DiscoveredPackage` with name, dir, version, description, layer, lifecycle, maturity, tags, exports, dependencies, dependency entries, module type, scripts, bins, engines, repository, and homepage;
- it builds the dependency graph through `@emsenn/organizing`'s `dependencyGraphFromManifests`;
- it reads source imports into a consumption index, including named/default/namespace/star/dynamic import modes;
- it reads declaration files from `dist/` to form type and function indexes.

That gives the workspace several simultaneous readings:

- a dependency DAG or cyclic graph;
- an ego-neighborhood around one package;
- a consumption graph over source imports;
- a type-flow category over exported declarations;
- a domain/role quotient induced by package names;
- a lifecycle/decommission graph;
- a spectrum/InfoTiling over package neighborhoods.

This is exactly the InfoTiles paper's package-mesh example made concrete: the workspace graph is a data tiling candidate.
Its cycles are coordination obstructions; its local spectra are invariants of package neighborhoods; its package names and manifests are the observable finite colouring of a much richer development ecology.

## JSNode ICK as current implementation

`@emsenn/jsnode-ick` is currently an application, not a core faculty and not the kernel service.
Its manifest description calls it the JS/Node domain iteration of the ICK: project package facts, package-bin catalogs, and topology as coherent served mounts.
Its exports include workspace, topology, actions, analysis, package-bin transport/web, package lint/reduction, capability search, RDF, type-flow, workspace health, and session-workspace surfaces.

The public action apex is in `src/actions.mts`.
It creates `jsnode/*` verbs for:

- workspace graph and session-workspace package carriers;
- topology and topology-carrier utterances;
- package/module/symbol/type atlases;
- type-flow, type-neighborhoods, and shortest type pipelines;
- RDF/Turtle/JSON-LD projections;
- graph/dependency/build/lifecycle/domain/role/spectral analysis;
- ecosystem InfoTiling;
- capability search and coverage;
- package lint/reduction/description-update;
- decommissioned-import and decommission-readiness audits.

Then `createJsnodeIckCoproductActions` prepends the core ICK coproduct actions.
`createJsnodeIckCoproductInduced` induces the whole thing as `@emsenn/jsnode-ick`.

`src/kernel.mts` makes the app/server shape explicit.
A `JsnodeIckService` wraps an `@emsenn/information-coherence-kernel` service, adds JSNode actions, and mounts:

- `/package-bins` plus `/package-bins/scripts` for package-bin WebUX/transport unless disabled;
- `/jsnode-topology` for JSNode topology;
- `/workspace` for workspace DAG views;
- the underlying ICK service route as fallback.

So JSNode ICK is an ICK-domain application over the workspace, not the ICK itself.
It specializes the kernel to the JS/Node package mesh and can serve those readings through the same HTTP/OpenAPI/MCP/WebUX idiom.

## Package-bin transport: useful but demoted

`package-scripts.mts`, `package-bin-transport.mts`, and `package-bin-web.mts` read `package.json#bin` as executable strategies.
They turn each bin into:

- a term such as `jsnode-ick.package-bin.<package>:<name>`;
- a strategy term;
- a session term keyed by protocol, defaulting to `stdio-eavt`;
- facts and utterances;
- an operation endpoint;
- OpenAPI and MCP projections;
- a carrier-category diagram and WebUX.

This is real and valuable for JSNode package facts.
But the pre-ICK cutover ledger is clear: package-bin WebUX/OpenAPI/MCP sidecars should not remain the general transport layer for sites or for the kernel.
The ICK service now owns the flat nine-faculty syscall face and its generated OpenAPI/MCP/WebUX/feed/discovery surfaces.
Package-bin transport belongs as a JSNode application reading over package facts, not as the universal way sites expose capability.

That explains the historical churn:

- `services/jsnode-http-server` and `services/jsnode-web-server` were briefly mislanded service packages;
- their package-bin transport and WebUX code was moved into `apps/jsnode-ick`;
- live site consumers were retargeted to `@emsenn/jsnode-ick/package-bin-*`;
- the ICK service shed service-local package-bin sidecar exports.

The architecture did not reject package-bin readings.
It rejected package-bin sidecars as the kernel contract.

## Sites as package-sites

The strata note gives the basic descent:

```text
lib -> apps -> services -> sites
```

A library is the pure concept.
An app applies it to the real world.
A service holds it open as a process.
A site parameterizes a service with points and state.

In the JSNode workspace, a `sites/*` directory is also a package manifest.
That means every site package has two faces at once:

1. **Workspace package face.**
  It has a name, deps, scripts, bins, lifecycle, typed surface, and import edges.
  JSNode ICK can read it exactly like any other package.
2. **Site/place face.**
  It has hostnames, ports, data roots, local policy, content roots, hook adapters, and actuator authority.
  It is a configured place, not just a reusable package.

This double nature is not a bug.
It is why "package site" is a good phrase here: a site package is the finite JSNode carrier for a configured place.
Its manifest is the package-level record; its directory state is the local point/state of the site.

The current site inventory from `pnpm-workspace.yaml` has 15 workspace `sites/*` packages:

| Site package | Depends on JSNode ICK | Depends on ICK service | Bin count | Reading |
|---|---:|---:|---:|---|
| `sites/dev.bare-cedar-fog.emsenn.net` | no | yes | 17 | IN/reflection site moving onto ICK service and authored MASH actions |
| `sites/ops.561.group` | yes | no | 84 | OUT/operations manifold; still a pre-ICK package-bin inventory and migration target |
| `sites/research.561.group` | yes | no | 28 | knowledge/research site still using JSNode package-bin transport |
| `sites/research.emsenn.net` | yes | yes | 0 | hybrid migration evidence |
| `sites/turntide-islands.discord.com` | yes | no | 5 | site-local operation surface through JSNode package-bin WebUX/MCP |
| other 10 workspace site packages | no | no | 0 | normal site packages without current JSNode ICK or ICK-service dependency |

This table matters because it shows the migration line.
`dev.bare-cedar-fog.emsenn.net` is the model for mounting ICK as the stable service boundary and keeping site-owned code to instance policy, hooks, and local orientation.
`ops. 561.group`, `research. 561.group`, and `turntide-islands.discord.com` are still leaning on JSNode package-bin surfaces for operation exposure.
`research.emsenn.net` straddles both.

## Site ownership boundary

The post-cutover site-owned set is intentionally small:

- instance name;
- host, port, base path, namespace, and data root;
- local policy and gates;
- local content roots and notebooks;
- tiny hook adapters that package local payloads as ICK inputs;
- operator preferences that cannot live in a reusable faculty.

The site should not own:

- general package-bin transport;
- bespoke dashboard state folds;
- duplicate RWIL/session/feed parsers;
- private state shards parallel to the ICK witness log;
- copies of package/workspace topology that JSNode ICK or a successor package can derive from manifests.

For JSNode package sites, this means `package.json#bin` can still be read as evidence of site capability, but it should not be mistaken for the canonical capability owner after an ICK/faculty action exists.
A bin is often an adapter or a local actuator button, not the ontology.

## The decommission tension

Current source and injected audit report that `@emsenn/jsnode-ick` is marked decommissioned while active packages import it.
The audit listed 408 import violations, including `sites/ops. 561.group` imports from `@emsenn/jsnode-ick`.

This should be held as a real top value, not hand-waved:

- **Built/useful side:** the package currently implements the workspace/package/topology/type-flow/decommission readings agents need for JSNode work.
- **Retirement side:** its manifest carries the decommission marker, and package-bin transport is explicitly not the desired general site/kernel transport.

The sane interpretation is not "stop reading JSNode ICK immediately" and not "remove the marker because sites still import it."
The sane interpretation is: separate the durable JSNode workspace readings from the retiring package-bin/general-transport role, then rehome or un-decommission the surviving surface under the right owner.

Likely split:

- JSNode workspace/package facts, dependency topology, package atlases, type-flow, RDF, lifecycle, and decommission audits remain needed as a JSNode-domain application over ICK.
- Package-bin WebUX/MCP/OpenAPI as a general site capability layer retires once sites mount ICK/faculty actions or notebooks for the same work.
- Site packages keep only thin local adapters and policy.

## Maturity

- **Built+green by prior notes:** the ICK service face, the package-bin relocation into `apps/jsnode-ick`, and the live site retargets were previously verified in the cited notes.
- **Observed in current source in this study:** JSNode workspace discovery, manifest carriers, dependency graphs, type-flow, package-bin projections, JSNode action induction, and live site imports.
- **Research-grade synthesis:** "package-site" as the exact term for a `sites/*` package's double role as manifest carrier and configured place.
- **Roadmap:** resolving the decommission contradiction by rehoming durable JSNode workspace readings and retiring package-bin transport as a general site/kernel layer.

No build or test gate was run for this note.
This was a source-and-theory study.

## Rule of thumb

When working on package/workspace questions:

1. Read `pnpm-workspace.yaml`, then the package's `package.json` `exports`, `bin`, `scripts`, deps, lifecycle, and keywords.
2. Treat a package as a carrier/morphism surface, not just a directory.
3. Treat a workspace as the site on which package carriers glue into dependency, consumption, declaration, and lifecycle topology.
4. For `sites/*`, separate the package face from the site/place face.
5. Prefer ICK/faculty actions for durable capability; use JSNode package-bin readings only as package evidence or temporary actuator adapters.
6. If `@emsenn/jsnode-ick` is involved, check whether the use is a durable JSNode workspace reading or a retiring package-bin transport dependency.
