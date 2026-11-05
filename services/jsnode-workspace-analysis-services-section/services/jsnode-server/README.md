# JSNode Server

`jsnode-computer` bound to transports: the workspace package graph and
type-flow category served over HTTP (JSON, Turtle, JSON-LD) and over Model
Context Protocol, for agents. Read-only — it observes package manifests and
built TypeScript declarations beneath the tree it is pointed at; it does not
own or mutate them.

For installing/running the checked-in systemd unit and verifying live
state, see `content/deployment/systemd-user/README.md`. This document
covers the tool surface itself, as of `0.1.3`.

## Two complementary views

- **The package graph** — packages and their workspace dependencies:
  `jsnode_search`, `jsnode_package`, `jsnode_atlas`, `jsnode_domains`,
  `jsnode_analysis`, `jsnode_query`.
- **The type-flow category** — types as objects, functions as morphisms:
  `jsnode_typeflow`, `jsnode_typeflow_type`, `jsnode_types`,
  `jsnode_functions`. These read built declarations; a package that has
  never been built contributes no types.

## jsnode_search vs jsnode_query

Two different jobs, not two ways to do the same thing:

- **`jsnode_search`** — conceptual, ranked search (name > tag >
  description) over a single free-text query. Use this FIRST when you
  don't yet know which package owns a concept; it explains the match and
  lists source-declared consumers. Follow a hit with `jsnode_package` for
  detail.
- **`jsnode_query`** — a structured, AND-combined filter (quasi-SPARQL:
  pick a WHERE clause and a SELECT list) over exact fields, for when you
  already know the shape of what you want rather than a free-text guess.

### jsnode_query filter fields

All filters are optional and combine as AND:

| Field | Match | Notes |
| --- | --- | --- |
| `scope` | exact | npm scope including the `@`, e.g. `"@561-group"` |
| `layer` | exact | one of `lib \| apps \| services \| sites \| ops` |
| `tag` | case-insensitive substring | matched against a package's keywords/tags |
| `name` | case-insensitive substring | matched against the package name |
| `description` | case-insensitive substring | matched against the package description |
| `return` | field selection | which fields to project per match; default `["name"]`; choices: `name, version, description, layer, scope, tags, lifecycle, maturity, exports, dependencies` |
| `limit` | count | caps the returned `packages` array only — `count` always reports the full match total regardless of `limit` |

### Worked example

Every package whose keywords contain `eavt`, by name — `{ tag: "eavt" }`
against the live server returns:

```json
{
  "count": 3,
  "packages": [
    { "name": "@red-cup-engineering/computer" },
    { "name": "@red-cup-engineering/qwzspace" },
    { "name": "@red-cup-engineering/semiotic-exchange-chain-services-section" }
  ]
}
```

(verified live, 2026-08-30)

## Keyword-hygiene rule

Search and query both read the same keywords/tags a package declares in
its `package.json`. If a term plausibly exists in the tree but a query
returns nothing, the defect is metadata, not a missing capability: fix it
by adding the keyword to the owning package. Never work around a miss with
a tree-wide grep, a fan-out census agent, or any other sweep — that trades
a cheap, targeted fix for an expensive one that has to be redone every time
the same gap is hit again.

## Typical workflow

1. `jsnode_atlas` for the whole-workspace overview by subject, or
   `jsnode_search` to find the package(s) that own a concept.
2. `jsnode_package` for one package's dependencies and dependents.
3. `jsnode_typeflow_type` to see what produces/consumes a type, and its
   `to` argument for a pipeline between two types.
4. `jsnode_query` for a structured filter projected to chosen fields.
