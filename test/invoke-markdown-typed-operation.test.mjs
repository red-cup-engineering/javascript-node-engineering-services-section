import assert from "node:assert/strict";
import test from "node:test";
import { invokeMarkdownTypedOperation } from "@red-cup-engineering/javascript-node-services-section/invoke-markdown-typed-operation";

function request(overrides = {}) {
  return {
    version: 1,
    kind: "typed-operation-request",
    requestId: "r1",
    operationId: "markdown:read-markdown-features",
    inputCodec: "json",
    input: JSON.stringify({ text: "# heading\n\nbody" }),
    outputCodec: "json",
    actorResourceCatalog: {},
    ...overrides,
  };
}

test("dispatches a namespaced Markdown operation through text-operation dispatch", async () => {
  const result = await invokeMarkdownTypedOperation(request());
  assert.equal(result.kind, "typed-operation-result");
  assert.equal(result.requestId, "r1");
  assert.ok(JSON.parse(result.output));
});

test("refuses a bare, unnamespaced operationId", async () => {
  const result = await invokeMarkdownTypedOperation(request({ operationId: "read-markdown-features" }));
  assert.equal(result.kind, "typed-operation-refusal");
  assert.equal(result.code, "unnamespaced-operation");
});

test("refuses an operation namespaced under a domain Markdown never registered", async () => {
  const result = await invokeMarkdownTypedOperation(request({ operationId: "document:count-words" }));
  assert.equal(result.kind, "typed-operation-refusal");
  assert.equal(result.code, "unknown-operation");
});
