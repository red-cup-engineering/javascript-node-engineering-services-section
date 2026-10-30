# Node.js engineering services section (JSNode)

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

This section owns services for observing, analyzing, packaging, and operating
JavaScript programs on **Node.js**, and apps that compose those services into
authored interfaces. Historical package identifiers and the `node` executable
retain their original spellings; a *node* meaning a host or graph vertex is
not the Node.js runtime.

## Executable and compositional shape

- `services/**/src/*` holds importable operation realizations: carriers,
  classes, pure transformations, and effect functions whose dependencies are
  handed in or explicitly named.
- `services/**/scripts/*` holds executable single-effect or
  single-transformation process apertures. A script is a thin face over an
  owned source operation; stdin, stdout, stderr, arguments, exit status, and
  effect boundary are part of its contract.
- `apps/*` holds compositions of service operations into CLI, HTTP, MCP, WebUX,
  or other selectable interfaces. An app owns the selection, wiring, and
  presentation, not the primitive capabilities it composes.

An **admitted operation** is the candidate *morphism*, not its TypeScript
annotation or arbitrary JavaScript function. Its domain and codomain are
JSON Schemas over named JSON carriers under an explicit admission context;
a source operation must accept one admitted carrier and return an admitted
result or a typed refusal. An executable script delegates NDJSON transport
to `runJavascriptNodeOperation`. JSON Schema supplies structural admission;
preconditions, postconditions, frame conditions and effects are separately
needed to claim an operational contract. TypeScript declarations are not the
execution dependency or the source of truth.

The categorical reading has **conditions**. Pure total admissible operations
can be considered as arrows between carrier types, composed only when the
codomain of one satisfies the domain of the next. To call the resulting
construction a category, exhibit identity operations, associative composition
and a defined behavior for refusals. An effectful Node.js operation is not
automatically a pure arrow: file/network/process effects, promise rejection,
cancellation and concurrent actors can leave externally visible effects even
when the return is a refusal. Those transitions require effect-indexed
contracts and independently received witnesses. A direct value equality check
alone does not prove preserved state or composition.

These directories are evidence about phase and ownership, not a substitute for
an operation contract. A composable operation should additionally name:

- its input and output carrier identities;
- its precondition, postcondition, and preserved frame;
- its effect class and changed world;
- the witness or receipt by which the claim can be checked;
- its owning package export and, when executable, its `package.json#bin` face.

Apps should encode their composition as importable data as well as executable
code. That makes wiring available to graphing, validation, interface
generation, and documentation without reverse-engineering source. A carrier
match may propose a connection, but a witnessed admission must also check
pre/postconditions, effects, authority, and source/target context. Failed
composition remains an explicit obstruction. Qualify identity, compatible
composition, refusal and interleaved effects through independent consumers;
source-level type compatibility is not a receipt of live operation.

Node.js executes the effectful side of [LAGOON](https://github.com/red-cup-engineering/engineering-services-section/blob/main/content/text/glossary/terms/lagoon.md), which uses Guix/Guile for immutable construction and target receiving. No JSNode declaration by itself authorizes deployment, confers an OS capability, or guarantees isolation from malicious scripts; the [Node.js permission-model guidance](https://nodejs.org/api/permissions.html) explicitly excludes that security guarantee. For the scientific inheritance and open categorical bridges, see [Science's functional-runtime-platform ledger](https://github.com/lenticule-science/561-theory-science-services-section/blob/main/engineering/theories/tech/theories/computing/theories/predicated-computing/theories/functional-runtime-platform/prose/teaching/explanations/what-functional-runtime-platform-inherits.md).

NOG lives at `apps/nog` and is the first local app to expose this composition
description directly.

## Earlier work

- Restored files at `lib/legacy/2026-06-16-4a3582a` (restore commit 4a3582a); `lib/legacy/2026-06-17-0b8d657` (restore commit 0b8d657); `lib/legacy/2026-06-23-ff20882` (restore commit ff20882), from the 561-group/bare-cedar-fog history.
