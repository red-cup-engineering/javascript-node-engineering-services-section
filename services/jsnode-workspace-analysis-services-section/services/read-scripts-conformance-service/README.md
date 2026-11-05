# @red-cup-engineering/read-scripts-conformance-service

Reads every script under one package's scripts/ directory against THE RULE.

## Operation

~~~js
export function readScriptsConformance(request)
~~~

### Parameters

- request (object): A record with packageDir.

### Returns

object: A ScriptsConformance record.

### Refusals

- TypeError: When packageDir is absent.

## Command

read-scripts-conformance reads one JSON value per input line and writes one JSON value per output line.

## Examples

### a package without scripts has zero totals

Input:

~~~json
{
  "packageDir": "/nonexistent-package-for-the-example"
}
~~~

Output:

~~~json
{
  "type": "ScriptsConformance",
  "packageDir": "/nonexistent-package-for-the-example",
  "scripts": [],
  "totals": {
    "scripts": 0,
    "conformant": 0,
    "nonconformant": 0,
    "lines": 0
  }
}
~~~
