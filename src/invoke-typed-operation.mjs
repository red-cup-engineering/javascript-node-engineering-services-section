import { admit } from "@red-cup-engineering/signcell/type-system";
import {
  TYPED_OPERATION_MESSAGE_VERSION,
  TYPED_OPERATION_REFUSAL_KIND,
  TYPED_OPERATION_RESULT_KIND,
  typedOperationRequestType,
} from "@red-cup-engineering/signcell/typed-operation-message";

const CODECS = Object.freeze({
  json: Object.freeze({
    decode: (text) => JSON.parse(text),
    encode: (value) => JSON.stringify(value),
  }),
});

function refusalMessage(requestId, code, message) {
  return Object.freeze({
    version: TYPED_OPERATION_MESSAGE_VERSION,
    kind: TYPED_OPERATION_REFUSAL_KIND,
    requestId: typeof requestId === "string" && requestId !== "" ? requestId : "unknown",
    code,
    message,
  });
}

function resultMessage(requestId, outputCodec, output) {
  return Object.freeze({ version: TYPED_OPERATION_MESSAGE_VERSION, kind: TYPED_OPERATION_RESULT_KIND, requestId, outputCodec, output });
}

/**
 * Invoke one operation registered under `operations` against a
 * typed-operation-request message. This is the content-engineering
 * composition boundary every content-typed engine (text, markdown, and so
 * on) dispatches through rather than reimplementing its own admission,
 * codec, and refusal handling: it admits the request against
 * computer-data-engine's own typed-operation-message contract, decodes and
 * encodes by the request's declared codec, invokes the registered handler,
 * and reports every failure as a typed-operation-refusal instead of
 * throwing.
 *
 * @param {{operations: Record<string, (input: unknown) => unknown>, request: unknown}} invocation
 * @returns {Promise<Readonly<Record<string, unknown>>>} A typed-operation-result or typed-operation-refusal message.
 */
export async function invokeTypedOperation({ operations, request } = {}) {
  if (operations === null || typeof operations !== "object") throw new TypeError("operations must be a registered operation table");
  const admission = admit(typedOperationRequestType, request);
  if (!admission.ok) {
    const detail = admission.refusal.issues.map((issue) => issue.message).join("; ") || "request does not satisfy typed-operation-request";
    return refusalMessage(request?.requestId, "malformed-request", detail);
  }
  const { requestId, operationId, inputCodec, input, outputCodec } = admission.value;
  const inCodec = CODECS[inputCodec];
  const outCodec = CODECS[outputCodec];
  if (!inCodec || !outCodec) return refusalMessage(requestId, "unsupported-codec", `unsupported codec ${inputCodec}/${outputCodec}`);
  const handler = operations[operationId];
  if (typeof handler !== "function") return refusalMessage(requestId, "unknown-operation", `unknown operation ${operationId}`);
  let decoded;
  try {
    decoded = inCodec.decode(input);
  } catch (error) {
    return refusalMessage(requestId, "malformed-input", error.message);
  }
  let output;
  try {
    output = await handler(decoded);
  } catch (error) {
    return refusalMessage(requestId, "operation-failed", error.message);
  }
  return resultMessage(requestId, outputCodec, outCodec.encode(output));
}
