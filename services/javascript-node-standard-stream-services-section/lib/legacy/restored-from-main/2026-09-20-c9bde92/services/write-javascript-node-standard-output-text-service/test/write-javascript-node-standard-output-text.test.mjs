import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import { writeJavascriptNodeStandardOutputText } from "../scripts/write-javascript-node-standard-output-text.mjs";

test("writes the complete request text and returns an explicit effect receipt", async () => {
  let observed = "";
  const standardOutput = new Writable({ write(chunk, _encoding, callback) { observed += chunk.toString(); callback(); } });
  const receipt = await writeJavascriptNodeStandardOutputText({ type: "JavascriptNodeStandardOutputTextWriteRequest", version: 1, text: "hello\n" }, { standardOutput });
  assert.equal(observed, "hello\n");
  assert.deepEqual(receipt, { type: "JavascriptNodeStandardOutputTextWriteReceipt", version: 1, characterCount: 6 });
});

test("refuses inexact requests and non-writable capabilities", async () => {
  await assert.rejects(() => writeJavascriptNodeStandardOutputText({ type: "JavascriptNodeStandardOutputTextWriteRequest", version: 1, text: "", extra: true }, { standardOutput: process.stdout }), /exactly/);
  await assert.rejects(() => writeJavascriptNodeStandardOutputText({ type: "JavascriptNodeStandardOutputTextWriteRequest", version: 1, text: "" }, { standardOutput: {} }), /writable/);
});
