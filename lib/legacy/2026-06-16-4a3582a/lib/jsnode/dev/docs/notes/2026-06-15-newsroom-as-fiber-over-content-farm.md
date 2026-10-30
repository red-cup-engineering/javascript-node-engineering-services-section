# newsroom as a fiber over content-farm

*2026-06-15. The design for folding `services/newsroom` into
`@emsenn/content-production` per emsenn's directive: "newsroom is meant to be a
specialization of content-farm, where its special functions are parameters into
a content-farm." Records the study so a future session does not re-derive it.*

## The situation found

By 2026-06-15 most of the news theory had **already migrated into
`@emsenn/content`**: `topology/news` (claim, cable, desks, formats, lifecycle),
`topology/{demand,production,gates,copyedit,article}`, `codecs/ninjs`,
`syndication/` (source-intake), `propaganda/`, and bin scripts
(`content-read/gate/rank`). The three `services/news*` packages are the
superseded, web-coupled ancestors:

- **`@emsenn/newswire`** — artifact/story-first surfaces (rss/atom/jsonfeed/
  microformats/NewsArticle JSON-LD/sitemaps). The model the news-topology memo
  (`triage/2026/06/11/news_topology_research_memo.md`) says we moved past:
  "the sheaf candidate is strongest for canonical claim-provenance graphs, not
  prose stories"; "feed formats … not full claim semantics."
- **`@emsenn/newscable`** — the **canonical** wire: claim-state-bundle-first
  ("the wire publishes claim-state bundles; prose properties are lossy
  projections"), plus the cable (a bundle of wires under one sheath). Matches
  the memo's theory. Used by filum.561.group.
- **`@emsenn/newsroom`** — a SWARM/agent-fleet-backed production engine
  (ingest → assign → synthesize → editorial desks → assertion trace).

## The decision (CORRECTED 2026-06-15): format codecs live in content

The first cut of this note said "codecs stay in web; render at site." emsenn
**corrected** that: "when I said content-production be web free, that means
http transport. it can still and should still know about json-ld and stuff.
that's why we moved that stuff into content, since that's the shared hub of
web and content-production."

So the lawful split is by **transport vs. format**, at the shared-inheritance
apex `@emsenn/content` (web depends on content; content-production depends on
content):

- **Serialization FORMATS are content codecs.** A feed/sitemap/robots/h-entry/
  JSON-LD/ninjs is a pure function from values to a string — a format, not a
  transport. These now live in `@emsenn/content/codecs/*` and obey codec law L4
  (zero runtime deps, no network/filesystem/clock).
- **HTTP TRANSPORT stays in web.** The `App`/`Resource`/`Repr` pipeline,
  `httpDate`/`linkHeader`, the `feedApp`/`microformatsApp` resource builders,
  WebSub `Link` headers — these mount a formed artifact on HTTP. web RE-EXPORTS
  the content codecs so its existing consumers are unchanged.
- content-production **forms** distribution artifacts (the content-mill, below),
  web-free, using content's codecs; a site **mounts** them on web transport.

### DONE 2026-06-15 — the relocation + the mill

1. **`@emsenn/content/codecs/jsonld`** — pure NewsArticle JSON-LD
   (`newsArticle`/`newsArticleScript`). emsenn's literal example.
2. **`@emsenn/content/codecs/feed`** — the syndication serializers relocated
   from `web/feed`: rss2/atom/jsonFeed/sitemap/sitemapIndex/newsSitemap/robots/
   feedPage + the RFC-3339 + XML helpers. `web`'s `httpDate` dependency was
   replaced by a pure inlined `imfFixdate` (byte-identical IMF-fixdate). `web/feed`
   now re-exports it and keeps only `feedApp`/`webSubLinkHeader` (transport).
3. **`@emsenn/content/codecs/microformats`** — h-card/h-entry/h-feed + the
   relationality finite-algebra / selected-cell projections relocated from
   `web/microformats`. `web/microformats` re-exports it, keeps `microformatsApp`.
4. **`@emsenn/content-production/content-mill`** — the dual of the farm: forms a
   publication's `MillItem`s (the lossy wire projection of a claim set) + a
   `MillMasthead` into `{ feeds, sitemap, newsSitemap, robots, per-item
   {body(h-entry+JSON-LD), jsonLd, ninjs}, audit }`. Web-free; returns
   strings/objects. `millSurfaces` is the coproduct of all the format functors.
5. **koios migrated to the mill.** `sites/koios.news/src/surface.ts` is now a
   thin transport mount: project KoiosPost → mill source, call the mill, wrap
   formed bodies in the koios theme, expose each artifact as a web `Resource`.
   This also **restored the dropped ninjs surface** (`/ninjs.json`) the right
   way — formed in the mill, not site-local. All 14 koios tests + content +
   content-production + web typechecks + both boundary audits green.

Net: web no longer OWNS any news format; it transports them. The capabilities
are consolidated (codecs in content, forming in the mill) instead of split
between web and koios-local.

## The fiber: newsroom = content-farm parameterized at three seams

`content-farm`'s `cultivate` cycle (`lib/content-production/src/content-farm/
cultivate.mts`) and newsroom's `newsroomCycle`/`runNewsroom`
(`services/newsroom/src/index.mts`) are the SAME shape:

    intake → select → compose → judge(gates) → record

specialized at exactly three seams:

| seam      | farm (base, `FARM_PROFILE`)                         | newsroom (fiber, `NEWSROOM_PROFILE`)                       |
|-----------|-----------------------------------------------------|------------------------------------------------------------|
| `select`  | `selectStory` — term-as-lens, ONE story + context   | `assignStories` — LLM angle clustering → N `AssignedStory` |
| `compose` | `draftPrompt` + single `ask` → markdown `PostDraft`  | `synthesizeBrief` over N papers → `StructuredBrief`/writes |
| `record`  | markdown candidate + JSONL run trace + hub work-item | `assertionsFromWrites` SWARM trace + reconstructed claim-sets |

The base functor is the cycle skeleton (demand→assignment, witnessed intake,
support-walk obstruction semantics, gate judging, usage accounting). A
**profile** is the fiber: the `(select, compose, record)` triple. `cultivate`
becomes `cultivateWith(property, FARM_PROFILE, options)`; "newsroom" is
`cultivateWith(property, NEWSROOM_PROFILE, options)`.

### The one real subtlety: the output carrier differs

farm's `record` emits a markdown `FrontMatterDocument`; newsroom's emits a
claim-state **assertion trace** (`NewsroomAssertionTrace` of `ChargeCarrier`
assertions) + reconstructed `NewsClaimSet`s. So the cycle must be **polymorphic
over its `record` output** — the profile carries the output type. Per the
topology memo this is the right primitive anyway: the claim-state trace is
canonical and the markdown candidate is one lossy projection of it. A later
unification could make `FARM_PROFILE.record` ALSO emit a claim-state trace and
treat the markdown as the projection — but that is not required for the fold.

## Capabilities that must NOT be lost (harvest into the NEWSROOM_PROFILE)

`ingestSources`, `sourceWrites`, `articleSubject`, `assignmentPrompt`,
`parseAngles`, `clusterSources`, `assignStories`, `synthesisPrompt`,
`structureBrief`, `synthesizeBrief`, `briefWrites`, `factCheckPlan`,
`copyEditPlan`, `standardsPlan`, `newsroomCycle`, `newsStoryCandidates`,
`runNewsroom`, `assertionsFromWrites`, `claimSetsFromTrace`,
`presentationWritesForClaimSet`, `editorialWritesForCycle`, the `Newsroom`/
`NewsroomService` classes, and the manifest config normalizers. emsenn:
"we cannot destroy capabilities … we're at the very first phases of GAINING
capabilities."

## Remaining stages (live-site migration; verify each green)

- **A. DONE (2026-06-15).** The `cultivate` cycle is now the BASE engine
  parameterized at all three seams, each with a behavior-preserving default and
  a test; 55/55 content-production tests + boundary audit green. Implemented as
  optional `select`/`compose`/`record` options on `CultivateOptions<W>` (NOT a
  separate `cultivateWith` — additive on the existing function, default
  `W = CultivationResult`, via overloads so existing callers are unchanged):
  - `select` (default `defaultSelectStory` = term-as-lens `selectStory`).
  - `compose` (default `defaultCompose` = one `draftPrompt` call + copyedit closure).
  - `record` (default `defaultRecord` = markdown candidate + JSONL run trace +
    hub deposit, returns `CultivationResult`). The output carrier is the type
    param `W`; the carrier-independent settlement is `CycleSettlement`, the
    side-effect policy is `RecordContext`. Stale headers refreshed.
  - Obstruction recording (the unsupported-demand `recordRun`) stays in the
    BASE for now (a witnessed "no output" on the property's run trace); if a
    fiber needs a different obstruction record, lift it into the seam later.
- **B. ALL THREE SEAMS DONE (2026-06-15).** newsroom's functions are harvested
  into `lib/content-production/src/content-farm/newsroom.mts` as seam params;
  57/57 content-production + 225/225 content tests + both boundary audits green.
  - SELECT — `newsroomSelect` (angle clustering by keyword overlap); the
    building blocks `keywordsOf`/`assignmentPrompt`/`parseAngles`/`clusterSources`
    are exported for the angle-assignment layer.
  - COMPOSE — `newsroomCompose` (multi-paper brief synthesis:
    `cleanProse`/`sentences`/`synthesisPrompt`/`structureBrief`/`synthesizeBrief`,
    `StructuredBrief`).
  - RECORD — `newsroomRecord: RecordCycle<NewsroomCultivation>` emits the
    claim-state assertion trace + folded claim sets (via `sourceWrites`/
    `briefWrites`/`clearGate`), persists JSON under `<dataDir>/newsroom/`.
  - KEY DECISION: the assertion round-trip (`write`/`clearGate`/`toJsonValue`/
    `assertionFromClaim`/`assertionsFromWrites`/`claimSetsFromTrace`/
    `stableJsonKey`/`traceEntryId` + `NewsAssertion`/`NewsAssertionTrace`) was
    homed in **`@emsenn/content/topology/news/assertions.mts`**, NOT
    content-production — it is the carrier's own serialization over
    relationality charges + content's OWN `JsonValue` (newsroom had only agent's
    `JsonLike`). Result: **content-production needed NO new deps** (no
    `@emsenn/animating`, no direct `@emsenn/relationality`); the charge coupling
    lives in content, which is already specialized relationality.
  - STILL TODO for full newsroom retirement: the N-angles-per-cycle
    orchestration (newsroom's `newsroomCycle`/`runNewsroom` ≈ `assignStories` →
    `cultivate` once per angle with the newsroom seams), porting `assignStories`/
    `ingestSources`/`newsStoryCandidates`, and the `Newsroom`/`NewsroomService`
    classes + manifest config normalizers. Also: wire the newsroom record into
    the demand/compost loop (the run-trace integration the markdown default has).
  Also exposed the orchestration: `assignAngles` + `runNewsroomCycle` (fetch the
  beat's intake ONCE via the now-exported `intakeItems`, assign the day's angles
  over it, run the base cycle once per angle with the newsroom seams via the new
  `CultivateOptions.items` injection). `NewsroomCycleOptions`/`NewsroomCycleResult`.
- **`services/newsroom` RETIRED (2026-06-15).** The submodule is removed
  (deinit + `git rm` + `.git/modules` cleanup + `.gitmodules` stanza gone),
  matching the codex/divination retirements this session. Consumers repointed:
  cassia-lorne (`hasProvider`/`makeAsk` → `@emsenn/content-production/computer`;
  dep swapped to `@emsenn/content-production`); koios's `@emsenn/newsroom` dep
  was vestigial (no code import) and was dropped. A `pnpm install` is needed to
  relink the workspace after these dep edits. NOT YET ported (only consumer was
  the now-deleted package, so no live caller): the `Newsroom`/`NewsroomService`
  persistent-service classes + manifest config normalizers, `ingestSources`,
  `assignStories`/`AssignedStory`, `newsStoryCandidates`, and the data-file/App
  surfaces. Recover from git history if a service form is wanted later.
- **C. (newswire) DONE + RETIRED (2026-06-15).** koios's surface layer was
  rebuilt at the site: new `sites/koios.news/src/surface.ts` projects items
  from koios's own claim-set vocabulary and renders the distribution surfaces
  (item pages + NewsArticle JSON-LD, RSS/Atom/JSON feeds, sitemap + news
  sitemap, robots, the `/newswire-audit.json` gate audit) via `@emsenn/web/feed`
  + `@emsenn/web/theming` + `@emsenn/content/topology/news`
  (`editorialGateReport`/`currentPublicationStatus`). `index.ts` rewired off
  `newswire`/`newswireApp`/`publicItems` (`Newswire`/`WireItem` → local
  `KoiosMasthead`/`KoiosItem`); `content.ts` dropped the `WireItemInput` type
  for a local `KoiosWireInput`; `site.test.ts` exercises the served surfaces.
  koios typecheck clean; `@emsenn/newswire` dep dropped; the `services/newswire`
  submodule retired (deinit + index gitlink removed + `.gitmodules` stanza gone).
  NOTE: koios is rendered AT THE SITE — content-production stays web-free.
- **D. (newscable) DONE + RETIRED (2026-06-15).** filum.561.group is repointed
  and `services/newscable` is deleted (plain in-tree dir; `git rm -r` + lockfile
  importer pruned). The fold was clean because feed had already moved to content
  (step 2), leaving `@emsenn/web/theming` as the ONLY web coupling in the forming
  code — inverted into an injected `render` seam (the fiber pattern again).
  - **content-production gained `./cable`** (`lib/content-production/src/cable/`,
    web-free, boundary-audited): `projection.mts` (bundle→WireItem + claimLine/
    auditOf/freshnessOf, verbatim), `wire.mts` (the newswire forming + store +
    production kit; feed codecs now from `@emsenn/content/codecs/feed`, theme →
    injected `RenderDocument`/`RenderLink`), `cable.mts` (the sheath forming over
    content's `topology/news` cable carrier; feed from content, theme injected),
    `discovery.mts` (the `561:newscable`/`561:newswire` manifest readers +
    `aggregateWires`, theme→render passthrough), `ingest.mts` (verbatim — already
    web-free over `@emsenn/content/syndication`). EVERY surface preserved:
    verbatim `/items/<subject>.json`, h-feed, claim-line h-entry,
    `/corrections.json`, `/audit.json`, the sheath index, `/cable.json`,
    `/robots.txt`, `/sitemap.xml`.
  - **filum got the thin transport** (`sites/filum.561.group/src/cable-app.ts`,
    parallel to koios's surface.ts): builds the `render` from `web/theming` +
    `filumTheme`, reads config + aggregates wires + builds the cable (all from
    content-production/cable), wraps `cable.handle` in a web App catch-all. The
    5 producers import the production kit from `@emsenn/content-production/cable`;
    `index.ts` calls the local `createCableAppFromConfig`; new `ingest.ts`/
    `serve.ts` scripts replace the old `newscable` CLI commands; dep swapped
    `@emsenn/newscable` → `@emsenn/content-production`. filum tsc clean; 58/58
    content-production tests + boundary audit green.
  - NOTE: newscable's own test files (newscable/newswire/projection/discovery
    .test.ts) were retired with the package. The forming is a faithful copy
    (typecheck + filum-as-live-consumer cover it); port those tests into
    `lib/content-production/src/cable/` if guard coverage is wanted later.
  Recover the original package from git history if needed.

  *(Original study of the three concerns, kept for reference:)* ~2,400 lines
  spanning THREE concerns that each rehomed to a different layer:

  1. **The newswire model is RICHER than the mill.** newscable's `newswire.ts`
     treats the **`ClaimStateBundle` as the canonical resource** — served
     verbatim at `/items/<subject>.json` — with feeds/h-feed/h-entry(claim
     lines)/`corrections.json`/`audit.json` as lossy projections of the rich
     carrier (via `projectItem`/`claimLine`/`auditOf`/`freshnessOf`/
     `correctionClaims`/`effectiveClaims`). koios's mill projects flat-cell
     `MillItem`s — a thinner view. So the mill must either GROW a
     bundle-canonical path (`millBundleSurfaces` reading `ClaimStateBundle`,
     emitting the corrections + audit + verbatim-bundle surfaces) or filum keeps
     a richer projection. The bundle-first model is the one the topology memo
     calls canonical, so growing the mill is the lawful move.
  2. **Cable transport → web.** `app.ts`/`createCableAppFromConfig`/`discovery.ts`
     (Host routing, `/cable.json`, the cable index, the `561:newscable`/
     `561:newswire` manifest convention, membership discovered from `sites/`)
     is HTTP transport + a cable topology. The topology already lives in
     `@emsenn/content/topology/news/cable.mts` (`NewsCable`/`WireBinding`/
     `wireBaseUrl`/`routeRequest`); the transport (build a cable `App`) belongs
     in web, parameterized by the mill output + that topology. filum then calls
     it the way it calls `createCableAppFromConfig` today.
  3. **Store + production kit → content-production.** `readBundleFile`/
     `loadWireBundles`/`writeBundleIfAbsent` (filesystem, per-subject bundle
     files) + `resolveDate`/`assertedNow`/`addDays`/`computesClaim`/`reportWrite`
     (the producer helpers the 5 filum producers import). These are claim
     authoring + a bundle store — a content-production concern (the farm already
     deposits through a hub; this is the wire-store analogue). NOTE `assertedNow`/
     `resolveDate` default-arg use wall-clock as DATA (marked `law-allow`), so
     they cannot be pure L4 codecs — they belong in content-production's
     producer/store layer, not content/codecs.

  Order: grow the mill's bundle-canonical path (1) → build the cable transport
  in web over content's cable topology (2) → rehome the store/production kit (3)
  → repoint filum index + producers → delete `services/newscable` → verify
  filum + the cassia/koios green. Preserve every surface
  (`corrections.json`/`audit.json`/verbatim bundle/h-entry claim lines) — the
  memo's claim-state doctrine is the whole point of the cable.
