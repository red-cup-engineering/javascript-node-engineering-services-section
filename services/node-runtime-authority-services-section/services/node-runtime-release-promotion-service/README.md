# Node runtime release promotion service

This service atomically moves a deployment pointer such as `current` to one
verified release digest.  The displaced target, a digest or a hand-placed
release directory, is retained at `previous`, and
each transition is recorded as a JSON receipt.  Selecting the previous digest
is an ordinary promotion and therefore produces its own rollback receipt.

`scripts/release-git-commit.mjs` runs the same archive, materialize, install,
promote, unit, restart, health, rollback, and retention sequence through either
transport. A named host uses SSH. `"host": "local"` (or no `host`) runs on this
machine with paths relative to its home directory and pipes `git archive` into
a local `tar`. Install, verify, and a missing unit file fail before promotion.
Any failure after promotion (backup, unit install, restart, health) returns
`current` to the displaced target, reinstalls the unit it ran under, and
restarts it.

A local deployment can also declare `runtimes`, each with `{ name, file,
project, health, healthExpect? }`. These are independent processes sharing
installed release artifacts. Their units start from
`<releaseRoot>/runtimes/<name>/<project>`, rather than the platform's `current`.
Admission compares the project's released contents and the installed dependency
closure against that process's own binding. Source identity uses the existing
Git archive selection; installed external packages are checked by content.
This comparison conservatively includes entire packages, assets and installed
peers. A change anywhere within those packages can require a restart.

An unchanged process keeps its pointer and connections while the platform
receives a new release. Changed runtimes receive the admitted tree, their unit,
and a health check. A failed receiver returns affected pointers and units to
their previous bindings; untouched processes remain running. The established
closure is recorded in the materialization receipt so admission and promotion
do not repeat its derivation. Every independent binding retains its immutable
tree beyond the platform's two-release rollback history. Removing a runtime
from the declaration does not revoke its running service or delete its tree;
deliberate retirement must stop the service and remove its binding.

`unit.socket` (`{ file, name }`) adds the service's socket-activation unit.
systemd then holds the listener, so the restart queues connections instead of
refusing them. The service unit names the socket with `Wants=` and `After=`,
so restarting the service starts the socket first; the service reads
`LISTEN_FDS` (`inheritedListenFd` in `http-services-section`). A changed
socket is rebound on that restart. A rollback reinstalls the socket the
displaced release ran under, or removes it when that release had none.

The same script releases from a release as well as from a checkout:
`--repository <checkout> --spec-in-commit <path>` reads the spec from the
commit being released. Several things hold on every release:

- Only one release runs per release root. `.release.lock/lease` carries the kernel lease.
  Linux `flock` holds an advisory lease on the target host until the release exits. Concurrent releases wait up to `lockTimeoutSeconds` (900 seconds by default). The lock inode stays in place; a legacy `holder.json` or lock file requires owner review and is never stolen based on age.
- A commit whose bytes are already running changes nothing.
- Released files are made read-only before promotion.
- Any failure writes `receipts/<time>-<commit>.refusal.json`.

Materializing bytes that already have a release directory re-hashes that
directory. If it was edited in place, it is moved to
`.drifted-<digest>-<time>` and replaced by the committed bytes.

`src/reconcile-release.mjs` keeps a host released from a branch. Each pass is
level-triggered and does one of the following:

- releases nothing when only unarchived paths moved, or when the running
  commit is ahead of the branch;
- waits out a settle window;
- does not retry a refused commit;
- retries a release that was interrupted. When a step is ended by SIGTERM,
  SIGKILL, SIGINT or SIGHUP (from a memory killer or a shutdown), the release
  writes `*.interruption.json` instead of `*.refusal.json`.
- starts one release in a transient user unit, which survives the restart it
  performs.

Each pass leaves its reading at `<releaseRoot>/status.json`. The 561 Group
runs it as the `node-release-reconcile` operation on a node's work clock.

## Native source reader for release-machine consumers

Code owns the original `readNodeWorkspace` and `workspaceSourceReader`
implementations in `src/read-workspace-source.mjs`. External Engineering
consumers, including the Guix release controller's native baseline/candidate
comparison, import the **published package interface**:

```js
import {readNodeWorkspace} from
  '@red-cup-engineering/node-runtime-release-promotion-service/read-workspace-source';
```

This is the existing Git-committed recursive source reader, not a Guix-local
copy, a source inventory, a lockfile substitute, or a certification receipt.
Run it on a genuine admitted checkout **after** native frozen PNPM installation
with the source owner's declared PNPM executable. A caller must retain the
Git-backed importer/source identities, reject mutation using `reader.verify()`,
and separately qualify test execution, LAGOON artifact construction, deployment
and independent target receiving. No source read by itself grants a merge,
release, billing authority or production activation.

## Fabricate the authoritative recursive workspace

The LAGOON production path uses Git's recorded recursive source owners, the
root `pnpm-workspace.yaml`, `.npmrc` and unchanged native `pnpm-lock.yaml`.
The caller acquires those Gitlinks with ordinary recursive Git checkout and
runs the exact PNPM version declared by the root `packageManager`. It installs
with `pnpm install --frozen-lockfile` and the workspace's existing build policy.
There is no selected-install receipt, relocated source lock or separate
source-inventory authority in this path.

The existing Code command entrances take the real source root directly:

- `generate-workspace-artifacts --workspace ROOT [--pnpm EXECUTABLE]`
- `generate-workspace-typescript --workspace ROOT [--pnpm EXECUTABLE]`
- `compile-node-runtime --workspace ROOT [--pnpm EXECUTABLE] [--runtime OUTPUT] [--entry MODULE...]`
- `assess-node-runtime-source --workspace ROOT [--pnpm EXECUTABLE] [--entry MODULE...]`

When the caller selects a consumer with a native PNPM dependency filter, source
assessment, generation and packed compilation receive that same `--filter`.
They retain the recorded recursive workspace and authoritative root lock.

Generation can retain its complete pre-emission plan with `--plan-output FILE`
outside the workspace and emit from that same calculation. Explicit publication
whitelists must cover declared entrances; known source or publication gaps refuse
emission before any producer runs. Native packing still receives ignore rules and
actual installed file contents.

PNPM supplies the complete workspace inventory with its native recursive list.
The source reader checks the committed root and recursive Gitlink topology,
including staged pins and changes to `.gitmodules`, before consuming sources.
The package-manager version and source configuration remain those of the owner.

The aggregate generation command retains the declared TypeScript and
source-product contracts described below. The caller then uses ordinary
`pnpm --filter PACKAGE deploy --prod OUTPUT` and compiles that packed output
with `--workspace ROOT --runtime OUTPUT`. PNPM derives its own deployment
product lock without changing the committed source lock. Native dependency
builds retain the existing `allowBuilds` policy; do not suppress scripts during
deploy and assume that built binaries from the first install will be reused.

Generation and compiler results describe actual outputs and diagnostics; they
are not externally supplied deployment prerequisites. LAGOON and native Guix
own construction and production generation changes. The older selected-install
utilities are outside this production route and must not be used to recreate
its source or lock authority.

### Receive manifest changes before source integration

`qualify-workspace-lockfile --repository <checkout> --commit <source> --spec-in-commit <release-spec> --state-dir <outside-source>`
uses the existing committed-manifest owner. It reads the source's release declaration,
derives the complete workspace lock with that declaration's package-manager command,
then runs its frozen install step with `--lockfile-only --ignore-scripts` against
the exact derived lock and unchanged manifest projection. Only the frozen-received
bytes can enter `deriveIntegration`. The package manager still owns dependency
resolution and its policies. A source hook that the manifest projection cannot carry
is refused. No hand-authored lock patch is treated as a received resolution.

`--plan-only` lists the immutable source manifest/blob identities without
bootstrapping packages, checking out bodies, fetching missing mounts or running
the resolver. Missing local source objects are an explicit obstruction. Qualification
retains the existing owner's missing-object fetch behavior; it does not initialize
unrelated runtime checkouts or execute application source.

The integration queue automatically supplies the real release install declaration
and keeps derived candidates in its existing queue state. The CLI retains them in
the explicit external state directory. A retry after a receiving failure reuses
the identity-bound derived lock, but always repeats frozen receiving in a fresh
source projection. Different source inputs, command arguments or executable/explicit
JavaScript entry bytes select a different artifact; modified retained bytes,
redirected files, changed source inputs and a competing qualification lease are
refused. Retained candidate metadata is derived cache evidence, never authority or
acceptance. The same kernel-flock lifetime used by release promotion releases the
lease when the controller dies. A busy/lost lease or signaled process leaves source
work pending, rather than refusing its candidate. Atomic single-record cache
publication cannot expose mismatched lock/input pairs. `--rederive` explicitly
re-resolves after changed external configuration or a repaired supplier; changing
the executable bytes also invalidates reuse automatically. The operation accepts
explicit argument arrays or simple quoted invocations, and refuses shell control
operators/expansions instead of interpreting a fragment of a release command.

The CLI returns the artifact path; its `pnpm-lock.yaml` remains outside source.
Publishing it still uses the existing source-transformation and independent
receiving route. This receives the dependency derivation only. Full selected
installation, LAGOON assembly, Guix build and runtime receiving remain their own
actual operations and must consume the reviewed source change.

## Independently scoped source receiving

A source delivery declares the original `sourceBase` of its entire intended
change and its exact source commit. `nameCandidateSync` binds that base, source
commit, before/after trees and SignStuff semantic identity in the annotated
proposal. No base is inferred from current receiving history. For a multi-commit
delivery, supply the base before the first intended change.

```sh
node scripts/land-candidate.mjs --name producer/slice --source-base <original-base-object-id> --commit <source-object-id>
```

`--origin` transports the same declaration in an immutable commit envelope on
`queue/<name>`. Local and remote deliveries compose the same tree effect.
`landPathsSync` declares the published base it used; worktree production pins
the fetched base before replay; branch intake requires `sourceBase` explicitly. Duty work records the base when
first prepared and preserves it across close/resume. An older duty with no
recorded base requires an explicit `sourceBase` on `duty-worktree-integrate`;
a declaration cannot replace an already recorded base. Directory transactions
carry their before-source into the same receiving route.

The receiver composes against that declared base, retains current unrelated
changes, and creates a commit whose sole parent is the receiving head. Producer
ancestry remains provenance; it neither enters main nor proves another delivery
was fulfilled. Every candidate receives its own judgment. Derived paths retain
receiving contents until the independent derivation step. Unknown legacy scope
and substituted source are refused before release admission; recover and declare
original intent rather than guessing a base.

The controlled native demonstration in
`test/source-transformation-receiving.test.mjs` reproduces ancestry importing
retired machinery, then observes the scoped consumer effect while preserving
receiving state, binary data, executable mode and symlinks. The controlled duty consumer exercise in
`computer-code-development-engine/test/source-delivery-custody.test.mjs` follows
original source through open, commit, close, resume and independent receiving.
Controlled examples establish those effects; they do not establish production
work acceptance.

### Accepted development to source receiving

prepareSourceDeliverySync (./source-delivery) consumes the exact accepted
SoftwareMissionChangeProposal, its addressed proposal identity, its territory
and the explicitly declared original sourceBase. It verifies Git preimages and
output bytes, preserves regular-file mode and refuses another carrier, parent
replacement or overlapping paths. It constructs immutable Git objects without
taking source from or modifying checkout, index or HEAD.

Preparation creates no queue reference. Its activate() names the prepared
candidate through the existing independent receiving route. AOE supplies that
effect only after consumer acceptance and current authority. Reconstructing the
same delivery retains the same commit and candidate name; independent receiving
still judges it against current source. Candidate identity is not semantic proof
or deployed-operation evidence.

## Required native product realization

The owner specification [Required runtime products](content/text/documents/specifications/required-runtime-products.md)
proposes for source integration the required evolution of the native aggregate: one consumer-rooted
source/product plan, explicit owned inputs and complete outputs, dependency-first
realization and exact supplier-instance identity. It allocates source projection,
declaration resolution, planning and emission to the existing components.

The implemented three-field module and build-script-derived TypeScript routes
below are the current transition interface. Production adoption of the new
contract requires the actual owner declarations, compiler inputs and caller to
migrate together and pass the specification's receiving stages. The specification
does not claim that an optional planner or an abstract test already replaced them.

## Source interface assessment

`assess-node-runtime-source --workspace ROOT` assesses the exact committed
recursive workspace module family using PNPM's source-owned membership. It does
not install application dependencies or change the root lock. Run it after the
caller's frozen installation has supplied the existing source-analysis tools. It uses the published
package entrances, native ESM resolver and JavaScript module corpus; its receipt
retains Git identities, the finite module graph, demanded names, declaration
locations, constructor/function parameters and authored JSDoc. Missing owned
carriers or bindings refuse assessment. Registry interfaces, computed
dynamic imports, unsupported syntax and products of declared TypeScript recipes
remain explicitly unreceived; source assessment does not manufacture an emitted
file or establish execution/resource guarantees. The real TypeScript producer
and installed compiler must discharge those remaining interfaces afterward.

Installed static compilation follows genuine vendor ESM declarations only for
star re-exports. Ordinary vendor imports remain external, and the compiled
output stays in memory. Both compilation success and refusal retain inspected
modules; refusal receipts preserve diagnostics rather than losing the family
scope. These receipts are source evidence, not a package or operating verdict.

Source-product modules declare `nodeRuntimeGeneration` with exactly `module`,
`export` and `outputs` in their owning package. `generateWorkspaceArtifacts`
first receives the existing TypeScript products, then calls those declared
exports with the exact recursive workspace `sourceRoot`, a Git-authenticated UTF-8 `read`
operation and the actual publication instant. The module returns precisely its
owned `{path,text}` products; the native writer alone records and writes their
bytes. Undeclared/duplicate outputs and self-output reads refuse. Input records
retain their original source commit, blob and digest. Shell recipes, optional
examples, application execution and a generated-directory census are excluded.
Source assessment reads the same declaration and authenticates the producer
module; only its exact declared paths qualify as future module products. The owning caller
packs these products through native PNPM and gives the resulting tree to LAGOON
for Guix construction; no separate emission receipt is an activation input.

## Selective packed-package receiving

`receive-packed-packages --workspace ROOT [--pnpm EXECUTABLE] --runtime OUTPUT`
receives only the real packed root consumer's committed `receivingPackages` list.
Each selected source owner declares explicit `receivingTests` and optional
`receivingFixtures` paths. Every selected manifest, test and fixture is admitted
against native committed source before any test runs. Missing or empty selection
returns `not-enrolled`, `satisfied: false`, with zero executed checks.

The operation uses the caller's current pinned Node, records its real executable
and version, and runs each explicit file with `--test --test-reporter=tap` in its
packed package. It never runs npm scripts, discovers an implicit all-package suite,
or accepts a command/environment override. Each file has a 180-second and 64-MiB
output bound. A dedicated Linux process group cleans up its CLI children on timeout,
cancellation, overflow and leader exit. Inherited credentials and Node loaders/test
controls are stripped. This cleanup is not a sandbox: enroll only reviewed offline
fixture cases, never live HTTP providers, purchases or publication effects.

Nonzero/process/TAP failures, all-skipped/empty cases and identity drift refuse with
ordered observations. Later checks remain explicitly unexecuted; partial skips are
reported. Both source and packed identities are rechecked before and after execution.
Results are observations, not a new source, installation or deployment authority.
The source-owned component contract and extraction history are in
`specifications/packed-package-receiving.md` and
`specifications/packed-package-receiving-provenance.md`.

The owning caller may invoke this generic command after its ordinary PNPM packing
and static compilation, before construction. This component does not modify that
caller, enroll any product package or activate a deployment.
