import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readPackageSurface, surfaceVocabulary, surfaceValueExports } from "./surface.mts";

function fixturePackage(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "jcc-surface-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@test/widget", description: "A widget." }), "utf8");
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(
    path.join(dir, "src", "index.mts"),
    [
      "/** Counts words. */",
      "export function wordCount(body: string): number { return body.length; }",
      "export interface Tally { readonly total: number; }",
      "export const SCALE = 2;",
    ].join("\n"),
    "utf8",
  );
  return dir;
}

test("readPackageSurface reads the manifest and the exported symbols off src", () => {
  const dir = fixturePackage();
  try {
    const surface = readPackageSurface(dir);
    assert.equal(surface.name, "@test/widget");
    assert.equal(surface.description, "A widget.");
    assert.deepEqual(new Set(surface.symbols.map((s) => s.name)), new Set(["wordCount", "Tally", "SCALE"]));
    assert.equal(surface.symbols.find((s) => s.name === "wordCount")?.doc, "Counts words.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("surfaceValueExports excludes interfaces and types — only runtime bindings shadow", () => {
  const dir = fixturePackage();
  try {
    const surface = readPackageSurface(dir);
    const values = surfaceValueExports(surface);
    assert.ok(values.has("wordCount"));
    assert.ok(values.has("SCALE"));
    assert.ok(!values.has("Tally"), "an interface is erased at runtime; reusing its name is safe");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("surfaceVocabulary admits the export names and the types their signatures name", () => {
  const dir = fixturePackage();
  try {
    const vocab = surfaceVocabulary(readPackageSurface(dir));
    assert.ok(vocab.has("wordCount"));
    assert.ok(vocab.has("number"), "the return type named in the signature is admitted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
