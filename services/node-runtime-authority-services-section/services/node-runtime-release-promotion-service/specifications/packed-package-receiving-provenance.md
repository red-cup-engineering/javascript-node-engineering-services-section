# Source-derived extraction record

This implementation preserves the existing owners and source history instead of
reviving the retired selected-source receipt or Guix host suite mechanism.

## Native package traversal and carrier comparison

Owner: red-cup-engineering/computer-code-engineering-services-section.
Base: 32a793ab655b354f8acaaca0bc0ef8a5c22c1047.
Original component: node-runtime-release-promotion-service/src/compile-node-runtime.mjs.
Original blob: 41f6e7d87777dd52d731c7c16bf0ab0401b83ffc.

The root/top-level/nested .pnpm traversal and name/version/type/exports/bin/main/
files comparison are extracted to src/packed-workspace-packages.mjs, shared by the
static compiler and receiving operation. Added confinement checks every symlink
hop; canonical locations deduplicate aliases. Optional missing node_modules/.pnpm
is handled without inventing another package placement. Static compilation remains
static and imports no receiving runner.

## Receiving validators and sanitized environment

Owner: red-cup-engineering/guix-machine-release-service.
Base: 12dad523875403d6d9eb47177ac9dbf6149150e0.
Original: scripts/package-receiving.mjs.
Original blob: 1257b94b4b5523e02df0300129b34c174238cdfa.

receivingPackageNames, receivingTestPaths and regularFile are source-derived into
src/receiving-declarations.mjs. receivingFixtures is the approved optional reuse of
the same explicit path contract. packageReceivingEnvironment is source-derived into
src/bounded-node-test.mjs, preserving bounded NODE_OPTIONS, PATH and only the
existing temporary-directory/locale keys. No sources.json, machine.json,
installationPath, selected lock, carrier receipt or Guix orchestration was copied.

## Bounded explicit Node invocation

Owner/base as above. Original: scripts/test-change.mjs.
Original blob: 719ec5e04f259f60b71b82e42252f6de73ce4bf3.
Original operations: runTests/runPackageTests (lines 193–205).

The invocation keeps the native Node executable, --test --test-reporter=tap FILE,
package cwd, 180-second per-file and 64-MiB output bounds. Boolean-only results are
refined into explicit process/TAP outcomes and zero-case refusal. The parent-only
synchronous timeout is replaced with a dedicated Linux process group, bounded
asynchronous capture and cleanup on interruption or leader exit. This is necessary
because reviewed suites spawn CLI children. Group escape is excluded by offline
review; the operation is not a network or adversarial process sandbox.

Historical Guix c01e4ef1124231774c1bb4c784cad50b8c0b9b61 removed host suite execution;
this extraction does not restore it. Execution remains explicitly consumer-selected
and off-host before construction.

Suggested commit attribution:

Extract native selective packed receiving from Code compiler and Guix runners

Source-derived-from: Code 32a793ab655b354f8acaaca0bc0ef8a5c22c1047 / 41f6e7d87777dd52d731c7c16bf0ab0401b83ffc
Source-derived-from: Guix 12dad523875403d6d9eb47177ac9dbf6149150e0 / 1257b94b4b5523e02df0300129b34c174238cdfa
Source-derived-from: Guix 12dad523875403d6d9eb47177ac9dbf6149150e0 / 719ec5e04f259f60b71b82e42252f6de73ce4bf3
