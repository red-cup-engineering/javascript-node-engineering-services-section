import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";


import {
  appendSearchJournalRow,
  deriveJsnodeResultCount,
  searchJournalPath,
  journalOperation,
} from "./journal.mjs";

function readRows(packageRoot: string, server: string, at: Date): unknown[] {
  const path = searchJournalPath(packageRoot, server, at);
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

test("a zero-result tools/call writes one row with results: 0", async () => {
  const packageRoot = mkdtempSync(join(tmpdir(), "jsnode-journal-"));
  try {
    // journalOperation takes no clock override; it always
    // journals under the real current UTC date, so the row is read back
    // under that same real date rather than a fixed literal that goes stale.
    const at = new Date();
    const dispatch = async () => ({ term: "nope", count: 0, matches: [] });
    const wrapped = journalOperation("jsnode_search", dispatch, { packageRoot, server: "jsnode-server" });
    await wrapped({ query: "no-such-package-anywhere" });
    const rows = readRows(packageRoot, "jsnode-server", at) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.tool, "jsnode_search");
    assert.equal(rows[0]?.results, 0);
    assert.equal(rows[0]?.truncated, false);
    assert.equal(rows[0]?.error, null);
    assert.deepEqual(rows[0]?.query, { query: "no-such-package-anywhere" });
  } finally {
    rmSync(packageRoot, { recursive: true, force: true });
  }
});

test("an erroring tools/call writes a row carrying the error message and rethrows", async () => {
  const packageRoot = mkdtempSync(join(tmpdir(), "jsnode-journal-"));
  try {
    // Same real-clock note as above.
    const at = new Date();
    const dispatch = async () => { throw new Error("type not addressable in the flow: Nope"); };
    const wrapped = journalOperation("jsnode_typeflow_type", dispatch, { packageRoot, server: "jsnode-server" });
    await assert.rejects(async () => { await wrapped({ type: "Nope" }); }, /type not addressable/);
    const rows = readRows(packageRoot, "jsnode-server", at) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.results, 0);
    assert.equal(rows[0]?.error, "type not addressable in the flow: Nope");
  } finally {
    rmSync(packageRoot, { recursive: true, force: true });
  }
});

test("appendSearchJournalRow lands under data/logs/YYYY/MM/DD/<server>-search-journal.jsonl", () => {
  const packageRoot = mkdtempSync(join(tmpdir(), "jsnode-journal-"));
  try {
    const at = new Date("2026-09-03T00:00:00.000Z");
    const path = appendSearchJournalRow({
      packageRoot, server: "jsnode-server", tool: "jsnode_query",
      query: { tag: "eavt" }, results: 4, truncated: false, durationMs: 2, at,
    });
    assert.equal(path, join(packageRoot, "data", "logs", "2026", "09", "03", "jsnode-server-search-journal.jsonl"));
    const rows = readRows(packageRoot, "jsnode-server", at) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.results, 4);
  } finally {
    rmSync(packageRoot, { recursive: true, force: true });
  }
});

test("deriveJsnodeResultCount reads jsnode_query's count and flags truncation", () => {
  assert.deepEqual(
    deriveJsnodeResultCount("jsnode_query", { count: 10, packages: [{ name: "a" }] }),
    { results: 10, truncated: true },
  );
  assert.deepEqual(
    deriveJsnodeResultCount("jsnode_search", { term: "x", count: 0, matches: [] }),
    { results: 0, truncated: false },
  );
  assert.deepEqual(
    deriveJsnodeResultCount("jsnode_duplication", { candidateCount: 3, candidates: [1, 2, 3] }),
    { results: 3, truncated: false },
  );
  assert.deepEqual(deriveJsnodeResultCount("jsnode_status", { status: "ok" }), { results: 1, truncated: false });
});
