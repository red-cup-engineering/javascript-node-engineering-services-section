import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { auditPackageDocs } from "./audit.mts";
import type { PackageSurface } from "./surface.mts";

function surfaceIn(dir: string): PackageSurface {
  return Object.freeze({
    name: "@test/widget",
    description: "A widget.",
    dir,
    symbols: Object.freeze([
      Object.freeze({ name: "wordCount", kind: "function" as const, signature: "export function wordCount(b: string): number", doc: "", file: "a.mts", rank: 3 }),
      Object.freeze({ name: "proseLines", kind: "function" as const, signature: "export function proseLines(b: string): string", doc: "", file: "a.mts", rank: 1 }),
    ]),
  });
}

test("auditPackageDocs counts a symbol documented when its reference file exists", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jcc-audit-"));
  try {
    const refDir = path.join(dir, "dev", "docs", "reference");
    mkdirSync(refDir, { recursive: true });
    writeFileSync(path.join(refDir, "wordCount.md"), "# stub\n", "utf8");

    const audit = auditPackageDocs(surfaceIn(dir));
    assert.equal(audit.total, 2);
    assert.equal(audit.documented, 1);
    assert.equal(audit.symbols.find((s) => s.name === "wordCount")?.documented, true);
    assert.equal(audit.symbols.find((s) => s.name === "proseLines")?.documented, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("auditPackageDocs counts symbols from the COMPOSED reference.md, not just per-symbol files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jcc-audit-"));
  try {
    const docsDir = path.join(dir, "dev", "docs");
    mkdirSync(docsDir, { recursive: true });
    // What `reference --write` / `readme --write` actually emit: one composed file.
    writeFileSync(path.join(docsDir, "reference.md"), "# ref\n\n### `wordCount`\n\nstub.\n\n### `proseLines`\n\nstub.\n", "utf8");

    const audit = auditPackageDocs(surfaceIn(dir));
    assert.equal(audit.documented, 2, "both symbols in the composed reference count as documented");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("auditPackageDocs reports zero documented when no reference dir exists", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jcc-audit-"));
  try {
    const audit = auditPackageDocs(surfaceIn(dir));
    assert.equal(audit.documented, 0);
    assert.equal(audit.total, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
