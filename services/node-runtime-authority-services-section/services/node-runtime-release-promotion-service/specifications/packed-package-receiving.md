# Selective native packed-package receiving

## Allocation and scope

World requirement: the consumer must receive the explicitly selected, reviewed
package checks against the actual PNPM output before handing it to construction.
The consumer owns selection, the selected source owner owns check/fixture paths,
Git and the native workspace reader own source identity, and PNPM owns placement.
This operation produces observations, not an installation or deployment authority.
Static compilation remains separate and never executes application tests.

Expectation E1: the caller has performed its ordinary frozen native installation,
source generation, PNPM deployment and static compilation. The caller invokes this
operation using its existing pinned Node. E2: every selected test and its dependency
effects have been reviewed as offline, bounded fixture work. Environment cleanup
is not isolation. HTTP providers, purchases, publication, credentials and persistent
user-state effects are outside this allocation. E3: exclusive custody of the source
and packed tree during receiving is supplied by the caller; boundary checks detect
persistent drift, not an adversarial change-and-restore race.

These expectations plus admission of all declarations before execution, bounded
explicit execution and final identity verification establish only the selected
package obligation. They do not establish whole-forest or live operating effects.

## Interface and domain

receivePackedPackages({workspace, pnpm, runtime}) accepts only these keys. workspace
and runtime are nonempty paths; pnpm is the existing native package-manager tool.
It admits source through readNodeWorkspace without any substitute inventory.
The real packed root's source manifest owns optional receivingPackages. Missing or
empty selection is an explicit not-enrolled result, never broad discovery/execution.
Package names are unique canonical unscoped/scoped names in declaration order.
Each selected owner supplies nonempty receivingTests: unique slash-separated
relative regular-file paths, with no dot components, wildcards or symlinks.
The optional receivingFixtures declaration is subject to the same path and byte
ownership checks; absence means no declared fixture requirement.

The source/packed root manifests must agree on name/version/type/exports/bin/main/
files and exact receivingPackages. Selected manifests must additionally agree on
receivingTests/receivingFixtures. PNPM dependency rewriting remains native.
Source and physical packed provider identities must each be unique; aliases to the
same physical package are one provider. All package links remain inside runtime.
Tests and fixtures must be exact committed regular-source bytes in the packed owner.

## Obligations and failure distinctions

- PR-01 shall admit native Git/source configuration/PNPM membership through the
  existing reader. Omission admits unauthenticated checks. Scenario: dirty source.
- PR-02 shall bind selection to the unique real packed root's committed owner.
  Omission lets a packed edit select effects. Scenario: edited/null/duplicate list.
- PR-03 shall resolve only explicitly selected unique source/physical providers,
  traversing native root, top-level modules and nested .pnpm modules. Omission
  misses transitive owners or executes aliases twice. Scenario: nested/alias/escape.
- PR-04 shall admit every selected manifest, test and fixture before first execution.
  Omission creates effects before a later missing/changed input is known. Scenario:
  second selected owner has invalid declaration, absent fixture or changed test.
- PR-05 shall use only the current canonical Node executable after version agreement
  with process.version, with arguments --test --test-reporter=tap FILE and package
  cwd. Omission executes scripts/hooks or another interpreter. Scenario: unused hook.
- PR-06 shall sanitize inherited execution controls and credentials, retaining only
  PATH, bounded NODE_OPTIONS and temporary-directory/locale keys from the prior
  Guix runner. Omission permits inherited loaders/secrets. Scenario: hostile env.
- PR-07 shall bound every file to 180 seconds and 64 MiB captured output, retaining
  stdout/stderr, exit, signal and serializable error. Omission loses failure meaning.
  Scenario: timeout, signal, spawn/output failure and nonzero exit.
- PR-08 shall reject failed/cancelled/missing TAP and zero executed cases, including
  skipped-only, TODO-only and Node's empty-file placeholder. Partial skips remain
  explicit. Omission turns process success into false obligation satisfaction.
- PR-09 shall stop on first unsuccessful file and retain all later files explicitly
  unexecuted. Omission obscures incomplete receiving. Scenario: first file fails.
- PR-10 shall reverify source and packed identity immediately before execution and
  after each executed file, including failed executions. Selected package tree
  bytes/modes/link identities, declarations and alias topology are checked. Omission
  allows mutation to be mislabeled success. Scenario: changed source or packed body.
- PR-11 shall return ordered result observations and throw with result on refusal,
  without writing a receipt, lock, source inventory or installationPath authority.
  Scenario: caller receives refusal details with all unexecuted obligations.
- PR-12 shall retain compiler's static-only behavior through shared traversal.
  Scenario: traversal inspects manifests but never imports unselected code.

## State machine and results

new -> admitting -> admitted -> running -> received | refused.
new -> admitting -> not-enrolled is valid with enrolled=executedFiles=0 and
satisfied=false. Admission refusal executes no tests. Every selected file starts
unexecuted. A spawned file becomes passed, failed, unsatisfied, timeout, signalled,
spawn-error or output-limit. Completed successes with partial skips retain counts.
Identity refusal after any execution dominates prior passed observations. Interrupted
processes may have had local fixture effects; there is no rollback or retry. The
caller may correct the source/output and invoke again, using the same admission.

Results retain sourceCommit, runtime, observed Node executable/version/hash, ordered
packages with test identities and outcomes, aggregate case/skip counts, satisfied,
status and refusal code/reason. Error.result carries the same observation on refusal.
The CLI prints exactly this JSON and exits nonzero for refusal; not-enrolled is a
reported successful no-op with satisfied=false, never selected receiving success.

## Refinement and verification

First derive source owners from native importerIds using reader.bytes. Traverse
only native package-directory levels, confine every link hop and deduplicate real
locations. Compare carrier fields, selection and all selected files. Snapshot root
manifest, package locations/aliases and selected package trees excluding dependency
node_modules (its package locations are independently traversed). Reverify source
and snapshot before the first run and after every run. Execute files in manifest
order. Each run parses Node TAP's top-level summary and reports all counts; a lone
file-named fallback is conservatively classified as zero authored cases.

The selected package byte snapshot bounds claims to selected trees. It neither
compares generated bytes against source nor proves vendor dependency integrity;
those remain generation/static compilation/native package-manager responsibilities.
Runtime is linear in inspected manifests plus selected package bytes for each
verification. Memory retains snapshot digests, one file read and captured output, at most
64 MiB for each executed file; total retained output grows with selected files. The Node executable digest is an observation, not a new
admission receipt or alternate pin.

Tests are derived from PR-01 through PR-12 using real temporary Git repositories,
real native source-reader admission and real Node test processes. A local PNPM
inventory fixture supplies only the version/list protocol; it does not establish
real PNPM packing. Runner interruption variants use an explicit internal resource-bound
seam to establish lifecycle/results without a three-minute wait. Real packed
Content Mill/Koios qualification remains a separate consumer integration test.

PR-13 shall terminate only the dedicated test process group and its children on
timeout, cancellation, output overflow and leader exit, then collect process/pipe
closure. Parent-only termination leaves CLI child listeners alive. Scenarios use
a real long-running grandchild, PID/listener observation, timeout and cancellation.
The native runner requires Linux process groups; unsupported platforms refuse.
Reviewed cases must not detach descendants into another process group.

A real PNPM offline installation/deploy integration case supplements the inventory
fixture tests. It commits the resulting native lock before receiving and verifies
that deployment and receiving leave that source lock unchanged.

PR-12 is also exercised through the actual compileNodeRuntime operation with genuine
esbuild, house parser, source-entrance and node-job suppliers. The same six cases
run against the untouched main compiler and the extracted compiler: native packed
root, scoped/deduplicated aliases, transitive placement, vendor externalization,
static vendor star projection, carrier refusal and real static binding diagnostics.
Test/application/vendor top-level effects must remain unexecuted. These are new
regression cases; the current service's 22 existing tests contain no compiler
operation reference. This does not claim those unrelated service suites were run.

The Linux lifecycle observer binds observed group members to PID/session/start-time
identities before signalling only the spawned group. Bounded closure observation
starts on the first termination attempt, before waiting for capture pipes: an
owned descendant can retain a pipe while cleanup is in progress. A signal delivery
is not termination evidence. Any still-live group is re-observed, freshly
start-bound and signalled again within the bound, covering fork/delivery races.
After leader/pipe closure the operation requires a complete group with no live tasks: each remaining process must be Z/X
with num_threads=1, and a complete second scan plus per-member start/count re-read
must agree. A zombie leader with other threads is not terminal. Retained terminal
single-task zombies do not require PID1 reaping. Absent groups are also terminal.
A five-second bound refuses unreadable, incomplete or nonterminal observations.
Platforms without the observer refuse. No environment, command line, fd contents
or network probe is read/performed. Reviewed tests must not escape the group or
transfer descriptors to another group.

This criterion is derived from Linux v6.18 kernel/exit.c: exit_files precedes
exit_notify, which sets EXIT_ZOMBIE. pthread_exit(3) distinguishes thread exit from
release of process-shared descriptors. proc_pid_stat(5) defines starttime and the
thread count. The original bug was reproduced as leader Z + count2 + sibling R,
with its listener still live; checking only leader state was insufficient.

- https://github.com/torvalds/linux/blob/v6.18/kernel/exit.c
- https://man7.org/linux/man-pages/man3/pthread_exit.3.html
- https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html
- https://man7.org/linux/man-pages/man2/wait.2.html

If group identity cannot be admitted after spawning, the caller may terminate only
its retained direct-child subprocess handle; it does not signal an unbound numeric
group. The result is cleanup-unknown/refused, never a successful no-live-resource
claim. Leader/pipe closure has its own five-second refusal bound; inaccessible
observations are not silently retried through descriptor or privileged routes.

The controlled fork-during-cleanup regression emulates incomplete first group
delivery through an internal signal seam, then permits a real owned descendant
to fork a listening child while capture pipes remain open. Repeated termination
must receive that child and leave an unrelated sibling untouched. This is a
deterministic regression of the delivery-race condition, not a claim that the
kernel reproduced a partial SIGKILL delivery in that trial. The seam is absent
from the public operation and CLI inputs.
