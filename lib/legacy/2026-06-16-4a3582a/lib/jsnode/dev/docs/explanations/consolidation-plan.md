# Consolidating the four `*-computer` apps into `@emsenn/jsnode`

## Goal

Four apps — `@emsenn/javascript-computer`, `@emsenn/jsnode-computer`,
`@emsenn/jsnode-content-computer`, `@emsenn/jsnode-doc-computer` — each carry a
mix of (a) reusable, mostly-pure capability and (b) a thin app shell (CLI +
filesystem binding). The reusable capability belongs in the `@emsenn/jsnode`
library as new module subpaths. The app shells either disappear or shrink to
thin scripts that re-export the library and bind it to `process`/`fs`.

This document fixes the **target subpath layout**, the **new workspace
dependencies** `lib/jsnode` must take on, an **ordered, conflict-free migration
sequence**, and a **first slice** that is additive and genuinely low-risk.

The repo is **trunk-only**: every step below is a read/edit of files on `main`.
No branches, no worktrees.

---

## 1. Target subpath layout inside `lib/jsnode`

`@emsenn/jsnode` today exposes `.`, `./topology`, `./codecs`. The consolidation
adds four capability subpaths. The organising principle is **purity boundary**:
pure (no-I/O) modules land under analytical/codec subpaths; filesystem walkers
land under `./workspace`; content/LLM reading lands under `./content`.

| Subpath | Purity | Absorbs (source app → module) |
|---|---|---|
| `./topology` *(exists)* | pure | + `graph.mts` (workspace dependency DAG / ego-graph) from `jsnode-computer` |
| `./analysis` *(new)* | pure | the pure graph-geometry cluster from `jsnode-computer`: `analysis`, `domain`, `role-catalog`, `lifecycle`, `dependencies`, `consistency`, `build-order`, `spectrum`, `type-flow`, `symbol-graph` |
| `./workspace` *(new)* | impure (fs) | `jsnode-computer`: `workspace`, `consumption`, `type-index`; `jsnode-doc-computer`: `audit`, `scaffold` |
| `./codecs` *(exists)* | pure | + `jsnode-computer`: `layout`, `svg`, `symbol-svg`; `jsnode-doc-computer`: `readme`, `agents`, `claude-md` (pure manifest → Markdown/SVG renderers) |
| `./javascript` *(new)* | impure (fs, `typescript`) | `javascript-computer`: `introspect`, `documentation`, `documentation-edit`, `imports`, `index` — the TS-compiler-API surface other modules call |
| `./content` *(new)* | mixed | `jsnode-content-computer`: `audit`, `surface`, `cycle`; `jsnode-doc-computer`: `reference`, `coverage`, `manage` (doc-surface reading + LLM documentation cycles) |

Notes on placement choices:

- **`graph.mts` is the spine of the analysis cluster.** Every pure analysis
  module imports `WorkspaceDependencyGraph` from it. It is itself pure (its only
  import is `@emsenn/jsnode/topology`). It is conceptually *topology* (it
  projects a `JSNodeWorkspace` onto its edge set), so it lands in `./topology`
  beside `jsnode-topology.mts`. The `./analysis` modules then import it via
  `../topology/index.mjs`.
- **`type-index.mts` is impure** (walks `dist/*.d.ts` off the filesystem via the
  TS compiler), so it lands in `./workspace`, not `./analysis`. `type-flow.mts`
  and `symbol-graph.mts` consume only its **type** (`import type
  WorkspaceTypeIndex`), which is erased at compile time, so they remain pure and
  live in `./analysis`; they import the type from `../workspace/index.mjs`.
- **`javascript-computer`'s introspection surface becomes `./javascript`.**
  Several impure modules (`consumption`, `type-index`, `surface`, `reference`,
  `coverage`, `manage`) call it; collapsing it into `jsnode` removes a workspace
  dependency edge and lets those callers import `../javascript/index.mjs`.
- The **CLIs** (`cli.mts` in each app) and the **root re-export barrels**
  (`index.mts`) do not move into the library; they stay as the app's thin shell
  (or the app is deleted and a single consolidated CLI is added later — out of
  scope for this plan, which only needs the apps *deletable*, i.e. carrying no
  unique capability).

---

## 2. New workspace dependencies `lib/jsnode` must add

`lib/jsnode` currently depends on `@emsenn/javascript`, `@emsenn/relationality`,
`@emsenn/web`. To absorb the capability above it must add:

| New dep | Needed by | Why |
|---|---|---|
| `@emsenn/content` | `./content` (`cycle`, `audit`, `surface`'s topology types), `./codecs` overlap | the documentation-cycle modules build on `@emsenn/content`'s documentation topology and gates |
| `@emsenn/content-computer` | `./content` (the provider/model binding used by the doc cycle) | needed once the `cycle`/CLI binding lands; pulls model providers |
| `typescript` | `./javascript`, `./workspace` (`type-index`, `consumption`) | the TS compiler API that introspection and import-reading use; currently a transitive dep via `@emsenn/javascript-computer`, becomes direct once that app collapses |

`@emsenn/javascript-computer` and `@emsenn/jsnode-computer` are **not** added —
their capability is being internalised, so depending on them would create a
cycle. Their reusable modules are copied/moved in, and `typescript` (their only
non-workspace runtime dep) is taken on directly.

Adding `@emsenn/content` / `@emsenn/content-computer` to `lib/jsnode` is
explicitly human-approved.

---

## 3. Ordered, conflict-free migration sequence

Each step is additive or a localised rewire; nothing downstream breaks until the
step that explicitly rewires it. Build/verify (`pnpm -C lib/jsnode verify`) after
each landing step.

1. **First slice (additive, no app touched).** Copy the pure dependency-graph
   analysis cluster into `lib/jsnode` under `./topology` (`graph`) and a new
   `./analysis` subpath. Rewrite their `@emsenn/jsnode/topology` imports to the
   internal relative path. Add the `./analysis` export and `src/analysis/index.mts`
   barrel. Apps keep their own copies; nothing re-wires yet. **(Detailed in §4.)**

2. **Land the `./codecs` pure renderers.** Copy `layout`, `svg`, `symbol-svg`
   (from `jsnode-computer`) and `readme`, `agents`, `claude-md` (from
   `jsnode-doc-computer`) into `./codecs`. All pure; `svg` imports
   `@emsenn/jsnode/topology` → rewrite to `../topology/index.mjs`. Additive.

3. **Add `typescript` dep + land `./javascript`.** Add `typescript` to
   `lib/jsnode` dependencies. Copy `javascript-computer`'s `introspect`,
   `documentation`, `documentation-edit`, `imports` into a new `./javascript`
   subpath; add its export + barrel. Additive (no app re-wired yet).

4. **Land `./workspace` (fs walkers).** Copy `workspace`, `consumption`,
   `type-index` (`jsnode-computer`) and `audit`, `scaffold` (`jsnode-doc-computer`)
   into `./workspace`. Rewrite their `@emsenn/javascript-computer` imports to
   `../javascript/index.mjs` and `@emsenn/jsnode/topology` to
   `../topology/index.mjs`. Add export + barrel. Additive.

5. **Finish `./analysis`:** add `type-flow`, `symbol-graph` (their only import,
   `import type WorkspaceTypeIndex`, now resolves to `../workspace/index.mjs`).
   Additive.

6. **Add `@emsenn/content` + `@emsenn/content-computer`; land `./content`.** Copy
   `surface`, `cycle`, `audit` (`jsnode-content-computer`) and `reference`,
   `coverage`, `manage` (`jsnode-doc-computer`). Rewrite their cross-app imports
   to internal relative paths. Add export + barrel. Additive.

7. **Rewire `@emsenn/javascript-computer`.** Its library modules now live in
   `jsnode/javascript`. Replace the app's module bodies with thin re-exports
   from `@emsenn/jsnode/javascript` (add `@emsenn/jsnode` to its deps), or — if
   nothing else in the workspace imports the app — mark it for deletion. Verify
   the workspace still builds (`@emsenn/jsnode-computer` etc. import it).

8. **Rewire `@emsenn/jsnode-computer`.** Replace each migrated module with a
   re-export from the matching `@emsenn/jsnode/{topology,analysis,codecs,workspace}`
   subpath; keep only `boundary.mts`, `cli.mts`, `index.mts` as the app shell.
   Its `@emsenn/javascript-computer` dep can then be dropped in favour of
   `@emsenn/jsnode/javascript`.

9. **Rewire `@emsenn/jsnode-doc-computer` and `@emsenn/jsnode-content-computer`**
   the same way: bodies become re-exports from `@emsenn/jsnode/{codecs,workspace,content}`;
   only `cli.mts`/`index.mts` remain. Drop the now-internalised app deps.

10. **Collapse the shells.** Once every app module is a pure re-export and the
    consolidated capability is verified, fold the four CLIs into a single
    consolidated CLI (or thin per-domain scripts) and **delete the apps**. At
    this point the apps carry no unique capability and are deletable.

Conflict-freedom: each *land* step (1–6) only **adds** files/exports to
`lib/jsnode` and never edits an app, so no app build can break. Each *rewire*
step (7–9) edits exactly one app at a time and replaces a body with a re-export
of already-landed, already-verified library code, so the change is mechanical and
locally checkable. Deletion (10) is last.

---

## 4. First slice — pure analysis cluster (additive, low-risk)

**What:** copy the closed cluster of **pure, no-I/O** dependency-graph analysis
modules from `@emsenn/jsnode-computer/src` into `@emsenn/jsnode`, under a new
`./analysis` subpath (plus `graph.mts` into the existing `./topology`). No app is
touched — the apps keep their own copies and continue to build unchanged, so
nothing downstream can break.

**Why these and only these:** they form a self-contained import-closed set whose
external imports are *already available to `lib/jsnode`*:

- every module imports only from `@emsenn/jsnode/topology` (re-exports
  `packageCoordinate`, `JSNODE_ROLES`, `ROLE_LEXICON`, `roleConcept`, `roleTerm`,
  `domainTerm`, and the `JSNodeRole`/`JSNodeLayer`/`JSNodeWorkspace`/lifecycle
  types — all confirmed present in `topology/index.mts`) and from each other
  (`./graph`, `./dependencies`);
- none of them touch `fs`, `process`, the network, or `typescript`;
- `type-flow`/`symbol-graph` are **excluded** from this slice — although pure,
  they `import type` `WorkspaceTypeIndex` from the impure `type-index.mts`, which
  is not landed until step 4. They join in step 5.

**Source files to copy (absolute paths):**

- `/home/emsenn/561-group/apps/jsnode-computer/src/graph.mts` → `lib/jsnode/src/topology/graph.mts`
- `/home/emsenn/561-group/apps/jsnode-computer/src/analysis.mts` → `lib/jsnode/src/analysis/analysis.mts`
- `/home/emsenn/561-group/apps/jsnode-computer/src/domain.mts` → `lib/jsnode/src/analysis/domain.mts`
- `/home/emsenn/561-group/apps/jsnode-computer/src/role-catalog.mts` → `lib/jsnode/src/analysis/role-catalog.mts`
- `/home/emsenn/561-group/apps/jsnode-computer/src/lifecycle.mts` → `lib/jsnode/src/analysis/lifecycle.mts`
- `/home/emsenn/561-group/apps/jsnode-computer/src/dependencies.mts` → `lib/jsnode/src/analysis/dependencies.mts`
- `/home/emsenn/561-group/apps/jsnode-computer/src/consistency.mts` → `lib/jsnode/src/analysis/consistency.mts`
- `/home/emsenn/561-group/apps/jsnode-computer/src/build-order.mts` → `lib/jsnode/src/analysis/build-order.mts`
- `/home/emsenn/561-group/apps/jsnode-computer/src/spectrum.mts` → `lib/jsnode/src/analysis/spectrum.mts`

(The matching `*.test.mts` files should be copied alongside.)

**Mechanical rewrites required after copy:**

1. In every copied module, rewrite `from "@emsenn/jsnode/topology"` to the
   internal relative path. For `graph.mts` (now in `src/topology/`): `from
   "./index.mjs"`. For the `src/analysis/*` modules: `from "../topology/index.mjs"`.
   (A package cannot reliably import itself by its published name pre-build;
   `lib/jsnode` already uses relative `.mjs` imports internally — see
   `codecs/rdf.mts` importing `../topology/index.mjs`.)
2. The `src/analysis/*` modules' `from "./graph.mjs"` imports become
   `from "../topology/graph.mjs"`.
3. Add `src/analysis/index.mts` barrel re-exporting all nine modules' public
   surfaces.
4. Add the `./analysis` export block to `lib/jsnode/package.json` (`types` →
   `./dist/analysis/index.d.ts`, `import` → `./dist/analysis/index.mjs`),
   mirroring the existing `./topology` / `./codecs` entries.
5. Optionally re-export `graph`'s surface from `topology/index.mts` for
   discoverability.

**Why low-risk:** purely additive. Imports resolve against `lib/jsnode`'s own
already-built topology and its existing deps; no new package dependency, no `fs`,
no `typescript`. The apps are untouched and keep their own copies, so no
downstream consumer changes behaviour. Verifiable in isolation with
`pnpm -C lib/jsnode verify` before any app is rewired.
