import assert from "node:assert/strict";
import test from "node:test";

import {
  processCommandExitCode,
  processCommandLifecycleRecord,
} from "../src/command.mjs";

const context = Object.freeze({ command: "tool", args: Object.freeze(["check"]), cwd: "/work" });
const at = "2026-09-12T00:00:00.000Z";

test("projects a successful canonical command result to a successful lifecycle", () => {
  const result = Object.freeze({ status: 0, signal: null, stdout: "done", stderr: "", error: "" });
  const lifecycle = processCommandLifecycleRecord(context, result, at, "test:success");

  assert.equal(processCommandExitCode(result), 0);
  assert.equal(lifecycle.ok, true);
  assert.deepEqual(lifecycle.events.map((event) => ({ event: event.event, ok: event.ok, code: event.code })), [
    { event: "spawn", ok: true, code: undefined },
    { event: "exit", ok: true, code: 0 },
  ]);
});

test("projects a failed canonical command result to a failed lifecycle", () => {
  const result = Object.freeze({ status: null, signal: null, stdout: "", stderr: "", error: "ENOENT" });
  const lifecycle = processCommandLifecycleRecord(context, result, at, "test:failure");

  assert.equal(processCommandExitCode(result), 1);
  assert.equal(lifecycle.ok, false);
  assert.deepEqual(lifecycle.events.map((event) => ({ event: event.event, ok: event.ok, code: event.code })), [
    { event: "spawn", ok: true, code: undefined },
    { event: "exit", ok: false, code: 1 },
  ]);
});
