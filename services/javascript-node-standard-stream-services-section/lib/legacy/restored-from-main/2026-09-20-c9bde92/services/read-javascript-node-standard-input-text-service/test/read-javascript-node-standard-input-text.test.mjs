import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseLines } from "../../../../../../../../../../computer-data-engineering-services-section/services/serialized-computer-data-engineering-services-section/services/json-services-section/src/index.mjs";
import { readJavascriptNodeStandardInputText } from "../scripts/read-javascript-node-standard-input-text.mjs";

const request = { type: "JavascriptNodeStandardInputTextReadRequest", version: 1 };
const command = fileURLToPath(new URL("../scripts/read-javascript-node-standard-input-text.mjs", import.meta.url));

test("reads the supplied stream capability as one explicit text read", async () => {
  assert.deepEqual(await readJavascriptNodeStandardInputText(request, { standardInput: Readable.from(["hello", " ", "world"]) }), { type: "JavascriptNodeStandardInputTextRead", version: 1, text: "hello world" });
});

test("refuses inexact requests and values which are not readable streams", async () => {
  await assert.rejects(() => readJavascriptNodeStandardInputText({ ...request, extra: true }, { standardInput: Readable.from([]) }), /exactly/);
  await assert.rejects(() => readJavascriptNodeStandardInputText(request, { standardInput: {} }), /async iterable readable stream/);
});

test("command emits the same read record for its physical standard input", () => {
  const result = spawnSync(process.execPath, [command], { input: "hello world", encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseLines(result.stdout), [{ type: "JavascriptNodeStandardInputTextRead", version: 1, text: "hello world" }]);
});
