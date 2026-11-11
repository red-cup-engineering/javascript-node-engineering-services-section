import assert from "node:assert/strict";
import test from "node:test";
import { parseJavaScript } from "../src/javascript-parser.mjs";

test("JS-PARSER-REFUSAL", () => {
  assert.throws(() => parseJavaScript("export const = 2;"), SyntaxError);
});
