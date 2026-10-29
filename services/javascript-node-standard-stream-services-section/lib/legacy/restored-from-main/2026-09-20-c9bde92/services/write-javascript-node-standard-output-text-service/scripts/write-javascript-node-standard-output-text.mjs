import { once } from "node:events";
import { immutableJsonValue } from "../../../../../../../../../../computer-data-engineering-services-section/services/serialized-computer-data-engineering-services-section/services/json-services-section/src/index.mjs";

/**
 * Writes one explicit text request completely to one supplied Node standard-output capability.
 *
 * @param {object} request A JavascriptNodeStandardOutputTextWriteRequest@1 carrying the text to write.
 * @param {object} capabilities The live standardOutput stream capability, kept outside the JSON request.
 * @returns {Promise<object>} An immutable JavascriptNodeStandardOutputTextWriteReceipt@1.
 * @throws {TypeError} When the request is inexact or the capability is not writable.
 */
export async function writeJavascriptNodeStandardOutputText(request, capabilities) {
  if (request === null || typeof request !== "object" || Array.isArray(request) || Object.keys(request).sort().join(",") !== "text,type,version") throw new TypeError("request must carry exactly text, type, and version");
  if (request.type !== "JavascriptNodeStandardOutputTextWriteRequest" || request.version !== 1) throw new TypeError("request type and version must be JavascriptNodeStandardOutputTextWriteRequest@1");
  if (typeof request.text !== "string") throw new TypeError("request.text must be a string");
  const standardOutput = capabilities?.standardOutput;
  if (!standardOutput || typeof standardOutput.write !== "function") throw new TypeError("standardOutput capability must be a writable stream");
  if (!standardOutput.write(request.text)) await once(standardOutput, "drain");
  return immutableJsonValue({ type: "JavascriptNodeStandardOutputTextWriteReceipt", version: 1, characterCount: request.text.length });
}
