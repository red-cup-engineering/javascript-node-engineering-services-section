# JavaScript argv parsing services section

This section owns transformations from a supplied JavaScript-host argument
vector to admitted command arguments. It does not own process execution,
standard streams, help rendering, or application-specific option policy.

Each transformation is published as its own package with exactly one
implementation module. That same module exports the operation and acts as the
command-line program; `exports` and `bin` must point to the same file. A second
`src/` implementation or CLI wrapper is not another face of the service. It is
duplicate evidence and does not belong here.
