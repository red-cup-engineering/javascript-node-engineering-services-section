# javascript-parser-service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Parse JavaScript modules into a syntax tree and walk it, with no dependencies.

## Quickstart

Read JavaScript source as a module syntax tree with exact spans without executing the program. See the [runnable example](examples/quickstart.test.mjs).

Run `npm ci`, then `npm test` and `npm run test:consumer`.

## Module-reference sites

`./module-reference-sites` exports `readJavaScriptModuleRequestSites(program)`
for an already admitted Program. Frozen records carry the owning AST node,
request kind, literal specifier and UTF-16 literal start/end (null for computed
requests). Nodes are borrowed. Named `createRequire` factory aliases with const
same-source loaders use existing lexical binding identities. Other origins,
mutable methods, loader-provider properties and arbitrary alias propagation are
not inferred. This API performs no resolution, guarding policy or source edits.
Publication retains its own deferred/try-boundary policy; package fabrication
retains mapping validation and atomic relocation. Original parser entry points
are unchanged. The development version is a source prerequisite, not registry
issuance or activation evidence.
