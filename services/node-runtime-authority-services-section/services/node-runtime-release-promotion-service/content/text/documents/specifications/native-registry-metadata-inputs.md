# Native PNPM registry metadata as a build input

Status: proposed capability-specific source decision for independent review. No root lock, production source selection or deployment is changed by this proposal. Implementation, exact whole-root supplier receiving and the acceptance below must accompany source integration. This decision does not borrow the Solidity compiler exception or authorize other external tooling.

## Requirement and observed failure

The existing native-workspace release owner fabricates one Git-recorded recursive workspace using its exact package manager, committed whole-root lock, registry configuration and build policy. Native PNPM derives the production deployment lock; no selected-install or alternate source inventory becomes authoritative.

BCF d7cda6a45c5175268927fc0f40d97858cb71d193, build 38666870408, installed source with a cached source-lock policy verdict, completed source generation and then attempted offline production packing. Verification of the different derived lock covered 566 entries. Packing failed with ERR_PNPM_NO_OFFLINE_META for @fedify/uri-template. Package content and a verdict for another lock did not provide the registry metadata required for fresh verification. Static compilation and Guix construction were not reached. Preserve this exact failure as the counterexample.

The admitted source lock e2f4869db5856edab0728bac62924f0572a87a87 has 809 importers, 1,334 package records and 1,349 snapshots. Of its package records, 1,333 are registry records and one is a GitHub forge-std tarball. A read-only diagnostic production traversal reaches 566 registry records, 463 package names, 571 peer-context snapshots and 256 workspace owners. These counts are diagnostic; they neither select acquisition membership nor prove the identity of the unretained derived lock from the failed run.

## Owner and bounded admission

The existing node-runtime-release-promotion-service owns this build-time acquisition and its input receiving. The BCF caller sequences it between ordinary frozen source installation and offline native production packing. LAGOON and Guix continue to own construction and activation.

Admit the exact PNPM 11.28.5 public API cohort below only for this owner’s build-stage registry metadata acquisition and independent material coverage check. These are proposed exact devDependencies, never production dependencies. No acquisition export, bin, host/profile declaration, application entrance or runtime import is admitted. The owning script may remain source in a package, but its third-party imports must be unreachable from every selected deployed executable entrance.

The exact cohort is drawn from PNPM tag v11.28.5, commit 68112bada403c589d360a22ae0f1c50f8b7ab576:

- @pnpm/installing.client 1100.3.15: public createResolver and makeResolutionStrict.
- @pnpm/resolving.npm-resolver 1104.2.5: public createNpmResolutionVerifier, createNpmResolver (fresh-process offline receiving with a throwing fetch port), loadMeta and registry encoding APIs.
- @pnpm/config.reader 1102.3.4: native getConfig, retaining registry/configuration precedence.
- @pnpm/lockfile.fs 1100.2.13: native wanted-lock reading, without repair or rewriting.
- @pnpm/lockfile.utils 1102.1.6: native nameVerFromPkgSnapshot and pkgSnapshotToResolution.
- @pnpm/config.version-policy 1100.2.7: native publication-cutoff and exclusion construction.
- @pnpm/network.fetch 1100.1.22: configured registry transport, including the existing proxy, CA and per-registry TLS semantics.
- @pnpm/network.auth-header 1101.1.16: existing in-memory authenticated registry routing.
- @pnpm/constants 1102.0.1: public native cache format/directory identifiers, avoiding a house-defined mirror layout.
- @pnpm/logger 1100.0.0 and @pnpm/worker 1100.4.8: explicitly pin the native peer cohort. These peers already resolved at these exact versions in the isolated supplier qualification; a future floating peer is not equivalent receiving.

The exact API packages have published registry distributions whose downloaded bytes match their registry SHA-512 integrities. An isolated eight-API fixture resolved 322 package records/snapshots and installed 310 packages with stock PNPM 11.28.5. Its public API imports execute. The three additional explicit cohort pins are already members of that fixture closure. The fixture is supplier qualification, not a substitute lock for the house, a source-tree equivalence proof for every distribution, or production closure receiving. Preserve the received licenses and notices. The final whole-root lock and actual installed owner instance must establish every dependency and peer, including external ranges, before admission.

## Why this boundary is needed

The house owner already authenticates source and delegates package semantics to PNPM. It does not implement registry metadata resolution, trust/release-age policy, authenticated routing or PNPM mirror encoding. Reimplementing them would introduce a second package-manager and supply-chain-policy implementation. Importing these exact supported APIs is narrower than adding that capability to the house or invoking an undocumented entry inside the bundled CLI.

The pinned CLI does not expose a complete persist-all-metadata operation:

- install/fetch may reuse a whole-lock verification verdict or obtain a publication time from an attestation without persisting a complete full mirror. A warm package store is insufficient.
- store add’s full metadata is filtered; it is not the unfiltered full mirror used by policy verification.
- outdated --long is importer-oriented, not the complete transitive whole-lock set. In the recovered deployed traversal it covers only 47 of 463 names.
- view/audit do not provide the required native persisted mirror closure. Cache inspection reports material already present.

The public resolver can request fullMetadata=true and filterMetadata=false. A separate public native resolution verifier can bind each recorded artifact and populate the abbreviated mirror without borrowing the resolver’s in-memory metadata. Native persistence and a fresh-process check are still required; a successful in-memory result is not proof that the mirror was written.

## Rejected native legacy-deploy counterexample

[BCF PR826](https://github.com/561-group/bare-cedar-fog/pull/826), exact 2d1795e8f98d8dd136bd00ff4c80ef7015ff4f63 over d7cda6a, changed only the caller to `deploy --legacy --prod --offline`. Its existing [run 38673360715](https://github.com/561-group/bare-cedar-fog/actions/runs/38673360715/job/116221320585) completed with failure at 2026-10-15 03:04:06 UTC: native source installation completed, then legacy deployment failed with ERR_PNPM_NO_OFFLINE_META for @red-cup-engineering/semiotic-ni-service@0.0.1 in registry.561.group's abbreviated mirror. No runtime compilation, Guix construction or activation was established. The author closed it unmerged at 03:08:33, retaining its history.

Exact PNPM 11.28.5 distribution SHA-256 e3738fda08262f74611d7a1ffc11b3e87fa52b466c07eb73211d179ebcb98810 establishes the distinction. Bundle lines 328844–328850 dispatch legacy mode away from createDeployFiles/writeDeployFiles. Lines 328934–328940 invoke installation with frozenLockfile=false, preferFrozenLockfile=false and saveLockfile=false. It re-resolves through the native installer; it does not simply copy an installed store. Normal mode writes a native dedicated deployment lock and installs it frozen. Legacy can still write the target current-install lock at node_modules/.pnpm/lock.yaml; that is a result of re-resolution, not the normal precomputed frozen wanted-lock product, and existing resolutions are not an equality guarantee.

Legacy still inherits native release/trust/build policy. It is not a trustLockfile or policy-off option. Its verifier uses the source wanted-lock identity, whose ordinary cached verdict can avoid verification work that normal deploy performs under the distinct derived-lock hash. That does not supply complete metadata, and a fresh verdict-free offline source verification or ordinary resolution can still require it, as the real failure demonstrates. Retain this counterexample; do not retry it, seed one missing package, or replace genuine derived-lock receiving with legacy mode.

## Inputs, effects and configuration

1. Use the existing readNodeWorkspace admission for the exact recursive Gitlinks, root package-manager identity, committed root lock and configuration. The new operation must not fetch source, repin Gitlinks, select another workspace or edit manifests/locks. Read the native whole lock, not the diagnostic traversal or a handwritten package list.
2. Use getConfig with the same workspace, package-manager identity, environment and native configuration precedence as the owning PNPM invocation. Retain minimumReleaseAge, its exclusions/strictness, trustPolicy and exclusions/ignore-after, minimumReleaseAgeIgnoreMissingTime, registry/scoped/named routing, registry server options, TLS/CA, proxy and auth behavior. Exact 11.28.5 defaults, not later documentation, govern. The observed default minimumReleaseAgeIgnoreMissingTime is true; this proposal neither flips it nor claims that a genuine registry omitting time must violate the existing policy.
3. getConfig is not the entire CLI hook/config-dependency initialization sequence. If custom resolver/fetcher hooks, effective globalPnpmfile, any nondefault pnpmfile, an existing default pnpmfile or configDependencies are present, either receive their exact native initialization and source custody or refuse before network acquisition. Refuse any effective tokenHelper before constructing resolver/auth helpers: the native auth API eagerly executes these commands, including configured scopes beyond the current package, so supporting them needs separate source/effect admission. Do not silently omit these execution paths. The accepted BCF snapshot has no root .pnpmfile.cjs or .pnpmfile.mjs and no such workspace declaration; future source remains checked.
4. Allowed effects are authenticated metadata reads through the already configured registries and native metadata-cache writes into a fresh caller-owned build-input directory. Reads of the recorded local source, installed tool supplier and native registry configuration are allowed. Existing credential use stays in memory; no credential creation, changed registry, token persistence, secret logging, deployment or package publication is part of this operation.
5. Native APIs classify registry records, aliases, registry-qualified versions and non-registry/Git/file/variation records. Preserve the one genuine non-registry source record through the existing native package-content route; do not send it to an invented npm package endpoint. Refuse unsupported shapes explicitly rather than silently omitting them from material coverage.
6. Request exact locked versions, without currentPkg/store-peek shortcuts or workspace substitution. Refuse policy violations and replacement versions. Native pkgSnapshotToResolution reconstructs and validates the locked location; the verifier checks URL/revision metadata binding, but only its revision-aware branch compares metadata integrity. Native installation still enforces locked package-content integrity. Material receiving additionally compares exact native resolver integrity/revision with the locked selection, including a valid historical revision rather than replacing it with the registry’s current revision. Do not hand-parse registry protocols or compare only package names.
7. Acquire both unfiltered full and abbreviated metadata. Do not share an in-memory metadata cache between the full resolver and artifact-verifier passes. Use genuine native cache writes only; do not write a house packument format, synthesize timestamps, trim substitute metadata, or manufacture lockfile-verified.jsonl verdicts.
8. Allow native asynchronous persistence to finish through natural process completion. A distinct process then uses public loadMeta with eager hydration and native offline resolution/verification to establish all admitted package/version coverage. Missing/corrupt fragments, absent selected versions or wrong artifact binding refuse. No forceful process.exit after apparently successful resolution.
9. Bind the retained metadata bytes and native relative paths by digest to the admitted source/Gitlinks/root lock, exact installed API/CLI supplier closure, effective non-secret policy/routing identity and acquisition interval. Do not serialize raw configuration, auth headers, credentials or credential-bearing URLs. Keep full package metadata within the existing build-input custody, not in repository comments or public receipts. Record no network responses merely to create a log.
10. Offline freshness means material received at the recorded acquisition observation for that source and policy. Offline construction cannot discover subsequent registry unpublishing, revocation or trust changes. Do not invent a TTL or claim contemporaneous online knowledge from immutable input.

## Construction and acceptance

After acquisition, stock PNPM still derives and installs the runtime product using deploy --prod --offline and the existing allowBuilds policy. The caller supplies a fresh metadata-only copy of the retained input and the legitimate package-content store, excluding any inherited lockfile verification verdict. Construction has network denied. Registry acquisition is not an online fallback inside construction.

Required receiving, before claiming the capability is complete:

- Actual whole-root metadata coverage using the final recorded recursive composition and its unchanged native source lock. Every registry record and platform/optional/peer case must be accounted for; fixture counts or a single package are insufficient.
- Separate-process complete native mirror hydration after acquisition. Validate both mirror classes and all selected versions/artifact identities. Natural completion must prove persistence, including native best-effort write failures.
- Policy-preserving, network-denied stock production deploy with a fresh metadata copy and no cached verdict. Retain the actual derived runtime lock and demonstrate an uncached policy verification. Compare its complete registry resolution identities to the admitted whole source through native APIs; do not substitute count equality.
- Negative cases: absent full mirror; absent abbreviated mirror; missing selected version; corrupt/truncated mirror; modified time/artifact data relative to retained digests; same URL with wrong integrity; wrong registry, source/lock, supplier or policy binding. Qualify a valid historical revision as a positive case. Each invalid input must refuse before admission. A genuine registry’s omitted time remains subject to the existing native missing-time policy; tampering with retained material is independently a digest failure.
- Reproduce the original cold-metadata/warm-content-store/source-verdict failure. The correct material must fix that construction input, without a single-package cache warm, online fallback, fabricated verdict or weaker policy.
- Source lock bytes remain unchanged throughout fabrication. Existing native dependency builds are neither globally disabled nor presumed reusable from source install. The isolated supplier-inspection fixture’s ignore-scripts option is not part of production deploy.
- Inspect the actual production pack and every selected executable entrance: no acquisition API package, peer, build-only invocation or compiler may leak into the deployed closure. Run the unchanged static runtime compiler and original release receiving obligations. An API devDependency label alone is not exclusion proof.
- Preflight every declared compiler entrance in the coherent composition. Receive the proper-owner market serve/pre-switch/installed checks and caller paths. Remove only the separately source-proven retired pack-closed-segments entrance; preserve the historical state-writer drain safeguard. Do not repair metadata and knowingly rerun a composition with missing check entrances.
- Existing exact-head machine change-test/no-regression, native Guix construction and receiver activation checks remain independent requirements. A source decision, local tests, branch, merge or successful lock resolution does not establish deployment.

## Review and change boundary

Review this decision with its narrow norm cross-reference, owner source, exact supplier declaration, tests and caller sequencing. Before that review, do not amend the authoritative root lock. After the owner change is reviewed, use the existing ordinary whole-root lock receiving path; no fixture lock is copied into the house. A changed PNPM version/API cohort, owner, registry/config semantics, output format, effect boundary or runtime use requires renewed source review.

Evidence: https://github.com/561-group/bare-cedar-fog/actions/runs/38666870408/job/116200910082 ; https://github.com/pnpm/pnpm/tree/68112bada403c589d360a22ae0f1c50f8b7ab576/pnpm11 . CD52 and CE406 only receive the separate CI lockfile checker and do not satisfy this material-input obligation.

## Normal launch and output custody

The actual caller must select the admitted Node executable and reject unsupported
Node argument, preload, loader, search-path and preserve-symlinks controls before
starting this source-only owner. The owner's own assertion is diagnostic: it
cannot undo a preload that ran before its first statement. Ordinary native policy
and authentication environment stays intact. The owner admits a normal no-extra-
arguments invocation, binds the actual Node executable, and checks the exact PNPM
launcher shebang plus uncached PATH Node resolution against that same interpreter.
Empty or relative PATH entries are refused because the owner and native inventory
run with different working directories. The prepare parent checks its own launch
arguments before spawning children, so unsupported flags cannot disappear during
process transition. The existing source reader and native CLI entrance remain unchanged; no wrapper,
new interpreter, environment-sanitizing fallback or competing sandbox is added.

Acquisition output must have a canonical existing parent and be disjoint from the
admitted source. Existing ancestor symlinks are refused before output creation.
Receiving and later verification use the same rooted discipline, refuse symlinked
receipt/cache roots and unexpected root entries, and retain ordinary mirror-file
link refusal. A lexical outside spelling that aliases the source is not an outside
build-input destination.

The bounded supplier-layout admission also refuses an existing duplicate ancestor
node_modules/node_modules slot. Native Node skips that search position, whereas
the shared runtimeFingerprint walks all ancestors. Uncached absence checks close
this demonstrated discrepancy for the admitted cohort without altering the shared
helper or claiming protection against arbitrary-host/filesystem races outside the
immutable-source, admitted-installation and clean-invocation receiving model.
