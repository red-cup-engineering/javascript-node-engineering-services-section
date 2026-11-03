# JavaScript Node Operations Graph services section

This package is the home of the Node Operations Graph (NOG): a graph whose
nodes are npm-provided binaries, whose edges are typed operational relations,
and whose node operations carry explicit preconditions and postconditions.

The package currently contains design material. A repository-wide search on
2026-08-20 found three later notes that name and apply NOG, but no source module
that implements NOG directly. The material below is the direct documentary
record and extant precursor stack; it remains in its owning packages and is
recorded here so future NOG work can distinguish implemented machinery from
proposed composition.

## Notes

- `content/documents/articles/notes/2026/08/10/2026-08-10-note-on-node-operations-graph.md`
  is the direct NOG design note and the canonical starting point.
- `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/agent-computer-system-engineering-services-section/services/agent-computer-platform-system-engineering-services-section/content/text/documents/articles/notes/2026/08/19/2026-08-19-note-on-fars-as-composite-and-mash-as-its-network.md`
  places NOG as an application hosted by FARS and identifies its admission loop
  with the FARS witness pipeline.
- `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/agent-computer-system-engineering-services-section/services/agent-computer-platform-system-engineering-services-section/content/text/documents/articles/notes/2026/08/19/2026-08-19-note-on-apps-as-global-sections-of-the-service-sheaf.md`
  applies NOG's earned, contract-checked relation model to cross-service wiring.
- `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/agent-computer-system-engineering-services-section/services/agent-computer-platform-system-engineering-services-section/content/text/documents/articles/notes/2026/08/19/2026-08-19-note-on-the-four-dimensional-substrate-and-its-exchange.md`
  uses the NOG boundary when distinguishing structural identification from
  coordination.
- `lib/emsenn/services/561-group/services/science-services-section/services/engineering-science-services-section/services/computer-science-services-section/content/text/documents/articles/notes/2026/06/16/2026-06-16-jsnode-as-workspace-topology.md`
  describes JSNode ICK's package carriers, dependency graphs, and topology
  projection (relocated sciences-side ahead of this WP; the note's former
  engineering-side path is empty on disk).
- `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-services-section/services/computer-code-services-section/services/javascript-services-section/content/documents/articles/notes/2026/06/22/2026-06-22-survey-of-561-group-jsnode-ecosystem.md`
  surveys the package mesh from which binary nodes would be admitted.
- `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-services-section/services/computer-code-services-section/services/javascript-services-section/content/documents/articles/notes/2026/06/26/2026-06-26-research-on-the-relational-structuration-of-a-jsnode-workspace.md`
  treats a workspace as a settled dependency structure.
- `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-services-section/services/computer-code-services-section/services/javascript-services-section/content/documents/articles/notes/2026/06/27/2026-06-27-research-on-jsnode-packages-workspaces-and-sites.md`
  develops the manifest, package, workspace, and site distinctions.
- `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-services-section/services/computer-code-services-section/services/javascript-services-section/content/documents/articles/notes/2026/06/28/2026-06-28-npm-packages-git-repos-and-branches-as-coordination-carriers.md`
  studies npm manifests and workspaces as coordination carriers.
- The semiotic computer system note
  `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/semiotic-computer-system-services-section/content/text/documents/articles/notes/2026/07/08/2026-07-08-causal-carrier-categories-for-keratinous-hoare-programs.md`
  develops the causal and categorical Hoare-program basis used by the NOG
  proposal.

## JavaScript and TypeScript precursor code

- `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-services-section/services/computer-code-services-section/services/javascript-services-section/services/javascript-node-services-section/services/jsnode-packaging-services-section/services/npm-services-section/services/npm-registry-services-section/services/npm-workspace-publication-service/src/workspace-graph.mjs`
  is the current package-level manifest scanner, dependency graph, closure, and
  leaf-first tiering implementation. It does not yet admit `bin` entries as
  nodes and it flattens dependency kinds.
- `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-services-section/services/computer-code-services-section/services/javascript-services-section/services/javascript-node-services-section/services/jsnode-packaging-services-section/services/npm-services-section/services/npm-package-services-section/services/npm-package-manifest-admission-service/scripts/admit-npm-package-manifest.mjs`
  is the current immutable npm-manifest admission boundary. It validates
  dependency maps but does not yet specialize or admit the `bin` field.
- `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-services-section/services/computer-code-services-section/services/javascript-services-section/services/javascript-node-services-section/services/jsnode-workspace-analysis-services-section/services/organizing-jsnode-analysis/src/organizing/workspaces/graph.mts`
  and its neighboring `packages/carrier.mts` preserve the JSNode ICK
  carrier-backed graph implementation discussed by the older notes; both now
  live in `organizing-jsnode-analysis`, the consolidated winner of the former
  3-way `organizing-with-jsnode` fork. Their former neighbor
  `workspaces/consumption.mts` no longer exists anywhere — it is one of the
  two legacy filesystem-reading scanners `organizing-jsnode-analysis`'s
  `DEPENDENCY-BOUNDARY.md` documents as intentionally not relocated, so that
  citation is now historical. `workspaces/edge-relation.mts` survives, parked
  outside the analysis closure proper, at
  `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-services-section/services/computer-code-services-section/services/javascript-services-section/services/javascript-node-services-section/services/jsnode-workspace-analysis-services-section/services/organizing-jsnode-analysis/unmerged/src/organizing/workspaces/edge-relation.mts`.
- `lib/emsenn/services/561-group/services/engineering-services-section/services/computer-services-section/services/computer-code-services-section/services/javascript-services-section/services/javascript-node-services-section/services/jsnode-workspace-analysis-services-section/services/jsnode-computer/src/graph.mts`, `build-order.mts`,
  `consumption.mts`, `symbol-graph.mts`, and `type-flow.mts` preserve the older
  dependency, consumption, symbol, and typed-flow graph implementations.

## Formal and semiotic precursor code

- The active Obsmetrologia tree at
  `lib/emsenn/services/561-group/services/science-services-section/services/information-science-services-section/services/math-services-section/services/obsmetrological-services-section/lib/obsmetrologia/Obsmetrologia/`
  contains the cited fixed-point, causal-order, predication, FOUR, Chu, CHL,
  Yoneda, and keratin proofs.
- The sibling Obsmetrologia services `hoare-program-carrier` and
  `finite-program-measurement-service` contain the proved `Program` carrier and
  the JavaScript finite-Hoare measurement protocol respectively.
- The semiotic computer system's `relation-model-notation-service` and
  `relation-model-notation-eval-service` contain the RMN term grammar and
  evaluator.
- Its `punctuated-name-derivation-service` compiles the SRN punctuation used by
  the proposed generation, witness, and obstruction edge vocabulary.
- Its `proof-path-structuration-service` implements earned-path admission, and
  `capcell-manifest-fabrication-service` supplies the capability-cell boundary
  model considered by the design note.
- The archived AOG implementation is in
  `lib/emsenn/services/561-group/services/engineering-services-section/lib/legacy/2026-06-17-archive-emsenn-net/src/lib/code/2026/03/11/topical/philosophy/relationality/app/relationality/`:
  `models.py` defines `RecognitionObject`, while `aog.py` and `graph.py` provide
  Aperiodic Operator Graph construction and graph operations.

These are sources and antecedents, not dependencies declared by this package.
NOG still lacks its proposed binary admission, PURL-plus-bin identity,
contract attachment, and typed-edge composition implementation.
