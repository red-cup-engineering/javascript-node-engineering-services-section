import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { admitJavascriptNodeCommandExecutionRequest } from "../scripts/admit-javascript-node-command-execution-request.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "admits a valid request unchanged",
    "input": {
      "type": "JavascriptNodeCommandExecutionRequest",
      "version": 1,
      "command": "node",
      "arguments": [
        "--version"
      ],
      "directory": "/tmp",
      "environment": null,
      "input": null
    },
    "output": {
      "type": "JavascriptNodeCommandExecutionRequest",
      "version": 1,
      "command": "node",
      "arguments": [
        "--version"
      ],
      "directory": "/tmp",
      "environment": null,
      "input": null
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await admitJavascriptNodeCommandExecutionRequest(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/admit-javascript-node-command-execution-request.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
