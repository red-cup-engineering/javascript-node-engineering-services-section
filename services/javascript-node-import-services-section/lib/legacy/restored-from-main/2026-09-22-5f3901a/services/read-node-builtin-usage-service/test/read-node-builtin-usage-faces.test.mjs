import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readNodeBuiltinUsage } from "../scripts/read-node-builtin-usage.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "finds a mapped call site",
    "input": {
      "path": "scripts/x.mjs",
      "text": "import { readFileSync } from \"node:fs\";\nconst t = readFileSync(\"/x\", \"utf8\");\n"
    },
    "output": {
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
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await readNodeBuiltinUsage(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/read-node-builtin-usage.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
