import assert from "node:assert/strict";
import test from "node:test";
import { argument, javascriptArgvParseReadSchema, javascriptArgvParsingRequestSchema, parseArgv, parseJavascriptArgv, projectJavascriptArgvTail, repeatedArgument, requiredArgument } from "../src/argv.mjs";

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

test("publishes JSON Schemas for the parsing morphism's domain and codomain", () => {
  assert.equal(javascriptArgvParsingRequestSchema.type, "object");
  assert.deepEqual(javascriptArgvParsingRequestSchema.required, ["type", "version", "argumentVector", "options", "allowPositionals", "strict"]);
  assert.equal(javascriptArgvParseReadSchema.properties.type.const, "JavascriptArgvParseRead");
});

test("refuses options outside a strict grammar and inexact requests", () => {
  assert.throws(() => parseJavascriptArgv({ ...request, argumentVector: { ...request.argumentVector, arguments: ["node", "program", "--mystery"] } }), /Unknown option/);
  assert.throws(() => parseJavascriptArgv({ ...request, extra: true }), /exactly/);
});

test("projectJavascriptArgvTail drops the runtime and program addresses", () => {
  assert.deepEqual(projectJavascriptArgvTail({ type: "JavascriptArgumentVector", version: 1, arguments: ["node", "program", "--flag", "value"] }), {
    type: "JavascriptArgvTail", version: 1, arguments: ["--flag", "value"],
  });
});

test("argument returns undefined when a named token is missing", () => {
  assert.equal(argument("--missing", ["node", "program", "--present", "value"]), undefined);
});

test("argument returns the value following the first duplicate token", () => {
  assert.equal(argument("--name", ["node", "program", "--name", "first", "--name", "second"]), "first");
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

test("requiredArgument returns the value following the first duplicate token", () => {
  assert.equal(requiredArgument("--name", ["node", "program", "--name", "first", "--name", "second"]), "first");
});

test("requiredArgument throws when the named token is missing", () => {
  assert.throws(() => requiredArgument("--missing", ["node", "program", "--present", "value"]), /--missing is required/);
});

test("requiredArgument throws when the named token trails the vector", () => {
  assert.throws(() => requiredArgument("--name", ["node", "program", "--name"]), /--name is required/);
});

test("repeatedArgument returns every value following the named token, in order", () => {
  assert.deepEqual(repeatedArgument("--tag", ["node", "program", "--tag", "a", "--other", "x", "--tag", "b"]), ["a", "b"]);
});

test("repeatedArgument returns an empty array when the named token is absent", () => {
  assert.deepEqual(repeatedArgument("--tag", ["node", "program"]), []);
});

test("repeatedArgument skips a trailing occurrence with no following value", () => {
  assert.deepEqual(repeatedArgument("--tag", ["node", "program", "--tag", "a", "--tag"]), ["a"]);
});

test("parseArgv reads positionals, a boolean switch, and a valued option by name", () => {
  const read = parseArgv(["verb", "--force", "--out", "file.txt", "rest"], new Set(["out"]));
  assert.deepEqual(read.positionals, ["verb", "rest"]);
  assert.deepEqual(read.values, { force: true, out: "file.txt" });
});

test("parseArgv reads an explicit --key=value pair regardless of valuedOptions", () => {
  const read = parseArgv(["--name=value"], new Set());
  assert.deepEqual(read.values, { name: "value" });
});

test("parseArgv collects a repeated option into an array of strings", () => {
  const read = parseArgv(["--tag", "a", "--tag", "b"], new Set(["tag"]));
  assert.deepEqual(read.values, { tag: ["a", "b"] });
});

test("parseArgv treats every token after -- as positional, including flag-shaped ones", () => {
  const read = parseArgv(["--", "--not-a-flag", "-"], new Set());
  assert.deepEqual(read.positionals, ["--not-a-flag", "-"]);
  assert.deepEqual(read.values, {});
});

test("parseArgv treats a bare - as positional", () => {
  const read = parseArgv(["-"], new Set());
  assert.deepEqual(read.positionals, ["-"]);
});

test("parseArgv throws on an empty option name", () => {
  assert.throws(() => parseArgv(["--=x"], new Set()), /empty option name/);
});

test("parseArgv throws when a valued option's argument is missing", () => {
  assert.throws(() => parseArgv(["--out"], new Set(["out"])), /--out. argument missing/);
});
