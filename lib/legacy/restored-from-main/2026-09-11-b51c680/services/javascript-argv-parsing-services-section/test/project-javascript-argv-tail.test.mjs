import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseLines, serializeLines } from "@red-cup-engineering/json-codec-service";
import { projectJavascriptArgvTail } from "../scripts/project-javascript-argv-tail.mjs";

const command = fileURLToPath(new URL("../scripts/project-javascript-argv-tail.mjs", import.meta.url));
const vector = { type: "JavascriptArgumentVector", version: 1, arguments: ["/usr/bin/node", "/scripts/program.mjs", "--name", "Ada"] };

test("projects only the user argument tail", () => {
  assert.deepEqual(projectJavascriptArgvTail(vector), { type: "JavascriptArgvTail", version: 1, arguments: ["--name", "Ada"] });
});

test("refuses inexact, short, and non-string vectors", () => {
  assert.throws(() => projectJavascriptArgvTail({ ...vector, extra: true }), /exactly/);
  assert.throws(() => projectJavascriptArgvTail({ ...vector, arguments: ["node"] }), /runtime and program/);
  assert.throws(() => projectJavascriptArgvTail({ ...vector, arguments: ["node", "program", 3] }), /string/);
});

test("command maps the same operation over NDJSON", () => {
  const inputs = [vector, { ...vector, arguments: ["node", "program"] }];
  const result = spawnSync(process.execPath, [command], { input: serializeLines(inputs), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseLines(result.stdout), inputs.map(projectJavascriptArgvTail));
});
