# Consolidating the `*-computer` apps into `@emsenn/computing-with-jsnode`

> **Status: superseded — historical record.**
> This was once a forward plan for consolidating several `*-computer` apps into a single library.
> That consolidation has happened, but not under the names the original plan used, so the plan's detailed sections (which named `@emsenn/jsnode`, a set of source apps, and target subpaths that were never built) have been replaced by the accurate record below.
> For the current, evolving module inventory read `dev/docs/category-map.md`; this file records only the shape of the outcome.

## What was consolidated

The reusable, mostly-pure capability of the former `*-computer` apps — workspace introspection, dependency-graph analysis, manifest and document rendering, and the documentation cycle — was internalised into one library, `@emsenn/computing-with-jsnode`, at `lib/computing-with-jsnode`.
The thin app shells (CLI plus filesystem binding) that wrapped that capability are gone; the four source apps the original plan named (`@emsenn/javascript-computer`, `@emsenn/jsnode-computer`, `@emsenn/jsnode-content-computer`, `@emsenn/jsnode-doc-computer`) no longer exist as separate apps.

## The realized shape

The library publishes these subpaths (from `package.json` `exports`):

- `.` — the package root.
- `./compute` — the computing entry surface.
- `./typing` — type identity and the typing layer.
- `./functions` — function-level facts.
- `./modules` — module facts, including the `content/doc` document tooling (`reference`, `coverage`, `audit`, `scaffold`, `manage`).
- `./packages` — package-level facts, including the package-bin surface.
- `./workspaces` — workspace discovery and the pure dependency-graph **analysis** cluster (`analysis`, `dependencies`, `consistency`, `build-order`, `spectrum`, `type-flow`, and the rest), which lives at `src/computing/workspaces/analysis/`.
- `./codecs` — the pure rendering boundaries (`layout`, `svg`, `symbol-svg`, `rdf`).
- `./holography` — the projection kernel.

The original plan had proposed `./analysis`, `./workspace`, `./javascript`, and `./content` as new subpaths; those names were not adopted — the analysis cluster landed under `./workspaces` and the document/introspection tooling under `./modules` and `./compute` instead.

## The realized dependencies

`@emsenn/computing-with-jsnode` depends on `@emsenn/561-group-conformance-algebra`, `@emsenn/computing`, `@emsenn/content`, `@emsenn/gaming`, and `@emsenn/relating`, plus `typescript` as a **direct** dependency (the TypeScript compiler API that workspace introspection and import-reading use — the plan had anticipated it would become direct once the source apps collapsed, and it did).

## The organising principle that survived

The one idea from the original plan that still governs the layout is the **purity boundary**: pure, no-I/O modules (graph geometry, codecs, type-level analysis) are kept separate from the filesystem walkers and compiler-driven readers that perform I/O.
Pure modules render facts out of carriers; the impure thin edges read the filesystem and the TypeScript program and hand those facts in.
That separation is why the analysis cluster is pure and testable in isolation while the workspace discovery that feeds it is the only part that touches disk.
