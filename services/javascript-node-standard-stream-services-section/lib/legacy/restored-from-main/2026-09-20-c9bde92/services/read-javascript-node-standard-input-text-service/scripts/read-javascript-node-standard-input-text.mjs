#!/usr/bin/env node
import { immutableJsonValue } from "../../../../../../../../../../computer-data-engineering-services-section/services/serialized-computer-data-engineering-services-section/services/json-services-section/src/index.mjs";
import { serializeLines } from "../../../../../../../../../../computer-data-engineering-services-section/services/serialized-computer-data-engineering-services-section/services/json-services-section/src/index.mjs";

/**
 * Reads one supplied Node standard-input capability completely as UTF-8 text.
 *
 * @param {object} request A JavascriptNodeStandardInputTextReadRequest@1.
 * @param {object} capabilities The live standardInput stream capability, kept outside the JSON request.
 * @returns {Promise<object>} An immutable JavascriptNodeStandardInputTextRead@1 carrying the complete text.
 * @throws {TypeError} When the request is inexact or the capability is not an async iterable stream.
 */
export async function readJavascriptNodeStandardInputText(request, capabilities) {
  if (request === null || typeof request !== "object" || Array.isArray(request) || Object.keys(request).sort().join(",") !== "type,version") throw new TypeError("request must carry exactly type and version");
  if (request.type !== "JavascriptNodeStandardInputTextReadRequest" || request.version !== 1) throw new TypeError("request type and version must be JavascriptNodeStandardInputTextReadRequest@1");
  const standardInput = capabilities?.standardInput;
  if (!standardInput || typeof standardInput[Symbol.asyncIterator] !== "function") throw new TypeError("standardInput capability must be an async iterable readable stream");
  standardInput.setEncoding?.("utf8");
  let text = "";
  for await (const chunk of standardInput) text += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  return immutableJsonValue({ type: "JavascriptNodeStandardInputTextRead", version: 1, text });
}

if (import.meta.main) {
  const read = await readJavascriptNodeStandardInputText({ type: "JavascriptNodeStandardInputTextReadRequest", version: 1 }, { standardInput: process.stdin });
  process.stdout.write(serializeLines([read]));
}
