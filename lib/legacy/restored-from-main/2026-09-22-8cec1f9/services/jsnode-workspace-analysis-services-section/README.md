# JSNode Workspace Analysis Services Section

Groups tooling that reads an existing JS/Node workspace into relational carriers — package facts, dependency topology, serialization — without generating or fabricating code.

## The one-architecture import gate

`.dependency-cruiser.cjs` is the one typed functional architecture's import law as a dependency-cruiser ruleset: only apps import apps; src never imports its own package's scripts; raw `node:fs`, `node:path`, and `node:child_process` only inside a registry effect owner; a relative import never leaves its package; no cycles; and, since 2026-09-11, no import of a package the canonical capability registry marks as superseded (rule `superseded-capability-import`, read from each registry entry's `supersedes` and from the registry's `supersededPackages`, the leaves already folded into a platform module).
The effect-owner and superseded lists are read from the registry at run time, never copied here.
`node_modules` is not followed but its edges are kept, so a rule can name the package an import resolves to.

`.dependency-cruiser-known-violations.json` is the ratchet baseline (2,912 violations on 2026-09-11 after the computer-data fold, with package edges visible: 2,851 raw-substrate, 21 src-imports-scripts, 16 apps, 12 relative escapes, 11 cycles, 1 superseded import); it only shrinks.
A new violation fails the run; a known one does not, so an edit to a file with existing debt passes until the deduplication line migrates that debt.
CI runs it in `.github/workflows/architecture-gate.yml`; both agent harnesses (`.claude/settings.json`, `.codex/hooks.json`) run it on every Write or Edit of a `lib/**` source file.
Locally, from the repository root: `depcruise --config <this dir>/.dependency-cruiser.cjs --ignore-known <this dir>/.dependency-cruiser-known-violations.json --output-type err lib` (about 30 s), or the changed files with `--max-depth 1` (under 1 s).
Regenerate the baseline only after a migration that removes violations: `depcruise --config <this dir>/.dependency-cruiser.cjs --output-type baseline --output-to <this dir>/.dependency-cruiser-known-violations.json lib`.
