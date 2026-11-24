# @red-cup-engineering/audit-node-builtin-imports-service

Audits one JavaScript source text for single-line imports of Node built-in modules that a Group service owns, exempting the owner itself.

## Operation

~~~js
export function auditNodeBuiltinImports(request)
~~~

### Parameters

- request (object): A record with the source path, its text, and optionally the name of the package it belongs to.

### Returns

object: A NodeBuiltinImportAudit record.

### Refusals

- TypeError: When path or text is not a string.

## Command

audit-node-builtin-imports reads one JSON value per input line and writes one JSON value per output line.

## Examples

### finds one owned import

Input:

~~~json
{
  "path": "scripts/x.mjs",
  "text": "import { readFileSync } from \"node:fs\";\n"
}
~~~

Output:

~~~json
{
  "type": "NodeBuiltinImportAudit",
  "path": "scripts/x.mjs",
  "findings": [
    {
      "line": 1,
      "builtin": "node:fs",
      "houseService": "@red-cup-engineering/file-services"
    }
  ],
  "count": 1
}
~~~
