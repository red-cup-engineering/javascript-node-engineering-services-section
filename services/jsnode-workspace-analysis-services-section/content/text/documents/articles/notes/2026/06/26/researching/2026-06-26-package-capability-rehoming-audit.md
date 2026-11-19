---
date: 2026-06-26
keywords:
  - package capability audit
  - faculty stack
  - information coherence kernel
  - relational hull
status: working audit
title: Package capability rehoming audit
---
## Scope

This audit covers every workspace package except:

- `services/information-coherence-kernel`
- `lib/relating`
- `lib/communicating`
- `lib/knowing`
- `lib/playing`
- `lib/animating`
- `lib/socializing`
- `lib/computing`
- `lib/gaming`
- `lib/organizing`

The mechanically derived target set is 74 packages: 8 `apps`, 40 non-core `lib` packages, 11 non-ICK `services`, and 15 `sites`.

Evidence used: `pnpm-workspace.yaml`, every target `package.json`, the workspace README, `AGENTS.md`, and spot reads of package READMEs for the largest or most ambiguous surfaces.
The root read is:

```text
lib/      domain-specific extensions of the existing faculties
apps/     domain-specific extensions/configurations of the Information Coherence Kernel
services/ transport and runtime mounts, with ICK as the served manifold face
sites/    instantiations of those kernels; a site is a relational hull
```

## Core Reading

The better homes already exist:

- `relating` owns carrier law, schema literals, action dispatch, exact quantities, writing/transports, HTTP wire law, and the common projection machinery.
- `communicating`, `knowing`, and `playing` own the first boundary faces: utterance/linguistic admission, memory/research/cognition, and ludic cut.
- `animating` owns agency, loops, perception-action descent, and interior agents.
- `computing`, `socializing`, and `gaming` own scale-2 computation, consensus, and concurrent game/market structures.
- `organizing` owns the social-scale binder: offices, work, accounting, institutional record-state, adjudication, and the capstone facade.
- `services/information-coherence-kernel` should be the mountable served face over these faculties, not a place where domain semantics are reimplemented.

The recurring smell is not that non-core packages exist.
The smell is a package owning root semantics that its manifest says are already downstream of the core faculties.
Keep specialization; dissolve parallel ontology.

2026-06-26 correction: the `organizing-with-*` line is decommissioned as an implementation target.
Rows below that name those packages are historical audit evidence, not normative destinations.
Capabilities formerly found there must be rederived from the relevant core faculties and, for served JSNode workspace operation, from `apps/jsnode-ick` downstream of `services/information-coherence-kernel`.

## Apps

| package | current capability | better realized by | audit |
| --- | --- | --- | --- |
| `apps/discord-steward` | Runnable Discord steward with server/bot/admin parameters, autonomous tending, and Discord de-enclosure measurements. | `lib/organizing-with-discord` for Discord operation law; `lib/organizing-with-openai-agents` and `animating` for the agent loop; ICK for the runnable mounted app. | Convert to an ICK app/profile that supplies guild credentials, charter, policy, and mounts. It should not own steward semantics beyond configuration and deployment. |
| `apps/farolfi` | CLI for paraconsistent double-entry accounting. | `organizing/accounting/*` for ledger record-state; `relating` for exact value/conservation; `computing-with-ledgers` for journal codecs. | Keep only as a configured accounting command surface, or demote to examples/bin over organizing accounting. Any accounting law belongs upstream. |
| `apps/llm-computer` | Bounded LLM agent loop, tool governance, MCP tool conversion, run settlement, inference-cost ledgering. | `organizing-with-llm-agents` already owns agentic run settlement, tool and endpoint carriers, dreaming, and provider codecs; `animating` owns the loop; `organizing` owns governance/ledger record-state. | This is already close to a pure computer, but under the requested shape it should become an ICK app profile or service-mounted computer. Avoid owning any loop semantics outside the LLM organizing library. |
| `apps/obsidian-knowledge-vault` | Desktop Obsidian vault app, bounded vault tooling, doctors, cockpit, local server. | `organizing-a-knowledge-vault` for filepath corpus law; `knowing` for memory/research; `organizing-with-agents` for agent affordances; ICK for app mount. | Make the app a projection/mount of the vault specialization through ICK. Obsidian commands should be transport affordances, not epistemic/corpus law. |
| `apps/openai-agent-tui` | Full-screen TUI for OpenAI-compatible agent sessions, shared data mount logging, dreaming, terminal interaction. | `organizing-with-openai-agents`, `organizing-with-llm-agents`, `computing-with-terminal`, and `computing-with-cli`. | Replace as a named ICK/TUI configuration over the core agent session surfaces. It should mostly wire terminal rendering to the agent kernel. |
| `apps/tui` | General terminal UI shell, ANSI rendering, CLI/terminal composition. | `computing-with-terminal` and `computing-with-cli`; `computing` for program/result carriers. | Keep only as app shell or example. Terminal widgets, buffers, and event carriers belong in `computing-with-terminal`. |
| `apps/waggle` | Hive wallet plus ledger compound app, local key store, sync/book/CLI surfaces. | `computing-with-hive` for chain/key/protocol facts; `computing-with-ledgers` and `organizing/accounting` for records; `relating` for exact quantities. | Good as an app-specific kernel configuration. Move any wallet/accounting law upstream; leave key-store policy and user workflow here or in an ICK profile. |
| `apps/web-computer` | Web CLI for theme conformance, WCAG/APCA scarcity budgets, codec round-trip checks. | `organizing-with-the-web` for web composition and theme computer; `relating` for codec fixture law; `organizing` for conformance records. | This should be a thin ICK or package-bin app over the web faculty extension. Do not let it become the owner of web conformance semantics. |

## Libraries

| package | current capability | better realized by | audit |
| --- | --- | --- | --- |
| `lib/561-group-conformance-algebra` | Workspace M/L/S/A/D invariant catalog. | `relating` for invariant carriers; `organizing` for institutional conformance/adjudication; `apps/jsnode-ick` for JSNode package observation. | Likely dissolve into `organizing` conformance surfaces plus a workspace-specific data/catalog package. If kept, keep it as constants, not an algebra owner. |
| `lib/561-group-website-theme` | 561 visual identity as a web `Theme`. | `organizing-with-the-web/theming` and `relating` carrier law. | Good domain-specific web fiber. Keep as data/theme realization; move theme validation/computation upstream. |
| `lib/communicating-in-english` | English bundle, realization, prose conformance, communicate bins. | `communicating` owns linguistic carriers and realization; `relating` owns action projection. | Good language fiber. Ensure bins are induced from communicating actions, not parallel command surfaces. |
| `lib/communicating-in-latin` | Latin bundle and communicate bins. | `communicating`. | Good language fiber; keep vocabulary/bundle only. |
| `lib/communicating-in-lakota` | Lakota bundle and communicate bins. | `communicating`. | Good language fiber; keep language-specific bundle and realization. |
| `lib/communicating-in-tokipona` | Tokipona bundle and communicate bins. | `communicating`. | Good language fiber; keep as language specialization. |
| `lib/organizing-with-agents` | Generic agent fiber: sessions, mounts, capabilities, context, review, recall, log cuts. | `animating` for agency/loops; `computing` for tool computation; `knowing` for memory; `socializing` for multi-observer fields; `organizing` for work/office/governance. | Keep as the general agent extension over organizing, but audit for root agent ontology duplicated from `animating`. It should compose the faculties, not become a tenth faculty. |
| `lib/organizing-with-claude` | Claude topology, Claude Code CLI harness topology, settings projection, inference wrapper. | `organizing-with-llm-agents` and `organizing-with-agents`; provider-specific transport belongs here. | Good provider fiber if it stays Claude-specific. Generic harness/session semantics belong upstream. |
| `lib/organizing-with-claude-code-cli` | `claude` binary argv/spawn driver, event projection, transcript reading, CLI session computer. | `computing-with-cli`, `computing-with-git`, `organizing-with-claude/session`, and `relating` codecs. | Keep as substrate/provider adapter. Move generic CLI session, transcript, and trace projection rules upstream if duplicated. |
| `lib/organizing-with-claude-code-in-vs-code` | Claude specialization of VS Code agent cockpit. | `organizing-with-vscode-agents` for cockpit/readiness carriers; Claude CLI package for provider details. | Correct as a specialization if it remains mostly mappings and readiness policy. |
| `lib/computing-with-cli` | Argv, stdin/stdout filters, command history, aliases, triggers, command intents. | `computing` owns program/action/result; `relating` owns action projection and wire carriers. | Good substrate extension, but it currently has no internal core deps. Rebase its carriers explicitly on `computing`/`relating`. |
| `lib/organizing-with-discord` | Discord operation vocabulary, REST/gateway boundaries, autonomous guild tending, capability policy, de-enclosure measurement. | `organizing-with-agents` for agent runs; `socializing` for community/consensus; `communicating` for messages; `organizing` for governance; `animating` for tending loop. | Good domain specialization with rich local protocol law. Rehome generic agent loop/policy/capability algebra upstream; keep Discord protocol, permissions, and guild topology here. |
| `lib/organizing-with-email` | RFC 5322/MIME/JMAP/IMAP/SMTP mail operation vocabulary and autonomous mailbox tending. | `communicating` for messaging; `organizing-with-agents` for agent operation; `organizing` for mailbox work; `animating` for tending. | Good domain specialization. Keep protocol codecs/bindings; move generic autonomous inbox-agent semantics upstream. |
| `lib/computing-with-emacs` | Emacs cockpit topology, endpoint/pane plan, dispatcher projections, elisp consumer. | `computing-with-cli`, `computing-with-terminal`, `organizing-with-agents`, and ICK cockpit surfaces. | Likely an adapter, not a library of new semantics. Keep Emacs realization; move cockpit topology to agent/operations libraries. |
| `lib/computing-with-hive` | Hive chain facts, protocol codecs, RPC/client/wallet, curation/market/analysis/logic/geometry readings. | `computing` for chain computation; `gaming/market`; `organizing/accounting`; `knowing` for content readings; `relating` for codecs/quantities. | Good substrate extension, but market/accounting/content subcapabilities should be thin projections of upstream owners. Hive wire and signing facts stay here. |
| `lib/organizing-with-jsnode` | Node packages, bins, workspaces, analysis, TypeScript/module/package carriers. | `apps/jsnode-ick` downstream of ICK for JSNode workspace operation/topology; `computing` for executable package-bin computation; `relating` for codecs/actions; core faculties for reusable semantics. | Decommissioned. Do not repair or extend this package. Recreate any still-live capability inside `apps/jsnode-ick` or upstream faculties, then retarget consumers away from this package. |
| `lib/computing-with-ledgers` | Ledger journal codecs and exact money representations. | `organizing/accounting/ledger` for record-state; `relating` for exact money and conservation. | Mostly a codec adapter. Dissolve financial law upstream; keep file format parsing/printing here. |
| `lib/organizing-with-llm-agents` | LLM agent organizing: endpoint/inference carriers, run settlement, dreaming, host holography, provider wire codecs. | `animating` for agent loop; `communicating` for chat/messages; `knowing` for memory/dreaming; `organizing-with-agents` for generic agent session. | Keep as the LLM specialization, but it should not own provider-independent agent ontology that belongs in `organizing-with-agents` or `animating`. |
| `lib/organizing-with-foundry` | Microsoft Foundry project carriers and local small-model defaults. | `organizing-with-llm-agents` for model endpoint/inference; `organizing-with-agents` for agent governance. | Good provider/cloud fiber. Keep Foundry-specific deployment/project carriers only. |
| `lib/organizing-with-ollama` | Local Ollama endpoints, tiny-laptop model defaults, request carriers. | `organizing-with-llm-agents`. | Good local-provider fiber. Keep model defaults and Ollama wire details only. |
| `lib/organizing-with-openai-agents` | OpenAI-compatible endpoint resolution, inference, run traces, findings/work/cost, handoff. | `organizing-with-llm-agents`, `organizing-with-agents`, `organizing` work records, `computing-with-git` evidence. | Good provider-dialect fiber. Generic trace/finding/work surfaces should be upstream. |
| `lib/organizing-with-openai-codex` | Codex/VS Code workspace topology, CLI harness config, session memory, execution traces, work surfaces. | `organizing-with-openai-agents`, `organizing-with-agents`, `organizing`, `computing-with-git`. | Good Codex specialization if it remains Codex-specific. Move generic coding-agent work/session abstractions upstream. |
| `lib/organizing-with-openai-codex-in-vs-code` | Codex VS Code cockpit panels, command routes, MCP/LSP attachments, readiness checks. | `organizing-with-vscode-agents` and `organizing-with-openai-codex`. | Correct specialization. Keep projection and readiness mapping here. |
| `lib/organizing-with-vscode-agents` | VS Code chat participant, language-model provider, tool, and MCP readiness carriers. | `organizing-with-agents` for generic agent readiness; `relating` for tool/resource carriers. | Good host specialization. Keep VS Code API concepts here; avoid owning generic cockpit law. |
| `lib/organizing-with-the-living-web` | Composite content API/blog/garden/microblog/operation/swam console surfaces. | `organizing-with-the-web`, `organizing-with-the-semantic-web`, `animating`, ICK for operation surfaces. | Keep as a web-domain composition layer only if it remains a reusable library. Some surfaces smell app/site-specific and may belong in ICK/site hulls. |
| `lib/organizing-with-the-semantic-web` | RDF/JSON-LD/Linked Data Fragments, semantic reading, metadata, taxonomy, Cool URIs. | `knowing` for semantic readings; `communicating` for hypertext/utterance; `organizing-with-the-web` for web transport; `relating` for codecs. | Good semantic-web specialization. Keep standards codecs/projections; root epistemics belong in knowing. |
| `lib/organizing-with-the-web` | Web composition, topology, JSON-RPC, theming, feeds, IndieWeb/Fediverse/OAuth/MCP/session sync. | `relating/writing/http` for wire law; `animating` for loops/events; `organizing` for web institutions; ICK for served manifold. | Good web extension, but very broad. Split reusable protocol faces from site/app policy; do not let it shadow ICK. |
| `lib/computing-with-terminal` | ANSI/SGR codecs, buffers, layouts, widgets, keyboard events, screen/world projections. | `computing` for programmatic surface; `relating` for codecs. | Good substrate extension. Keep terminal-specific representations here. |
| `lib/content` | Accountable content production topology, codecs, markdown/image/syndication/propaganda surfaces. | `communicating` for expression; `knowing` for references/research; `organizing` for production record-state; `relating` for codecs. | Too broad for a single root ontology, but useful as a content-domain bundle. Prefer `producing-content`/organizing ownership for production law and keep codecs/domain vocabulary here. |
| `lib/producing-a-newswire` | Project producing outputs into canonical claim-state bundles for newswires/content mills. | `producing-content`, `organizing-a-newswire`, `organizing`, `communicating`. | Likely a transient facade. If the capability is "claim stream production", it belongs in `organizing-a-newswire` plus `producing-content`. |
| `lib/producing-content` | Organizes content through cultivated, witnessed, distributable production; farm/mill/cable/codecs/topology surfaces. | `organizing` for production workflow; `communicating` for prose; `knowing` for research evidence; `content` for domain objects. | Keep as production-domain extension, but continue dissolving duplicated `content` module surfaces so WHAT and DOING stay distinct. |
| `lib/divining` | Sign-reading as settling over communicating, knowing, socializing, playing; astrology/cartomancy/calendar/liturgy sign producers. | The package already names its better homes: `communicating`, `knowing`, `socializing`, `playing`, `relating`. | Good composed domain fiber if sign-panel producers remain here. Any general settlement, consensus, or ludic duality must stay upstream. |
| `lib/managing-operations` | Work breakdown, scheduling, prioritization, workflow, assignment, automation, accounting, reporting, viewing. | `organizing` for work/office/governance; `computing` for decisions; `socializing` for consensus; ICK/ops site for runtime. | This is the strongest candidate for dissolution into `organizing` plus ICK projections. Keep only domain-specific operational templates if any remain. |
| `lib/organizing-a-content-farm` | Knowledge-vault specialization irrigated by newscables and cultivating producing-content farm outputs. | `organizing-a-knowledge-vault`, `organizing-a-newscable`, `producing-content`. | Good composition package only if reusable across sites. Otherwise collapse into site/ICK configuration. |
| `lib/organizing-a-content-mill` | Distribution specialization that serves, syndicates, and measures cultivated content. | `producing-content`, `organizing-with-the-web`, `organizing`. | Likely keep as reusable content distribution fiber; move measurement and serving mechanics upstream. |
| `lib/organizing-a-knowledge-vault` | Filepath corpus law, topic proof paths, corpus health, memory projection, bounded mutations. | `knowing` for epistemic core; `organizing` for corpus-as-organization; `relating` for bounded action dispatch. | Good concrete specialization. Keep filepath-tree law here, with knowing receiving already-gathered memory evidence. |
| `lib/organizing-a-newscable` | Producing-content sheath that bundles newswires and exposes source-roll readings. | `organizing-a-newswire`, `producing-content`, `organizing`. | Likely a thin facade. Keep only if "cable" has reusable multi-wire law; otherwise dissolve into newswire/farm/site. |
| `lib/organizing-a-newswire` | Single provenanced producing-content claim stream with wire surfaces and bundle state. | `producing-content`, `communicating`, `organizing`. | Good specific content-organizing fiber. Keep stream-specific law; production and claim carriers should remain upstream. |
| `lib/organizing-as-lakota` | Lakota cosmogony/governance fiber over relating/animating/organizing. | `relating`, `animating`, `organizing`, and Lakota language communication fibers. | Good cultural/philosophical specialization if it remains a reading over the core, not a replacement for the core. |
| `lib/computing-with-git` | Git evidence carriers, status/log/refs/remotes, porcelain codecs, holography shell-out, version-control computation. | `computing` for action/result; `relating` for codecs; `organizing` for workspace/change governance. | Good substrate extension. Keep git wire/holography here; move worktree governance and review policy upstream. |

## Services

| package | current capability | better realized by | audit |
| --- | --- | --- | --- |
| `services/conformance-tics` | Live package-conformance service over registered paths. | `apps/jsnode-ick/package-lint` for JSNode package checks; `561-group-conformance-algebra`/core faculties for invariants; ICK for served face. | Retargeted away from `organizing-with-jsnode`. Next pass should fold this into ICK actions or keep only a thin service shell. |
| `services/fizzos` | MUD operating-system kernel, world settling, perception fibers, live server, package-bin turn morphisms. | `relating`, `animating`, `gaming`, and `computing` already own the law; `organizing-with-the-web`/ICK own serving. | Strong domain kernel, but probably mislocated in `services` because it claims engine status. Consider `lib/fizzos` as a gaming/computing domain extension, with a service mount separated. |
| `services/http-server` | HTTP app types, routing, middleware, Node startup, edge/platform helpers. | `relating/writing/http` for HTTP carrier/wire law; `animating` for request actions; ICK for manifold serving. | Keep as minimal transport adapter if needed. Audit aggressively for reusable HTTP semantics that should be in `relating`. |
| `services/jsnode-http-server` | Package-bin carriers through HTTP transports. | `apps/jsnode-ick` as the domain-specific ICK app; `computing` for package-bin execution; `http-server` for transport; ICK as upstream kernel. | Rehomed on 2026-06-26: implementation moved to `apps/jsnode-ick/src/package-bin-transport*.mts`, public import became `@emsenn/jsnode-ick/package-bin-transport`, live consumers were retargeted, and the standalone workspace package was deleted. |
| `services/jsnode-web-server` | WebUX/OpenAPI/HTTP/MCP projection for package-bin computing from one catalog. | `apps/jsnode-ick` as the domain-specific ICK app; `computing` for package-bin execution; `organizing-with-the-living-web` for multi-face projection; ICK as upstream kernel. | Rehomed on 2026-06-26: implementation moved to `apps/jsnode-ick/src/package-bin-web.mts`, public import became `@emsenn/jsnode-ick/package-bin-web`, live consumers were retargeted, and the standalone workspace package was deleted. |
| `services/llm-claude-harness` | Claude MCP harness server. | `organizing-with-claude` for harness topology; `http-server`; ICK for hub mount. | Should become a configured ICK hub mount unless standalone loopback deployment is essential. |
| `services/llm-openai-codex-harness` | Codex MCP harness server and process supervision endpoint. | `organizing-with-openai-codex`; `http-server`; ICK for canonical hub mount. | Same: retain only as deployment wrapper or fold into ICK harness mounts. |
| `services/llm-server` | Binds `apps/llm-computer` to transports; OpenAI-compatible chat-completions HTTP surface. | `organizing-with-llm-agents` for inference/holography; `animating/writing/openai-chat` for protocol; ICK for served manifold. | The manifest already states the right service->app edge. Next target is to mount it through ICK rather than preserving a parallel LLM service. |
| `services/propolis` | Hive account fleet service. | `computing-with-hive`, `organizing/accounting`, `organizing-with-the-web`, and ICK. | Too thin in manifest to justify independent semantics. Make it an ICK/site deployment of Hive account-fleet capabilities. |
| `services/qwzspace-server` | 3D realtime browser-game engine/server half; icosahedral quasicrystal space, bilattice visibility, progressive render tiers. | `relating/geometry`, `gaming`, `computing`, `organizing-with-the-web`, and maybe `services/fizzos` style scene serving. | Probably a domain library, not a service. Rehome engine law under `lib/` as gaming/web specialization; keep service mount separate. |
| `services/web-server` | Deployable WebTics utterance-log service and HTTP-to-Node-binary gateway. | `relating/writing/http`; `computing-with-cli`; `http-server`; ICK. | Fold WebTics/manifold behavior into ICK or web faculty; keep only generic binary gateway if still needed. |

## Sites

| package | current capability | better realized by | audit |
| --- | --- | --- | --- |
| `sites/561.group` | Deployable apex site. | `561-group-website-theme`, `organizing-with-the-semantic-web`, `http-server`, ICK. | Good site hull if it remains content/config/theme plus mounts. |
| `sites/aagaard.561.group` | On-chain agentic operations platform for Hive wallet fleet: voting/trading lanes. | `computing-with-hive`, `organizing`, `gaming/market`, `socializing/price`, `propolis`/ICK. | Site should be relational hull over Hive account operations. Move voting/trading algorithms into libraries. |
| `sites/agents.561.group` | OpenAI-compatible chat over character roster, OAuth, per-user memory, MCP endpoint. | `organizing-with-openai-agents`, `organizing-with-llm-agents`, `organizing-with-the-web`, `knowing`, ICK. | Strong candidate for ICK app/site split: characters and routing here; chat/memory/MCP/OAuth capability upstream or ICK-mounted. |
| `sites/ops.561.group` | 561 Group Operations Manifold: agents, arena, context, goals, operations ledger, work, checkpoints. | `services/information-coherence-kernel`, `organizing`, `managing-operations`, `organizing-with-openai-codex`, `organizing-with-jsnode`. | This site currently owns too many upstream agent/ops capabilities. Make it an ICK instance/projection; move reusable operations surfaces into ICK or libs. |
| `sites/turntide-islands.discord.com` | Discord site/archive and steward scripts. | `app-discord-steward`, `organizing-with-discord`, `organizing-a-knowledge-vault`, ICK. | Good site hull if it carries guild content, env, and archive. Steward logic belongs upstream. |
| `sites/cassia-lorne.substack.com` | Syndication-only divination publication and daily diviner cycle. | `divining`, `producing-a-newswire`, `organizing-a-content-mill`, `producing-content`. | Site should be schedule/content/policy hull. Divination and publishing gates belong in reusable packages. |
| `sites/dev.bare-cedar-fog.emsenn.net` | Static living-web cockpit projection for agentic development surfaces and hook/context scripts. | `services/information-coherence-kernel`, `organizing-with-openai-codex-in-vs-code`, `managing-operations`, `organizing-a-knowledge-vault`. | Same as ops: it should be peer ICK instance, not owner of upstream cockpit/agent capabilities. Site keeps projection content and local hooks. |
| `sites/emsenn.net` | Personal website built on semantic/living web packages. | `content`, `organizing-a-knowledge-vault`, `organizing-with-the-web`, `organizing-with-the-semantic-web`, `organizing-with-the-living-web`. | Good hull. Keep personal content/config/routing here; reusable blog/garden/server logic upstream. |
| `sites/farstone.561.group` | Playable harbor MUD served by package scripts. | `feltos`, `http-server`, `gaming`, `organizing-with-the-web`. | Good hull over FeltOS. Site should own world bible/assets/persistence policy, not MUD engine law. |
| `sites/filum.561.group` | 561 group newswires under `/newswires/<name>/`. | `organizing-a-newswire`, `organizing-a-newscable`, `producing-content`, `organizing-with-the-web`. | Good hull if it only instantiates wires/cables. Move ingest/assert semantics upstream. |
| `sites/flickering.561.group` | Idle-roguelike over FeltOS with dungeon/economy/Hive/ledger traces. | `feltos`, `gaming`, `computing-with-ledgers`, `computing-with-hive`, `organizing-with-the-web`. | Site should carry game content and deployment. Dungeon/economy engines should live as FeltOS/gaming extensions. |
| `sites/hai-rui.561.group` | Inference/advice layer over workspace conformance findings. | `conformance-tics`, `organizing-with-jsnode`, `organizing-with-the-web`, `organizing` conformance. | Likely a thin hull over conformance actions. Move advice/inference law upstream or into ICK conformance app. |
| `sites/koios.news` | Collapse-aware news publication: pages, feeds, JSON-LD, ad slots, view counter, newsroom/cable/source/deploy/mill/desk. | `organizing-a-content-farm`, `organizing-a-content-mill`, `organizing-a-newscable`, `organizing-a-newswire`, `producing-content`, `communicating`, `organizing-with-the-web`. | Too much newsroom machinery in the site. Keep publication identity/content/policy; rehome desk, assignment, sourcing, writing, and deploy workflows into content/organizing libraries or ICK apps. |
| `sites/research.561.group` | Thin package-bin transporter for organizing 561 Group knowledge vaults. | `organizing-a-knowledge-vault`, `knowing`, `organizing`, and `apps/jsnode-ick` package-bin WebUX. | Retargeted on 2026-06-26 to import `@emsenn/jsnode-ick/package-bin-web`; it is now closer to a site hull over vault tools. |
| `sites/research.emsenn.net` | Personal dev workbench mounting ICK plus knowledge-vault face over `content/`. | `services/information-coherence-kernel` and `organizing-a-knowledge-vault`. | This is the clearest target shape: site as ICK plus domain face over content. Use as the pattern for other sites. |

## Rehoming Priority

1. Move reusable agent/ops capabilities out of `sites/ops. 561.group` and `sites/dev.bare-cedar-fog.emsenn.net` into ICK, `organizing-with-agents`, `organizing-with-openai-codex(-in-vs-code)`, or `managing-operations`.
2. Collapse operational services that are really served projections into ICK apps or mounts: conformance, Claude/Codex harnesses, LLM server, and WebTics/binary gateway.
  JSNode package-bin WebUX belongs in `apps/jsnode-ick`, downstream of ICK, not inside the ICK service package.
3. Rehome engines misfiled as services: `feltos` and `qwzspace-server` read more like `lib/` domain extensions with separate service mounts.
4. Continue the `lib/trading` pattern: dissolve packages whose manifests already say their semantics are downstream composites.
  Preserve real domain law, but put it at the faculty that owns the invariant.
5. Treat sites as Grothendieck-style relational hulls: a site glues content, policy, mounts, theme, credentials, and runtime choices into a bounded section over the kernel; it should not define the kernel.

## Immediate Candidates

The first practical cut should not delete packages.
It should write relocation ledgers for the packages with the highest ownership confusion:

- `sites/ops. 561.group`
- `sites/dev.bare-cedar-fog.emsenn.net`
- `lib/managing-operations`
- `services/llm-openai-codex-harness`
- `services/llm-claude-harness`
- `services/fizzos`
- `services/qwzspace-server`
- `sites/koios.news`

For each, use the same closure standard as the `lib/trading` dissolution: prove current live imports, identify the root invariant, preserve the invariant in its faculty owner, retarget consumers, then remove or thin the shell.

## Progress Ledger

### 2026-06-26: JSNode topology projection started moving into `apps/jsnode-ick`

Started the follow-up correction for treating JSNode as mathematical topology:

- extracted the old Operations Manifold JSNode topology carrier construction, package API-surface quotient, workspace DAG WebUX, and JSNode topology WebUX into `apps/jsnode-ick/src/topology/`;
- added public `@emsenn/jsnode-ick/workspace`, `@emsenn/jsnode-ick/topology`, and `@emsenn/jsnode-ick/actions` surfaces so JSNode workspace readings are induced through the JSNode ICK action manifold;
- removed the old site-owned JSNode topology implementation files instead of preserving a compatibility shell;
- moved the JavaScript type-topology closure formerly exported by `lib/organizing-with-jsnode/typing` into `apps/jsnode-ick` as `induceJsnodeIckTypeTopology` and related section reads;
- moved the topology settlement carrier formerly exported by `lib/organizing-with-jsnode/packages` into `apps/jsnode-ick` as `JsnodeIckTopologyCarrier`, `induceJsnodeIckTopology`, `extendJsnodeIckTopology`, and `induceJsnodeIckWorkspaceTopology`;
- retargeted root guidance, JSNode ecosystem notes, Koios workspace-topology notes, conformance checks, and the organizing directory-substrate reader away from obsolete `@emsenn/jsnode`, `@emsenn/computing-with-jsnode`, and `@emsenn/organizing-with-jsnode` ownership and toward `@emsenn/jsnode-ick` workspace/topology/action carriers;
- moved plain package/workspace facts, manifest parsing, symbol graphs, source/package carriers, package linting, and decommissioned-import audits into `apps/jsnode-ick`.
- moved package search, capability carrier search, capability term coverage, dependency drift, build-order tiers, lifecycle migration debt, domain atlas readings, graph geometry/centrality, domain/role quotient graphs, role-domain fibration grid, role catalog, exact local package spectra, and the whole-workspace spectral field into `apps/jsnode-ick` as ICK actions (`jsnode/search`, `jsnode/capability-search`, `jsnode/capability-coverage`, `jsnode/analysis`, `jsnode/graph-analysis`, `jsnode/dependencies`, `jsnode/build-order`, `jsnode/lifecycle`, `jsnode/domains`, `jsnode/domain-quotient`, `jsnode/role-grid`, `jsnode/role-quotient`, `jsnode/roles`, `jsnode/spectrum`, `jsnode/package-spectrum`);
- corrected JSNode manifest lifecycle reading so packages tagged `decommissioned` are observed as decommissioned carriers, and excluded decommissioned/`organizing-with-*` packages from live capability-search admission.
- retargeted live deployment/cockpit scripts away from the retired workspace reader: `scripts/deploy-caddy.js` now discovers deployable sites through `apps/jsnode-ick/dist/jsnode/workspace.mjs`, and `sites/dev.bare-cedar-fog.emsenn.net/scripts/workspace-decommission-audit.mjs` now reads the `jsnode-ick` decommission audit.
- replaced the shallow source-regex type index with compiler-backed declaration introspection inside `apps/jsnode-ick`, so `jsnode/types`, package atlas detail, and topology surfaces observe exported function domains, codomains, and subtype edges from built workspace declarations.
- moved the remaining JSNode-as-topology capability into `apps/jsnode-ick` as ICK actions: `jsnode/type-flow`, `jsnode/type-neighbourhood`, `jsnode/type-pipeline`, and `jsnode/symbol-graph`.
- exposed `@emsenn/jsnode-ick/type-flow` for the workspace type-flow category, type neighbourhoods, shortest composition pipelines, and per-package objects-and-morphisms symbol graphs.
- moved the remaining workspace health/retirement analysis into `apps/jsnode-ick` as `jsnode/consistency` and `jsnode/decommission-readiness`, with repo-local retirement proof obligations/evidence derived from workspace membership, lockfile importers, submodule metadata, dependency/source demand, and source markers.
- added `@emsenn/jsnode-ick/workspace-health` and included consistency plus decommission readiness in the aggregate `jsnode/analysis` carrier.
- moved JSNode linked-data topology projection into `apps/jsnode-ick` as `@emsenn/jsnode-ick/rdf` and the `jsnode/rdf` action, covering workspace/package/domain/role/type-flow Turtle, JSON-LD, and the JSNode vocabulary document without importing the retired `organizing-with-jsnode` carrier stack.
- expanded the JSNode ICK topology settlement surface so workspace topology is induced as `jsnode-ick.*` utterance carriers over packages, package roles/domains/tags/exports, declared dependencies, graph edges, exported declaration types/functions, subtype edges, and type-flow morphisms.
- added the `jsnode/topology-carrier` action, which serves the full JSNode workspace as an ICK utterance carrier by default and supports package focus for smaller domain-specific fibers; this keeps `apps/jsnode-ick` as the ICK server specialized to operating over a JSNode workspace rather than a detached analysis library.
- corrected focused workspace discovery so `discoverWorkspace(root, { include })` actually restricts discovered packages, matching the type-index filtering already used by JSNode carrier actions.
- moved the coding-session workspace carrier formerly implemented in `organizing-with-agents/session` onto `@emsenn/jsnode-ick/session-workspace`, including repo-root discovery, package scripts, dependent lookup, package-for-file lookup, and the canonicalization action.
- added the `jsnode/session-workspace` action so coding-session impact tooling can read the JSNode workspace through the JSNode ICK action manifold.
- retargeted `@emsenn/organizing-with-agents` away from `@emsenn/organizing-with-jsnode` and onto `@emsenn/jsnode-ick/session-workspace`; the old JSNode organizer is no longer needed by that live package.
- moved package reduction out of the retired JSNode organizer line and into `apps/jsnode-ick` as `@emsenn/jsnode-ick/package-reduction` plus the `jsnode/package-reduction` ICK action, where it reads the current JSNode package lint carrier and projects a canonical manifest normalization without importing or repairing `organizing-with-jsnode`.
- moved the package description manifest operation into `apps/jsnode-ick` as `@emsenn/jsnode-ick/package-manifest-edit` plus the guarded `jsnode/package-description-update` action, so JSNode workspace mutation is planned and optionally applied through the JSNode ICK action manifold instead of the retired organizer.

Verification:

- `pnpm --filter @emsenn/jsnode-ick check`
- `pnpm --filter @emsenn/jsnode-ick build`
- `pnpm --filter @emsenn/jsnode-ick smoke`
- `pnpm --filter @emsenn/organizing check`
- `pnpm --filter @emsenn/organizing build`
- `pnpm --filter @emsenn/conformance-tics check`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/analysis --input-format form`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/graph-analysis --input-format form`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/domain-quotient --input-format form`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/role-grid --input-format form`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/role-quotient --input-format form`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/roles --input-format form`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/capability-coverage --input-format form --query "workspace topology" --limit 5`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/spectrum --input-format form`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/package-spectrum --input-format form --package @emsenn/jsnode-ick`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/type-flow --input-format form`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/type-neighbourhood --input-format form --type A2ATaskOptions`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/type-pipeline --input-format form --from A2ATaskOptions --to A2ATask`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/symbol-graph --input-format form --package @emsenn/jsnode-ick`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/types --input-format form --package @emsenn/jsnode-ick --limit 5`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/consistency --input-format form`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/decommission-readiness --input-format form --package @emsenn/organizing-with-jsnode`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/rdf --input-format form --package @emsenn/jsnode-ick --format turtle --base https://example.test/`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/rdf --input-format form --type A2ATaskOptions --format jsonld --base https://example.test/`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/rdf --input-format form --vocabulary true --base https://example.test/`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/topology-carrier --input-format form`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/topology-carrier --input-format form --no-types true`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/topology-carrier --input-format form --package @emsenn/jsnode-ick`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/session-workspace --input-format form --package @emsenn/jsnode-ick`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/package-reduction --input-format form --package @emsenn/jsnode-ick`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/package-description-update --input-format form --package @emsenn/jsnode-ick --description "JS/Node domain iteration of the Information Coherence Kernel: project package facts, package-bin catalogs, and JS/Node topology as coherent served mounts." `
- `node apps\jsnode-ick\dist\cli.mjs summary`
- `pnpm --filter @emsenn/organizing-with-agents check`
- `pnpm --filter @emsenn/organizing-with-agents build`
- `pnpm install --lockfile-only --offline --ignore-scripts`
- `node scripts\deploy-caddy.js --domain research.emsenn.net --skip-build`
- `'{}' | node sites\dev.bare-cedar-fog.emsenn.net\scripts\workspace-decommission-audit.mjs`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/workspace --input-format form --focus @emsenn/jsnode-ick`
- `node apps\jsnode-ick\dist\cli.mjs dispatch jsnode/topology --input-format form --package @emsenn/jsnode-ick`

### 2026-06-26: JSNode package-bin projection corrected into `apps/jsnode-ick`

Corrected the bad intermediate placement of package-bin transport/WebUX inside `services/information-coherence-kernel`.
The normative shape is now an app downstream of ICK:

- created `apps/jsnode-ick` as `@emsenn/jsnode-ick`;
- moved the package-bin HTTP/MCP process transport and WebUX implementation from `services/information-coherence-kernel/src/package-bin-transport*.mts` and `services/information-coherence-kernel/src/package-bin-web.mts` to `apps/jsnode-ick/src/`;
- renamed the public API to JSNode ICK ownership: `projectJsnodeIckPackageBinTransports`, `serveJsnodeIckPackageBinTransports`, `serveJsnodeIckPackageBinTransportProcesses`, `createJsnodeIckPackageBinWebApp`, `projectJsnodeIckPackageBinWeb`, and related transport/WebUX projection types;
- removed ICK package-bin subpath exports, package-bin source files, stale package-bin dist files, and the JSNode/WebUX transport dependencies from `services/information-coherence-kernel`;
- retargeted `sites/ops. 561.group`, `sites/research. 561.group`, `sites/research.emsenn.net`, and `sites/turntide-islands.discord.com` to `@emsenn/jsnode-ick/package-bin-web` or `@emsenn/jsnode-ick/package-bin-transport`;
- refreshed `pnpm-lock.yaml` with `pnpm install --lockfile-only --offline --ignore-scripts`.

Verification:

- `pnpm --filter @emsenn/jsnode-ick check`
- `pnpm --filter @emsenn/jsnode-ick build`
- `pnpm --filter @emsenn/information-coherence-kernel check`
- `pnpm --filter @emsenn/information-coherence-kernel build`
- `pnpm --filter @emsenn/information-coherence-kernel test`
- `pnpm --filter @emsenn/561-group-operations-manifold check`
- `pnpm --filter @emsenn/research. 561.group check`
- `pnpm --filter @emsenn/research.emsenn.net check`
- `pnpm --filter @emsenn/turntide-islands.discord.com check`

### Superseded 2026-06-26 note: `services/jsnode-http-server` was briefly mislanded in ICK

This intermediate slice was corrected by the `apps/jsnode-ick` relocation above:

- moved the package-bin HTTP/MCP transport implementation from `services/jsnode-http-server/src/index.mts` and `services/jsnode-http-server/src/serve-node-binary.mts` to `apps/jsnode-ick/src/package-bin-transport.mts` and `apps/jsnode-ick/src/package-bin-transport-runtime.mts`;
- renamed the public API to JSNode ICK app ownership: `projectJsnodeIckPackageBinTransports`, `serveJsnodeIckPackageBinTransports`, `serveJsnodeIckPackageBinTransportProcesses`, and related transport/process types;
- retargeted `sites/ops. 561.group` to the JSNode ICK transport subpath for its hand-built ecosystem package-bin transport;
- kept WebUX composition in the JSNode ICK app rather than in the kernel service;
- removed `services/jsnode-http-server` from `pnpm-workspace.yaml` and deleted the package directory;
- refreshed `pnpm-lock.yaml` with `pnpm install --lockfile-only --offline --ignore-scripts`.

Verification:

- `pnpm --filter @emsenn/information-coherence-kernel check`
- `pnpm --filter @emsenn/information-coherence-kernel build`
- `pnpm --filter @emsenn/information-coherence-kernel test`
- `pnpm --filter @emsenn/561-group-operations-manifold check`
- `pnpm --filter @emsenn/research. 561.group check`
- `pnpm --filter @emsenn/research.emsenn.net check`

### Superseded 2026-06-26 note: `services/jsnode-web-server` was briefly mislanded in ICK

This intermediate slice was corrected by the `apps/jsnode-ick` relocation above:

- moved the package-bin WebUX implementation from `services/jsnode-web-server/src/index.mts` to `apps/jsnode-ick/src/package-bin-web.mts`;
- renamed the public API to JSNode ICK app ownership: `createJsnodeIckPackageBinWebApp`, `projectJsnodeIckPackageBinWeb`, and related carrier/category/document projection types;
- exported the new subpath as `@emsenn/jsnode-ick/package-bin-web`;
- retargeted live consumers in `sites/ops. 561.group`, `sites/research. 561.group`, `sites/research.emsenn.net`, and `sites/turntide-islands.discord.com`;
- removed `services/jsnode-web-server` from `pnpm-workspace.yaml` and deleted the package directory;
- refreshed `pnpm-lock.yaml` with `pnpm install --lockfile-only --offline --ignore-scripts`.

Verification:

- `pnpm --filter @emsenn/information-coherence-kernel check`
- `pnpm --filter @emsenn/information-coherence-kernel build`
- `pnpm --filter @emsenn/information-coherence-kernel test`
- `pnpm --filter @emsenn/561-group-operations-manifold check`
- `pnpm --filter @emsenn/research. 561.group check`
- `pnpm --filter @emsenn/research.emsenn.net check`
- workspace package list is now 83 package patterns and does not include `services/jsnode-web-server`;
- non-generated/non-data source scan has no remaining `@emsenn/jsnode-web-server`, `services/jsnode-web-server`, or `jsnode-web-server` references.
