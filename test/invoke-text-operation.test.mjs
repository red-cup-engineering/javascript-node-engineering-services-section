import assert from "node:assert/strict";
import test from "node:test";
import { mergeTextOperations, namespaceTextOperations } from "@red-cup-engineering/computer-text-content-engineering-services-section/computer-text-engine";
import { invokeTextOperation } from "../src/invoke-text-operation.mjs";

const markdownOperations = namespaceTextOperations("markdown", {
  "read-markdown-features": (text) => ({ length: text.length }),
});
const documentOperations = namespaceTextOperations("document", {
  "count-words": (text) => text.split(/\s+/u).filter(Boolean).length,
});
const operations = mergeTextOperations(markdownOperations, documentOperations);

function request(overrides = {}) {
  return {
    version: 1,
    kind: "typed-operation-request",
    requestId: "r1",
    operationId: "markdown:read-markdown-features",
    inputCodec: "json",
    input: JSON.stringify("# hi"),
    outputCodec: "json",
    actorResourceCatalog: {},
    ...overrides,
  };
}

test("namespaces two domains without collision and dispatches by qualified id", async () => {
  const result = await invokeTextOperation({ operations, request: request() });
  assert.equal(result.kind, "typed-operation-result");
  assert.deepEqual(JSON.parse(result.output), { length: 4 });

  const documentResult = await invokeTextOperation({
    operations,
    request: request({ operationId: "document:count-words", input: JSON.stringify("two words") }),
  });
  assert.equal(documentResult.kind, "typed-operation-result");
  assert.equal(JSON.parse(documentResult.output), 2);
});

test("refuses an unnamespaced operationId before it ever reaches content-engine dispatch", async () => {
  const result = await invokeTextOperation({ operations, request: request({ operationId: "read-markdown-features" }) });
  assert.equal(result.kind, "typed-operation-refusal");
  assert.equal(result.code, "unnamespaced-operation");
});

test("still refuses an unregistered qualified operationId through content-engine", async () => {
  const result = await invokeTextOperation({ operations, request: request({ operationId: "markdown:missing" }) });
  assert.equal(result.kind, "typed-operation-refusal");
  assert.equal(result.code, "unknown-operation");
});
