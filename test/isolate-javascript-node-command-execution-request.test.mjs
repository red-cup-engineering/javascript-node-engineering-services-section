import assert from "node:assert/strict";
import test from "node:test";
import { isolateJavascriptNodeCommandExecutionRequest } from "../scripts/isolate-javascript-node-command-execution-request.mjs";

const request = { type: "JavascriptNodeCommandExecutionRequest", version: 1, command: "/tools/bin/node", arguments: ["/inputs/probe.mjs"], directory: "/work", environment: { HOME: "/work/home" }, input: "synthetic input\n" };
const isolation = (hidden = []) => ({ type: "JavascriptNodeCommandIsolationRequest", version: 1, hidden, readable: ["/tools", "/inputs"], writable: ["/work"], request });
const at = (args, option, path) => args.findIndex((value, index) => value === option && args[index + 1] === path);

test("non-root hiding preserves the existing complete command request", () => {
  assert.deepEqual(isolateJavascriptNodeCommandExecutionRequest(isolation(["/private"])), {
    type: "JavascriptNodeCommandExecutionRequest", version: 1, command: "bwrap",
    arguments: ["--die-with-parent", "--new-session", "--unshare-all", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc",
      "--tmpfs", "/private", "--ro-bind", "/tools", "/tools", "--ro-bind", "/inputs", "/inputs", "--bind", "/work", "/work",
      "--chdir", "/work", "--clearenv", "--setenv", "HOME", "/work/home", "--", "/tools/bin/node", "/inputs/probe.mjs"],
    directory: "/work", environment: null, input: request.input,
  });
});

for (const hidden of [["/", "/private"], ["/private", "/"]]) {
  test(`hidden root precedes fresh synthetic dev/proc when declared ${hidden[0] === "/" ? "first" : "last"}`, () => {
    const args = isolateJavascriptNodeCommandExecutionRequest(isolation(hidden)).arguments;
    assert.ok(at(args, "--tmpfs", "/") < at(args, "--dev", "/dev"));
    assert.ok(at(args, "--tmpfs", "/") < at(args, "--proc", "/proc"));
    assert.ok(at(args, "--proc", "/proc") < at(args, "--tmpfs", "/private"));
    assert.equal(args.filter(value => value === "--dev").length, 1);
    assert.equal(args.filter(value => value === "--proc").length, 1);
  });
}

test("explicit dev/proc masks remain after synthetic mounts and before caller grants", () => {
  const args = isolateJavascriptNodeCommandExecutionRequest(isolation(["/dev", "/proc", "/", "/private"])).arguments;
  assert.ok(at(args, "--tmpfs", "/") < at(args, "--dev", "/dev"));
  assert.ok(at(args, "--dev", "/dev") < at(args, "--tmpfs", "/dev"));
  assert.ok(at(args, "--proc", "/proc") < at(args, "--tmpfs", "/proc"));
  assert.ok(at(args, "--tmpfs", "/dev") < at(args, "--tmpfs", "/proc"));
  assert.ok(at(args, "--tmpfs", "/proc") < at(args, "--tmpfs", "/private"));
  assert.ok(at(args, "--tmpfs", "/private") < at(args, "--ro-bind", "/tools"));
});

test("root ordering adds no host bind or environment and preserves explicit grants and input", () => {
  const source = isolation(["/"]), before = structuredClone(source);
  const wrapped = isolateJavascriptNodeCommandExecutionRequest(source), args = wrapped.arguments;
  assert.deepEqual(source, before);
  assert.deepEqual(args.slice(at(args, "--ro-bind", "/tools")), ["--ro-bind", "/tools", "/tools", "--ro-bind", "/inputs", "/inputs", "--bind", "/work", "/work",
    "--chdir", "/work", "--clearenv", "--setenv", "HOME", "/work/home", "--", "/tools/bin/node", "/inputs/probe.mjs"]);
  assert.equal(args.includes("--share-net"), false);
  assert.equal(args.filter(value => value === "--unshare-all").length, 1);
  assert.equal(at(args, "--ro-bind", "/dev"), -1);
  assert.equal(at(args, "--ro-bind", "/proc"), -1);
  assert.equal(wrapped.environment, null); assert.equal(wrapped.input, request.input);
});

test("the same exact isolation and nested request contracts still refuse malformed values", () => {
  for (const value of [null, {}, { ...isolation(), extra: true }, { ...isolation(), hidden: ["relative"] },
    { ...isolation(), readable: ["/tools/../inputs"] }, { ...isolation(), writable: ["/work/"] },
    { ...isolation(), request: { ...request, command: "" } }, { ...isolation(), request: { ...request, arguments: [1] } }]) {
    assert.throws(() => isolateJavascriptNodeCommandExecutionRequest(value), TypeError);
  }
});
