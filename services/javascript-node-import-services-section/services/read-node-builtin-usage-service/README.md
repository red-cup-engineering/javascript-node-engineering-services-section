# @red-cup-engineering/read-node-builtin-usage-service

Reads one JavaScript ESM script's source into a NodeBuiltinUsageReading record: every node: import specifier it declares, and every call site of an imported Node built-in with its line, exact form, whether it is awaited, and the node-builtin-to-house-hand mapping id it matches, or null when no exact mapping is known yet — a pure AST reading with no filesystem access.

## Operation

~~~js
export function readNodeBuiltinUsage(request)
~~~

### Parameters

- request (object): A record with `text` (the complete JavaScript ESM source of one script) and `path` (its scripts/<name>.mjs path, at any depth).

### Returns

object: A NodeBuiltinUsageReading record: type, version, path, imports, callSites, count.

### Refusals

- TypeError: When text is not a string, or path does not end in scripts/<name>.mjs.
- SyntaxError: When the carried JavaScript does not parse (propagated from the TypeScript source-file parse).

## Command

read-node-builtin-usage reads one JSON value per input line and writes one JSON value per output line.

## Examples

### finds a mapped call site

Input:

~~~json
{
  "path": "scripts/x.mjs",
  "text": "import { readFileSync } from \"node:fs\";\nconst t = readFileSync(\"/x\", \"utf8\");\n"
}
~~~

Output:

~~~json
{
  "type": "NodeBuiltinUsageReading",
  "version": 1,
  "path": "scripts/x.mjs",
  "imports": [
    {
      "line": 1,
      "builtin": "node:fs",
      "names": [
        "readFileSync"
      ],
      "default": null,
      "namespace": null
    }
  ],
  "callSites": [
    {
      "line": 2,
      "builtin": "node:fs",
      "importedName": "readFileSync",
      "form": "readFileSync(\"/x\", \"utf8\")",
      "awaited": false,
      "mappingId": "map-fs-read-file-sync"
    }
  ],
  "count": 1
}
~~~
