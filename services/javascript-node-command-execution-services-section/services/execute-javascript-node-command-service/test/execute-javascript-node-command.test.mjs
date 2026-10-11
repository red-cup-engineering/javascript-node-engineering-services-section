import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseLines, serializeLines } from "@red-cup-engineering/jsonl-services-section";
import { executeJavascriptNodeCommand } from "../scripts/execute-javascript-node-command.mjs";

test("executes an explicit program and argument vector without a shell", () => {
  const request = {
    type: "JavascriptNodeCommandExecutionRequest",
    version: 1,
    command: process.execPath,
    arguments: ["-e", "process.stdout.write(process.argv[1])", "hello"],
    directory: tmpdir(),
    environment: null,
    input: null,
  };
  const receipt = executeJavascriptNodeCommand(request);
  assert.deepEqual(receipt.request, request);
  assert.equal(receipt.result.status, 0);
  assert.equal(receipt.result.stdout, "hello");
  assert.equal(receipt.result.stderr, "");
});

test("returns spawn failure as receipt evidence", () => {
  const receipt = executeJavascriptNodeCommand({
    type: "JavascriptNodeCommandExecutionRequest",
    version: 1,
    command: "command-that-does-not-exist-for-command-service-test",
    arguments: [],
    directory: tmpdir(),
    environment: null,
    input: null,
  });
  assert.equal(receipt.result.status, null);
  assert.match(receipt.result.error, /ENOENT/u);
});

test("refuses every implicit execution field", () => {
  assert.throws(() => executeJavascriptNodeCommand({
    type: "JavascriptNodeCommandExecutionRequest",
    version: 1,
    command: process.execPath,
    arguments: [],
    directory: tmpdir(),
    environment: null,
  }), TypeError);
});

test("the NDJSON command face executes the same requests", () => {
  const requests = ["first", "second"].map((value) => ({
    type: "JavascriptNodeCommandExecutionRequest",
    version: 1,
    command: process.execPath,
    arguments: ["-e", "process.stdout.write(process.argv[1])", value],
    directory: tmpdir(),
    environment: null,
    input: null,
  }));
  const imported = requests.map((request) => executeJavascriptNodeCommand(request));
  const command = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/execute-javascript-node-command.mjs", import.meta.url))],
    { input: serializeLines(requests), encoding: "utf8" },
  );
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(parseLines(command.stdout), imported);
});
