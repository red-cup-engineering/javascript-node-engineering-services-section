# JavaScript Node Import Services Section

Engineering policy and operations for what a jsnode source file may import.
The section exists because the tree owns services for reading, writing,
walking, addressing, and executing, and a direct `node:fs`, `node:path`,
`node:url`, or `node:child_process` import where such a service exists
duplicates the service and balloons the tree (carried
in `.claude/skills/dispatch-agents/SKILL.md`, "Fabricate, do not hand-write").

- `services/audit-node-builtin-imports-service` — one operation: audit one
  source text for single-line imports of Node built-ins a house service owns,
  returning the line, the built-in, and the owning service. Fabricated
  2026-09-04 through `fabricate-markdown-jsnode-operation-package-service`
  from the work order kept in its `data/records/`; its fabrication receipt is
  filed beside it.
