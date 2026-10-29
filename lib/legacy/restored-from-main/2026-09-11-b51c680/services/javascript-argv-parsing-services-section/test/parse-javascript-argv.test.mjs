import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseLines, serializeLines } from "@red-cup-engineering/json-codec-service";
import { argument, parseJavascriptArgv } from "../scripts/parse-javascript-argv.mjs";

const command = fileURLToPath(new URL("../scripts/parse-javascript-argv.mjs", import.meta.url));
const request = {
  type: "JavascriptArgvParsingRequest", version: 1,
  argumentVector: { type: "JavascriptArgumentVector", version: 1, arguments: ["node", "/scripts/read-info.mjs", "--keys", "name,description", "/packages"] },
  options: { keys: { type: "string" } }, allowPositionals: true, strict: true,
};

test("parses named and positional arguments from a complete vector carrier", () => {
  assert.deepEqual(parseJavascriptArgv(request), {
    type: "JavascriptArgvParseRead", version: 1, argumentVector: request.argumentVector,
    options: { keys: "name,description" }, positionals: ["/packages"],
  });
});

test("refuses options outside a strict grammar and inexact requests", () => {
  assert.throws(() => parseJavascriptArgv({ ...request, argumentVector: { ...request.argumentVector, arguments: ["node", "program", "--mystery"] } }), /Unknown option/);
  assert.throws(() => parseJavascriptArgv({ ...request, extra: true }), /exactly/);
});

test("argument returns undefined when a named token is missing", () => {
  assert.equal(argument("--missing", ["node", "program", "--present", "value"]), undefined);
});

test("argument returns the value following the first duplicate token", () => {
  assert.equal(argument("--name", ["node", "program", "--name", "first", "--name", "second"]), "first");
});

test("argument returns undefined when the named token trails the vector", () => {
  assert.equal(argument("--name", ["node", "program", "--name"]), undefined);
});

test("argument searches process.argv by default", () => {
  const originalArgumentVector = process.argv;
  process.argv = ["node", "program", "--name", "default"];
  try {
    assert.equal(argument("--name"), "default");
  } finally {
    process.argv = originalArgumentVector;
  }
});

test("command maps exactly the same parse over NDJSON requests", () => {
  const inputs = [request, { ...request, argumentVector: { ...request.argumentVector, arguments: ["node", "program"] } }];
  const result = spawnSync(process.execPath, [command], { input: serializeLines(inputs), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseLines(result.stdout), inputs.map(parseJavascriptArgv));
});
