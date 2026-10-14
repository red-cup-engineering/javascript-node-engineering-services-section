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

## Install a selected closure from a real checkout

`scripts/install-workspace-selection.mjs` owns the dependency-install step for
a selected host or development service. It takes an existing Git checkout; it
does not copy application source, make a release, promote a pointer, restart a
service or modify the checkout's full lockfile.

From the checkout root, with Node and pnpm 11.19 or newer already installed:

```sh
installer="$(find lib -path '*/node-runtime-release-promotion-service/scripts/install-workspace-selection.mjs' -print -quit)"
node "$installer" \
  --workspace "$PWD" \
  --selector '@561-group/cold-red-gate-host-deployment...' \
  --state-dir "$HOME/.local/state/561-group/selected-installs"
```

The selector must include the required workspace dependency closure. The state
directory must be outside the checkout. Optional `--store-dir` selects the
normal pnpm content-addressed store; `--pnpm` selects an already-installed
executable. `--prepare-only` prepares the selected artifact without installing
the application, but still installs the frozen lockfile tooling.

The implementation delegates project selection to `pnpm list` and lockfile
parsing, graph filtering and serialization to the official
`@pnpm/lockfile.fs` and `@pnpm/lockfile.filtering` libraries. Their exact direct
versions and complete transitive integrity records are kept in
`data/selected-install-tools/`. This separate toolchain is bootstrapped with
a frozen lock and ignored scripts, carrying the source's configured supply and
build policies. It is not another source workspace or package graph analyzer.

pnpm 11 verifies every package in its wanted lockfile, even during a filtered
install. Merely dropping package records also leaves unselected importer
references that its pruning phase visits. The selected installation therefore
uses both:

- a generated external lockfile with only the selected complete graph, retaining
  every selected version, integrity and peer snapshot
- explicit `--workspace-packages` arguments matching that selection, while
  retaining the source workspace's configuration and policies

Only importer keys are rebased to the external lockfile directory. Existing
workspace `link:` references still resolve to the actual source directories.
Each selected package receives normal pnpm dependency links; the generated
virtual store lives beside the external lockfile. The committed full lock must
match HEAD and remains unchanged. Source manifests and configuration are checked
again after installation.

The result is a `NodeRuntimeWorkspaceSelectionInstallReceipt` containing the
source commit, input hashes, selector, importer paths, exact command, artifact
hashes and outcome. Generated state contains a pinned tooling directory and
content-addressed selection directories. Keep that state while using the
installation: source dependency links point into its virtual store.

This bounded path refuses hooks, patches, local file dependencies and
package-local source references whose relocation is not implemented. It also
refuses incomplete workspace closures or changed locked records. It never
turns off supply checks, changes checksums, downgrades pnpm or resolves around
a missing selected dependency. Dependency lifecycle scripts remain ignored;
any required build step is separate.

The existing immutable-release promotion path is unchanged. This entry point
is for bootstrap and development from real Git checkouts. An archived release
without Git metadata is not silently treated as a checkout, and a generated
selected lock must never replace the repository's full lock.

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

### Select source before materialization

Use repeated `--importer <repository-relative-path>` instead of `--selector` to follow workspace `link:` edges in the committed lock, including root dependencies, before project discovery. This is source selection over resolved pins; pnpm still owns lock parsing, external graph filtering, supply policy and installation. `--revision <full-commit>` binds the checkout identity.

`--plan-only` reports that closure without materializing source or installing application dependencies. `--materialize-sources` adds the selected directories to an existing sparse checkout and initializes only recorded Gitlinks containing those importers, descending into selected nested mounts. It never recursively initializes unrelated children or advances an existing divergent mount. Modified mount configuration, staged pins and local selected-source changes are refused. Generated tooling and scoped locks stay outside the checkout.

On the actual four-corpus dependency proposal, the fresh sparse RelConLang selection contained 217 of 803 importers and 17 source Gitlinks; an ordinary full recursive checkout initialized 90. The selected frozen install preserved the source configuration, and the real CLI returned its 12,312-byte language manifest exactly. These observations receive that consumer preparation, not HTTP deployment or registry publication.

After a frozen selected install, use `run-workspace-selection <install-receipt> -- <pnpm arguments>` for generation and packing. It reuses the recorded explicit workspace paths and lock directory and refuses a changed revision, configuration, manifest or lock. This prevents subsequent pnpm commands from falling back to unrelated workspace discovery or silently performing a different install. The command does not establish runtime receiving.

### Observe selected deploy products

The programmatic `runWorkspaceSelection` API optionally takes `deployOutput` for the exact selected-root `--filter <name> --config.ignore-scripts=true --config.inject-workspace-packages=true deploy --prod <absolute-output>` invocation. The output must be absent, outside source, and under an existing canonical parent. Generic commands and the CLI keep their existing receipt shape.

After successful execution, the existing command receipt records `produced.directory` and `produced.files`: SHA-256 identities of regular nonredirected `package.json`, `pnpm-lock.yaml`, and optional `pnpm-workspace.yaml`. Optional absence is a null hash. The selection is revalidated after observation; failure returns no successful receipt and leaves partial-output cleanup to the enclosing caller. These are PNPM's observed root products, not a caller-selected inventory. The consumer must compare them before accepting normalized root metadata. They do not prove all generated runtime bodies, dependency semantics, native receiving or activation. The caller retains its existing exclusive source/build lease.


## Source interfaces before installation

Selected installation assesses the exact committed workspace module family before
installing application dependencies. `assess-node-runtime-source --selection PATH`
can receive the same source selection independently. It uses the published
package entrances, native ESM resolver and JavaScript module corpus; its receipt
retains Git identities, the finite module graph, demanded names, declaration
locations, constructor/function parameters and authored JSDoc. Missing owned
carriers or bindings refuse before installation. Registry interfaces, computed
dynamic imports, unsupported syntax and products of declared TypeScript recipes
remain explicitly unreceived; source assessment does not manufacture an emitted
file or establish execution/resource guarantees. The real TypeScript producer
and installed compiler must discharge those remaining interfaces afterward.

Installed static compilation follows genuine vendor ESM declarations only for
star re-exports. Ordinary vendor imports remain external, and the compiled
output stays in memory. Both compilation success and refusal retain inspected
modules; refusal receipts preserve diagnostics rather than losing the family
scope. These receipts are source evidence, not a package or operating verdict.
