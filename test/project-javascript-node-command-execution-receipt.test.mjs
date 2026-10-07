import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseLines, serializeLines } from "@red-cup-engineering/jsonl-services-section";
import { projectJavascriptNodeCommandExecutionReceipt } from "../scripts/project-javascript-node-command-execution-receipt.mjs";

const projection = {
  type: "JavascriptNodeCommandExecutionReceiptProjectionRequest",
  version: 1,
  request: {
    type: "JavascriptNodeCommandExecutionRequest",
    version: 1,
    command: "example",
    arguments: ["one"],
    directory: "/work",
    environment: null,
    input: null,
  },
  result: {
    type: "JavascriptNodeCommandExecutionResult",
    version: 1,
    status: 3,
    signal: null,
    stdout: "out",
    stderr: "err",
    error: "",
  },
};

test("projects the complete execution evidence to an immutable JSON receipt", () => {
  const receipt = projectJavascriptNodeCommandExecutionReceipt(projection);
  assert.deepEqual(receipt, {
    type: "JavascriptNodeCommandExecutionReceipt",
    version: 1,
    request: projection.request,
    result: projection.result,
  });
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.request.arguments), true);
  assert.equal(Object.isFrozen(receipt.result), true);
});

test("refuses incomplete and inexact boundary carriers", () => {
  assert.throws(() => projectJavascriptNodeCommandExecutionReceipt({ ...projection, extra: true }), TypeError);
  assert.throws(() => projectJavascriptNodeCommandExecutionReceipt({ ...projection, request: { ...projection.request, input: undefined } }), TypeError);
  assert.throws(() => projectJavascriptNodeCommandExecutionReceipt({ ...projection, result: { ...projection.result, error: undefined } }), TypeError);
});

test("the NDJSON command face maps the same projection over every input", () => {
  const projections = [projection, { ...projection, result: { ...projection.result, status: 0 } }];
  const command = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/project-javascript-node-command-execution-receipt.mjs", import.meta.url))],
    { input: serializeLines(projections), encoding: "utf8" },
  );
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(parseLines(command.stdout), projections.map(projectJavascriptNodeCommandExecutionReceipt));
});
