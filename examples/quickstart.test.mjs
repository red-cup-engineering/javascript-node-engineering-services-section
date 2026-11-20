import assert from "node:assert/strict";
import test from "node:test";
import { invokeTextOperation } from "@red-cup-engineering/javascript-node-engineering-services-section/invoke-text-operation";

test("NODE-RUNTIME-QUICKSTART", async () => {
  const result = await invokeTextOperation({
    operations: { "text:count": value => value.length },
    request: {
      version: 1,
      kind: "typed-operation-request",
      requestId: "count",
      operationId: "text:count",
      inputCodec: "json",
      input: JSON.stringify("rain"),
      outputCodec: "json",
      actorResourceCatalog: {},
    },
  });

  assert.equal(result.kind, "typed-operation-result");
  assert.equal(JSON.parse(result.output), 4);
});
