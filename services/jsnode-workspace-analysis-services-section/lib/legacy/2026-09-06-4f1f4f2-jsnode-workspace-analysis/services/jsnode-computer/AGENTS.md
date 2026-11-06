# AGENTS — @red-cup-engineering/jsnode-computer

Node workspace computing: reads package.json manifests into jsnode-topology carriers, discovers all workspace packages, resolves dependency structure.

## Before touching this package

- Read `package.json` — the `description`, `exports`, and `dependencies` are the contract.
- Run `pnpm run check` before any edit; `pnpm run check && pnpm run test && pnpm run audit:boundary` before committing.
- Tests are theorem-shaped: the test name is a claim the test proves.

## Key dependencies

- `@red-cup-engineering/javascript-computer`
- `@red-cup-engineering/jsnode-topology`

## Public surface

- `@red-cup-engineering/jsnode-computer`
- `@red-cup-engineering/jsnode-computer/workspace`
- `@red-cup-engineering/jsnode-computer/cli`

## Invariants to preserve

- This package performs no I/O it was not handed (fetch, clock, fs all enter as values).
- No runtime dependency may be added without a corresponding new export or documented rationale.
- `sideEffects: false` — no module-level side effects.
