import assert from "node:assert/strict";
import test from "node:test";
import {
  argument, parseArgv, parseJavascriptArgv, projectJavascriptArgvTail,
  repeatedArgument, requiredArgument, sleep,
} from "@red-cup-engineering/parse-javascript-argv-service";

test("the original host vector preserves ordinary, repeated and required option values", async () => {
  const argv = ["node", "world", "--room", "river", "--room", "harbor"];
  assert.equal(argument("--room", argv), "river");
  assert.equal(requiredArgument("--room", argv), "river");
  assert.deepEqual(repeatedArgument("--room", argv), ["river", "harbor"]);
  assert.throws(() => requiredArgument("--absent", argv));
  await sleep(0);
});

test("the parser applies the declared option grammar to only the player's argument tail", () => {
  const vector = { type: "JavascriptArgumentVector", version: 1, arguments: [
    "node", "world", "--room", "garden", "--", "--quiet",
  ] };
  const request = { type: "JavascriptArgvParsingRequest", version: 1,
    argumentVector: vector, options: { room: { type: "string" } }, allowPositionals: true, strict: true };
  assert.deepEqual(projectJavascriptArgvTail(vector).arguments, ["--room", "garden", "--", "--quiet"]);
  const read = parseJavascriptArgv(request);
  assert.deepEqual(read.options, { room: "garden" });
  assert.deepEqual(read.positionals, ["--quiet"]);
  assert.throws(() => parseJavascriptArgv({ ...request, options: {} }));
  assert.throws(() => projectJavascriptArgvTail({ ...vector, version: 2 }));
});

test("simple command options retain repeated values and the end-of-options boundary", () => {
  const parsed = parseArgv(["--room", "river", "--room=harbor", "--quiet", "--", "--room"], new Set(["room"]));
  assert.deepEqual(parsed.values, { room: ["river", "harbor"], quiet: true });
  assert.deepEqual(parsed.positionals, ["--room"]);
});
