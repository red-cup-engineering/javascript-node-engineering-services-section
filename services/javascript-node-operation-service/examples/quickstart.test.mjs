import assert from "node:assert/strict";
import test from "node:test";
import { createJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-operation-service";

test("NODE-OPERATION-QUICKSTART", async () => {
  const operation = createJavascriptNodeOperation({
    name: "double", description: "Double a number.",
    inputSchema: { type: "number" }, outputSchema: { type: "number" },
    operation: value => value * 2,
  });
  assert.deepEqual(await operation.invoke(3), { ok: true, value: 6 });
});
