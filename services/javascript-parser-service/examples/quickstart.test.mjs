import assert from "node:assert/strict";
import test from "node:test";
import { parseJavaScript } from "@red-cup-engineering/javascript-parser-service";

test("JS-PARSER-QUICKSTART", () => {
  const [entry] = parseJavaScript("export const value = 2;").body;
  assert.equal(entry.type, "ExportNamedDeclaration");
  const [binding] = entry.declaration.declarations;
  assert.equal(binding.id.name, "value");
  assert.equal(binding.init.value, 2);
});
