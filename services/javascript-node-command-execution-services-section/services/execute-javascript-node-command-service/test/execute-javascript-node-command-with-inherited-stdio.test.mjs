import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import { executeJavascriptNodeCommandWithInheritedStdio } from "../scripts/execute-javascript-node-command-with-inherited-stdio.mjs";

test("executes an explicit program with inherited stdio and reports its exit status", () => {
  const receipt = executeJavascriptNodeCommandWithInheritedStdio({
    command: process.execPath,
    arguments: ["-e", "process.exit(0)"],
    directory: tmpdir(),
  });
  assert.equal(receipt.type, "JavascriptNodeCommandExecutionInheritedStdioResult");
  assert.equal(receipt.status, 0);
  assert.equal(receipt.signal, null);
  assert.equal(receipt.error, "");
});

test("reports a nonzero exit status", () => {
  const receipt = executeJavascriptNodeCommandWithInheritedStdio({
    command: process.execPath,
    arguments: ["-e", "process.exit(3)"],
    directory: tmpdir(),
  });
  assert.equal(receipt.status, 3);
});

test("returns spawn failure as receipt evidence", () => {
  const receipt = executeJavascriptNodeCommandWithInheritedStdio({
    command: "command-that-does-not-exist-for-inherited-stdio-test",
    arguments: [],
    directory: tmpdir(),
  });
  assert.equal(receipt.status, null);
  assert.match(receipt.error, /ENOENT/u);
});

test("refuses a missing command", () => {
  assert.throws(() => executeJavascriptNodeCommandWithInheritedStdio({ arguments: [], directory: tmpdir() }), TypeError);
});
