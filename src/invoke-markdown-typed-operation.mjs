import { markdownTextOperations } from "@red-cup-engineering/markdown-engineering-services-section/type/markdown-text-engine";
import { invokeTextOperation } from "./invoke-text-operation.mjs";

/**
 * Invoke a Markdown operation as a typed-operation-request
 * (`operationId: "markdown:<operation>"`), through namespaced text-operation
 * dispatch. This is the typed entry point alongside the existing
 * bare-JSON `invokeMarkdownService`/CLI bins in `markdown.mjs` and
 * `scripts/markdown-services.mjs`, which are unchanged.
 *
 * @param {unknown} request A typed-operation-request message.
 */
export async function invokeMarkdownTypedOperation(request) {
  return invokeTextOperation({ operations: markdownTextOperations, request });
}
