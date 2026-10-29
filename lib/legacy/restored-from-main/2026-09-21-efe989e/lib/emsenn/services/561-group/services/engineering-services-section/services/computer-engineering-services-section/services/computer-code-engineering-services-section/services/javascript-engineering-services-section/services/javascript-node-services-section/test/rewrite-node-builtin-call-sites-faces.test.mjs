import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { rewriteNodeBuiltinCallSites } from "../scripts/rewrite-node-builtin-call-sites.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "swaps a sole spread-argument call site and its import",
    "input": {
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
    },
    "output": {
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
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await rewriteNodeBuiltinCallSites(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/rewrite-node-builtin-call-sites.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
