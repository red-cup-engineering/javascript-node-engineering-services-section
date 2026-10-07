import { invokeTypedOperation } from "./invoke-typed-operation.mjs";

/**
 * Invoke one text-tier operation. This does not redefine typed-operation
 * dispatch — it delegates to `invokeTypedOperation` — it only enforces the
 * text tier's own rule: an operationId reaching this engine must already be
 * namespaced (`domain:operation`), so a text-tier caller can never dispatch
 * an unqualified, ambiguous operation name.
 *
 * @param {{operations: Record<string, (input: unknown) => unknown>, request: unknown}} invocation
 */
export async function invokeTextOperation({ operations, request } = {}) {
  const operationId = request?.operationId;
  if (typeof operationId !== "string" || !operationId.includes(":")) {
    return Object.freeze({
      version: 1,
      kind: "typed-operation-refusal",
      requestId: typeof request?.requestId === "string" && request.requestId !== "" ? request.requestId : "unknown",
      code: "unnamespaced-operation",
      message: "computer-text-engine requires a namespaced operationId (domain:operation)",
    });
  }
  return invokeTypedOperation({ operations, request });
}
