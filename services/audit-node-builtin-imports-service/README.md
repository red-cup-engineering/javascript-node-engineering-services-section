# audit-node-builtin-imports-service

Audits one JavaScript source text for single-line imports of substrate modules (Node built-ins or third-party
packages) that a house service owns or should own, exempting the owner itself. A table value of `null` names a
substrate with no house wrapper yet: the finding is "build the wrapper upstream".
