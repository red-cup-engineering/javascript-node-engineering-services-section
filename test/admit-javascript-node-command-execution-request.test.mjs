import assert from "node:assert/strict";
import test from "node:test";
import { admitJavascriptNodeCommandExecutionRequest } from "../scripts/admit-javascript-node-command-execution-request.mjs";

const valid = { type: "JavascriptNodeCommandExecutionRequest", version: 1, command: "node", arguments: ["--version"], directory: "/tmp", environment: null, input: null };

test("admits an exact valid request unchanged", () => {
  assert.deepEqual(admitJavascriptNodeCommandExecutionRequest(valid), valid);
});

test("refuses a request missing a required field", () => {
  const { input, ...withoutInput } = valid;
  assert.throws(() => admitJavascriptNodeCommandExecutionRequest(withoutInput), TypeError);
});

test("refuses a non-absolute directory", () => {
  assert.throws(() => admitJavascriptNodeCommandExecutionRequest({ ...valid, directory: "relative/path" }), TypeError);
});

test("refuses the wrong type discriminant", () => {
  assert.throws(() => admitJavascriptNodeCommandExecutionRequest({ ...valid, type: "SomethingElse" }), TypeError);
});

test("refuses a non-string argument", () => {
  assert.throws(() => admitJavascriptNodeCommandExecutionRequest({ ...valid, arguments: [1] }), TypeError);
});
