# JavaScript Node services section

This section owns services for observing, analyzing, packaging, and operating
JavaScript Node systems, and apps that compose those services into authored
interfaces.

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

The operation is the morphism, not its TypeScript annotation. Its domain and
codomain are JSON Schemas over named JSON carriers; a source operation takes
one admitted carrier and returns one admitted carrier. An executable script
contains one such operation and delegates NDJSON transport to
`runJavascriptNodeOperation`. JSON Schema is the contract: TypeScript
declarations are not an execution dependency, publication surface, or source
of truth.

These directories are evidence about phase and ownership, not a substitute for
an operation contract. A composable operation should additionally name:

- its input and output carrier identities;
- its precondition, postcondition, and preserved frame;
- its effect class and changed world;
- the witness or receipt by which the claim can be checked;
- its owning package export and, when executable, its `package.json#bin` face.

Apps should encode their composition as importable data as well as executable
code. That makes wiring available to graphing, validation, interface
generation, and documentation without asking those tools to reverse-engineer
source. A carrier match may propose a connection, but only a checked witness
admits it. Failed gluing remains an explicit obstruction.

NOG lives at `apps/nog` and is the first local app to expose this composition
description directly.
