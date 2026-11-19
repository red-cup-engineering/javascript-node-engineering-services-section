# @red-cup-engineering/rewrite-node-builtin-call-sites-service

Rewrites every call site of one node-builtin-to-house-hand mapping's builtin form in a JavaScript ESM source to the Group form, adding the Group import when absent and dropping the builtin import when it becomes unused — a pure text transform with no filesystem access.

## Operation

~~~js
export function rewriteNodeBuiltinCallSites(request)
~~~

### Parameters

- request (object): A record with `text` (complete JavaScript ESM source) and `mapping` (one entry from the 2026-09-04 node-builtin-to-house-hand mapping record, carrying `builtin`, `importedName`, `fromForm`, `housePackage`, `houseFunction`, `builtinIsAsync`, `houseHandIsAsync`).

### Returns

object: A record with `text` (the rewritten source), `rewrittenCallSites` (count), `importAdded` (`{source, name}` or `null`), `importRemoved` (`{source, name}` or `null`).

### Refusals

- TypeError: When `text` is not a string, `mapping` is not an object, `mapping.housePackage`/`mapping.houseFunction` is missing (a gap mapping has no Group hand to rewrite to), `mapping.builtinIsAsync` differs from `mapping.houseHandIsAsync`, or `mapping.fromForm` is not a single-rest-parameter call form (`name(...ident)`).
- SyntaxError: When the carried JavaScript does not parse (propagated from the TypeScript source-file parse).

## Command

rewrite-node-builtin-call-sites reads one JSON value per input line and writes one JSON value per output line.

## Examples

### swaps a sole spread-argument call site and its import

Input:

~~~json
{
  "text": "import { resolve } from \"node:path\";\nconst p = resolve(...parts);\n",
  "mapping": {
    "id": "map-path-resolve",
    "builtin": "node:path",
    "importedName": "resolve",
    "fromForm": "resolve(...segments)",
    "toForm": "resolveFilepath(segments)  // segments: string[]",
    "housePackage": "@red-cup-engineering/resolve-filepath-service",
    "houseVersion": "0.1.1",
    "houseFunction": "resolveFilepath",
    "builtinIsAsync": false,
    "houseHandIsAsync": false,
    "exactCallShapeMatch": true,
    "rewritableWithoutFurtherChange": true
  }
}
~~~

Output:

~~~json
{
  "text": "import { resolveFilepath } from \"@red-cup-engineering/resolve-filepath-service\";\nconst p = resolveFilepath(parts);\n",
  "rewrittenCallSites": 1,
  "importAdded": {
    "source": "@red-cup-engineering/resolve-filepath-service",
    "name": "resolveFilepath"
  },
  "importRemoved": {
    "source": "node:path",
    "name": "resolve"
  }
}
~~~
