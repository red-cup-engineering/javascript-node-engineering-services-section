import { test } from "node:test";
import assert from "node:assert/strict";

import { documentSymbol, documentPackage } from "./cycle.mts";
import type { PackageSurface } from "./surface.mts";

const SURFACE: PackageSurface = Object.freeze({
  name: "@test/widget",
  description: "A test widget package.",
  dir: "/tmp/widget",
  symbols: Object.freeze([
    Object.freeze({ name: "wordCount", kind: "function" as const, signature: "export function wordCount(body: string): number", doc: "Count words.", file: "a.mts", rank: 3 }),
    Object.freeze({ name: "proseLines", kind: "function" as const, signature: "export function proseLines(body: string): string", doc: "", file: "a.mts", rank: 1 }),
  ]),
});

const GOOD_REPLY = [
  "SUMMARY: wordCount returns how many word-like tokens a body of prose holds.",
  "DETAILS: It splits the body on whitespace and counts each token that contains a letter or digit, so punctuation does not inflate the total. Reach for it when a length must be measured in words.",
  "EXAMPLE:",
  "```ts",
  "wordCount(\"one two three\");",
  "```",
].join("\n");

test("documentSymbol ships a clean reply in one call", async () => {
  let calls = 0;
  const result = await documentSymbol(SURFACE, "wordCount", {
    ask: () => {
      calls += 1;
      return GOOD_REPLY;
    },
  });
  assert.equal(result.shipped, true);
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
  assert.match(result.entry, /### `wordCount`/);
});

test("documentSymbol revises after a hallucination, then ships", async () => {
  const replies = [
    "SUMMARY: wordCount counts the words.\nDETAILS: It calls tokenizeMagically(body) under the hood to perform a careful split before counting each resulting token one by one.\nEXAMPLE:\nnone",
    GOOD_REPLY,
  ];
  let i = 0;
  const result = await documentSymbol(SURFACE, "wordCount", {
    ask: () => replies[i++] ?? GOOD_REPLY,
  });
  assert.equal(result.attempts, 2);
  assert.equal(result.shipped, true);
});

test("documentSymbol withholds (does not throw) when gates never clear within the budget", async () => {
  const result = await documentSymbol(SURFACE, "wordCount", {
    ask: () => "SUMMARY: It uses fakeApiCall() to do the thing.\nDETAILS: This invents nonexistentHelper(x) and keeps right on inventing more and more API that the surface does not vouch for at all.\nEXAMPLE:\nnone",
    maxRevisions: 1,
  });
  assert.equal(result.shipped, false);
  assert.equal(result.attempts, 2);
  assert.ok(result.gates.some((g) => g.gate === "no-hallucinated-api" && g.charge === "fail"));
});

test("documentSymbol throws on a symbol the surface does not export", async () => {
  await assert.rejects(
    documentSymbol(SURFACE, "noSuchSymbol", { ask: () => GOOD_REPLY }),
    /exports no symbol/,
  );
});

const PROSE_REPLY = [
  "SUMMARY: proseLines keeps only the prose lines of a body, dropping heading lines.",
  "DETAILS: It walks the body line by line and keeps those that are not markdown headings, so sentence-level analysis never trips over a heading. Reach for it before counting or linting.",
  "EXAMPLE:",
  "none",
].join("\n");

test("documentPackage composes a reference over the surface and reports limit skips", async () => {
  const result = await documentPackage(SURFACE, {
    ask: (prompt) => (prompt.includes("SYMBOL: proseLines") ? PROSE_REPLY : GOOD_REPLY),
    limit: 1,
  });
  assert.equal(result.symbols.length, 1);
  assert.deepEqual(result.skipped, ["proseLines"]);
  assert.match(result.document, /# `@test\/widget` reference/);
  assert.match(result.document, /### `wordCount`/);
});

test("documentPackage records an unformattable symbol as failed instead of aborting the run", async () => {
  // proseLines never yields a parseable reply; wordCount does. The run must
  // still produce wordCount's entry and record proseLines as failed.
  const result = await documentPackage(SURFACE, {
    ask: (prompt) => (prompt.includes("SYMBOL: proseLines") ? "I cannot help with that." : GOOD_REPLY),
    maxRevisions: 1,
  });
  assert.equal(result.symbols.length, 1);
  assert.equal(result.symbols[0]?.symbol.name, "wordCount");
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0]?.name, "proseLines");
  assert.match(result.document, /### `wordCount`/);
});
