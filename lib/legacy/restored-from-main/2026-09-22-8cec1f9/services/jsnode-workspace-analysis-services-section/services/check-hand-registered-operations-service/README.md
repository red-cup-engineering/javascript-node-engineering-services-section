# @red-cup-engineering/check-hand-registered-operations-service

Reads one catalog module's source text and counts every statically
module-named `yield Object.freeze({ module: "...", ... })` statement --
the hand-imported operation families the catalog registers from inside
the package rather than mounting from a FERN's admitted operations. A
`yield` inside a loop over an externally supplied source never matches,
because its `module` is a loop variable, not a literal string.

## Operation

~~~js
export async function checkHandRegisteredOperations(input)
~~~

### Parameters

- input ({ catalogPath: string, baseline: number }): 

### Returns

Promise<{ kind: "check-hand-registered-operations", count: number,
 *   baseline: number, ok: boolean, families: string[] }>: 

### Refusals

- TypeError: When `input.catalogPath` or `input.baseline` is missing or malformed.

## Command

check-hand-registered-operations reads one JSON value per input line and writes one JSON value per output line.

## Examples

### a package manifest carries no hand-registered yields

Input:

~~~json
{
  "catalogPath": "package.json",
  "baseline": 0
}
~~~

Output:

~~~json
{
  "kind": "check-hand-registered-operations",
  "count": 0,
  "baseline": 0,
  "ok": true,
  "families": []
}
~~~
