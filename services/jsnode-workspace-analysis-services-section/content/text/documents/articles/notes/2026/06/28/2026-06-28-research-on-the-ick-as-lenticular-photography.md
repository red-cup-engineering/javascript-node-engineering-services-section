---
date-created: 2026-06-28
description: "Replaces the mirror metaphor for the ICK with lenticular photography: the workspace is not flatly reflected but passed through an apparatus that resolves undifferentiated host marks (paths, manifests, commits, imports) into relational objects viewed under different angles."
grounds:
  - knowing
  - dreaming
  - information-coherence-kernel
  - jsnode
  - mirrors
  - infotiles
keywords:
  - ICK
  - lenticular-photography
  - coherence
  - kernel
  - faculty
  - mark
  - lattice
  - face
  - plate
  - organizing
  - utterance
  - structure
sources:
  - sites/research.emsenn.net/content/researching/notes/2026-06-26-research-on-the-relational-structuration-of-a-jsnode-workspace.md
  - sites/research.emsenn.net/content/researching/notes/2026-06-26-research-on-git-and-node-as-two-coordination-tiers.md
  - dev/content/researching/notes/2026-06-28-research-on-npm-packages-git-repos-and-branches-as-coordination-structures.md
  - dev/content/researching/papers/2026-06-26-research-on-the-information-coherence-kernel.md
  - dev/content/researching/papers/2026-06-26-research-on-infotiles-as-bilattice-sofic-tilings.md
  - dev/docs/explanations/from-mark-to-settling.md
  - apps/jsnode-ick/src/topology/settlement.mts
status: imagining
title: Research on the Information Coherence Kernel as Lenticular Photography
---
The right image is not a mirror that simply shows the workspace back to itself.
The mirror note says "three mirrors of the engine on itself," but the mechanism is not flat reflection.
The workspace does not stare into glass and receive a picture.
It passes through an apparatus.

That apparatus is closer to relational photography.

The substrate begins with host marks: file paths, manifest strings, export specifiers, bin names, dependency ranges, git commits, refs, source imports, type declarations, lockfile entries, submodule pins.
Among these, an earned file path is already a generative proof coordinate; admission witnesses and types that operative structure rather than discarding it as undifferentiated metadata.
They are the sensitive bath, the raw field in which an exposure can occur.

The old photographic image wants mercury and silver bromide because it has the right felt shape: a material bath, a light opening, a latent image, a development process, and finally a visible plate.
But for ICK the mechanism cannot stop at "light makes picture."
The system is not copying appearances.
It is developing a relational structure from admitted marks by way of lawful projections.

So the better diagram is:

```text
host marks
  -> admission bath
  -> organizing aperture
  -> face exposure
  -> faculty lattice
  -> settlement / development
  -> lenticular return projection
```

The return projection is the thing we can look at: a JSNode topology structure, a workspace graph, an InfoTile, a WebUX surface, an RDF document, a package atlas, a decommission audit.
But the visible projection is not the thing itself.
It is the chromophotograph of the relational structure the apparatus has developed.

## The mirror source

The JSNode structuration note gives the anchor:

```text
host (floor) -> admission -> admitted structures -> pure arrows (faculty mirrors) -> settled structures -> transport -> wire
```

That is the actual "mirror" thread.
The mirror is not a pane of glass.
It is the sequence of faculty arrows that lets the host become readable as a coherent structure.
The host is the grounded floor.
Admission is the one honest impurity.
Everything after admission is supposed to be a pure arrow over admitted structures.
Transport is only the final outward face.

The git/node coordination note sharpens the requirement.
The workspace reflection is incomplete if it reads only pnpm package structure.
It must read both coordination tiers:

- the dependency structure: manifests, workspace membership, lockfile, package graph;
- the history structure: git commits, refs, submodule pins, worktree state;
- the inter-tier charge: whether dependency settlement and history slice agree.

That is why this is lenticular rather than ordinary photography.
The image has more than one viewing angle.
The same package must reveal different but coherent readings as the viewer shifts:

```text
as package membrane
as dependency node
as source module cluster
as exported type/function surface
as executable bin surface
as git history slice
as decommission/live lifecycle cell
as ICK utterance topology
```

A flat mirror would choose one of these and call it the truth.
A lenticular plate keeps the surface one while the viewing angle changes the image.

## Mercury bath: the admitted mark field

The mercury bath is the undifferentiated mark substrate after it becomes chemically sensitive but before it becomes a picture.

For the repo, this is the host-contact layer:

- raw `package.json` text;
- `pnpm-workspace.yaml`;
- `pnpm-lock.yaml`;
- source and declaration files;
- `git status`, `git log`, refs, remotes, gitlinks;
- `.gitmodules`;
- submodule status;
- file paths and package directories.

These are not yet facts in the kernel.
They are raw marks capable of being admitted.

The `from-mark-to-settling` descent matters here.
A mark does not carry charge.
The charge arrives only after articulation, predicating, positing, and settling.
So the bath must not be mistaken for the photograph.
A package manifest is not already an organization.
A git SHA is not already a causal-set reading.
A raw arbitrary string is not already an admitted semantic object, but an earned filepath is already a proof claim whose directory segments compose its generating morphisms.
Admission verifies and preserves that path; it must never erase it in favor of an index or content-only identity.

Admission is the chemical preparation by which raw marks become admitted structures.
In the JSNode case, the relevant structures are things like manifests, dependency graphs, git commit/ref/worktree slices, workspace structures, topology utterances, and resolution/cover readings.
The impurity is honest: this is the place where Node, the filesystem, and git are touched.
After that, the system should stop touching free data and work through admitted structures.

## Aperture: organizing chooses the exposure

Organizing is the aperture because it decides what part of the mark field becomes a cover.
It does not create the light.
It frames what can be exposed together.

In JSNode, the aperture is opened by questions like:

```text
Which package set belongs to this workspace?
Which dependency edges are in view?
Which package facts become utterances?
Which git histories are part of this slice?
Which decommission claims are active?
Which source imports count as live demand?
Which type declarations are visible enough to induce type-flow?
```

This is not arbitrary selection.
An aperture is a lawful cut.
It determines the exposure without inventing the subject.

That is why `organizing` is the right metaphorical owner of the aperture.
It admits a package society, reads the off-diagonal dependency cover, computes coordination cost, and makes retirement or lifecycle contradictions visible as social facts.
The ICK service can serve the surface, and `apps/jsnode-ick` can present the JSNode-domain reader, but the aperture function is the organization-level act: selecting and gluing a cover.

## Grains: faces as local exposed cells

The faces are the grains of silver bromide.
Each grain is small, local, and sensitive to a particular exposure.
It does not know the whole image.
It records a local section.

At scale one, the faces are:

```text
communicating: across / truth
knowing: inside / knowledge
playing: outside / evidence
```

At scale two, the mirror is:

```text
socializing: across / truth
computing: inside / knowledge
gaming: outside / evidence
```

Each face records something local about the exposed membrane.
The face is not the bulk.
The grain is not the photograph.
But without grains there is no image; without faces there is no global section to reconstruct.

For JSNode, a package can be exposed across several face-grains:

- `exports` records a communicating face;
- type declarations and internal module graphs record a knowing/computing face;
- `bin` and scripts record playable/computing strategies;
- dependencies and devDependencies record social and developmental counterparties;
- git pins and commit histories record the temporal/history face;
- lifecycle tags record package standing and possible contradiction.

The package is developed from the gluing of these exposures.
When one face says active and another says decommissioned, that is not a smudge to wipe away.
It is a held contradiction in the plate.

## Molecular lattice: faculties constrain development

The user's phrasing gets the essential next step right: the faculties are the internal molecular lattice of the silver.

The grains are not isolated dots.
Their development is constrained by an internal lattice.
That lattice is the faculty structure: the permitted axes, morphisms, dependency directions, and gluing laws by which local exposures can become one image.

This is where a photographic metaphor has to become relational-graphic.
The image is not produced by resemblance.
It is produced by lawful development.

In the code, `apps/jsnode-ick/src/topology/settlement.mts` shows the mechanism in miniature.
Workspace package facts are turned into utterance records:

```text
workspace has package
package in layer
package has version
package has lifecycle
package has maturity
package in domain
package has role
package has tag
package has export
package depends on package
package declares dependency/range/kind
package has bin
package has script
graph has edge
package has type/function
function has domain/codomain
type specializes
type transforms to type
```

Then those utterances are settled:

```text
utterances -> settleUtterances -> fixedPointReadingsOfUtterances
```

That is photographic development in the precise sense.
The visible structure is not drawn by hand.
It is induced by exposing local marks into utterances and letting the settlement machinery develop the fixed-point readings.

The molecular lattice decides what can bind to what.
Package dependency edges, type-flow morphisms, lifecycle charges, exports, bins, roles, domains, and graph edges do not become one picture by vibes.
They become one picture because the faculty lattice says which relations are admissible and which gluing failures must remain visible.

## Latent image: topology before display

Before the photograph is visible, it has a latent image.
In ICK, the latent image is the settled structure after settlement but before transport.

For JSNode that means the topology structure:

```text
kind: jsnode-ick.topology.structure
utterances
settlement
fixedPointReadings
```

This is already the picture mathematically, but not yet visually.
It has not become WebUX, RDF, package atlas, graph display, audit table, or InfoTile.
It is the developed plate before the viewer-facing projection.

This is why the "return projection" is not merely output.
It is the final optical device that lets an observer inspect the plate.
Different return projections reveal different images from the same settled structure.

## Lenticular return: one plate, many coherent images

The ICK return projection should be imagined as lenticular.
A lenticular photograph has one material surface but several images, depending on viewing angle.
The ridged lens does not invent new subjects.
It routes the viewer through different encoded strips of the same plate.

ICK does the same thing with a settled structure.
The same settled workspace can be returned as:

- package atlas;
- dependency graph;
- build-order tiers;
- decommission-readiness audit;
- type-flow graph;
- RDF / JSON-LD;
- OpenAPI/MCP action surface;
- InfoTile;
- site cockpit context;
- operator warning.

The important thing is that these projections must commute through the same settled structure.
If the package atlas says a package is live, the decommission audit says it is decommissioned, and the cockpit imports it anyway, the plate has not failed.
It has recorded a contradiction.
The correct return image includes the conflict instead of painting it over.

That is exactly the current JSNode tension.
`@emsenn/jsnode-ick` is the canonical JSNode ICK app in the repo instructions, but the decommission audit also reads it as decommissioned and reports active imports into it.
This is a bad state operationally, but a good demonstration of the apparatus.
The plate holds both readings as evidence.
The next work is not to pretend one exposure did not happen.
The next work is to resolve, migrate, or reclassify the package lifecycle so the projection no longer carries that charge.

## The mechanism, stated cleanly

Here is the closest true mechanism for "relational-graphy":

```text
1. Raw host marks sit in the bath.
2. Admission turns selected marks into admitted structures without pretending the host is pure.
3. Organizing opens an aperture by selecting a cover: packages, dependencies, histories, imports, types, actions.
4. Faces expose local sections over that cover: across, inside, outside; truth, knowledge, evidence.
5. Faculty arrows provide the lattice that constrains which local exposures can bind.
6. Utterances record exposed relations.
7. Settling develops the latent image into fixed-point readings.
8. Transport lenses return several projections of the same settled structure.
9. InfoTiles can render the result as a bilattice-colored sofic tiling: the chromophotograph of the relational structure.
```

The word "chromophotograph" earns its keep here because the color is not decorative.
The colors are charges.
The palette is Belnap-style:

```text
bottom: told nothing
t: evidence leaning true / potential
f: evidence leaning false / active
top: told both, conflict held
```

So the photograph is not "a pretty graph."
It is a color-developed relational plate whose colors encode information state.

## Why lenticular photography helps

This image helps because it protects three distinctions that ordinary "mirror" language blurs.

First, it keeps admission separate from projection.
The bath is not the displayed image.
Raw host files are not the settled structure.

Second, it keeps local exposure separate from global picture.
Faces are grains, not the whole photograph.
The image appears only after gluing and settling.

Third, it keeps multiple projections tied to one plate.
Package atlas, RDF, cockpit, audit, topology, and InfoTile are not rival dashboards.
They are viewing angles on one developed plate.

That gives a better sentence for the ICK/JSNode mirror:

> JSNode ICK is the lenticular return projection of the workspace after host marks have been admitted, exposed through organizing's aperture, developed through faculty-lattice settlement, and rendered as coherent views of one package/history structure.

The mechanism is still research-grade as a full unifying claim.
The pieces are more mature than the picture:

- host admission and manifest/git/package readers are code-backed surfaces;
- JSNode topology utterance induction and fixed-point settlement exist in `apps/jsnode-ick`;
- the ICK witness-ledger and reading kernel are built+green in the whitepaper's account;
- InfoTiles as universal display is still research-grade/roadmap at the product level;
- "lenticular photography" is an imagining device, not a theorem.

But the image is useful because it sends the hand to the right files.
Look for the mirror passages.
Look for the JSNode host-admission floor.
Look for the topology utterances.
Look for the git x pnpm product structure.
Look for the faces and faculty lattice.

That is where the real relational-graphic mechanism lives.
