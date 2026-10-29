/**
 * audit — deterministic documentation-coverage reading for a package.
 *
 * No model, no network: it compares the package's exported surface against the
 * reference docs already on disk and reports which load-bearing symbols are
 * documented and which are not — the cheap "what still needs writing?" view
 * that orders the cultivation work.
 *
 * It recognizes BOTH layouts the writers produce, so the natural workflow
 * (`reference --write` then `audit`) stays coherent: the per-symbol files
 * `dev/docs/reference/<name>.md` from `document --symbol --write`, AND the
 * `### `name`` entries inside the composed `dev/docs/reference.md` from
 * `reference --write` / `readme --write`.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { PackageSurface, SurfaceSymbol } from "./surface.mts";

export interface SymbolCoverage {
  readonly name: string;
  readonly kind: SurfaceSymbol["kind"];
  readonly rank: number;
  readonly documented: boolean;
}

export interface PackageDocAudit {
  readonly kind: "content.doc.audit";
  readonly packageName: string;
  readonly total: number;
  readonly documented: number;
  /** Per-symbol coverage, most load-bearing first (the surface's order). */
  readonly symbols: readonly SymbolCoverage[];
}

/** The set of symbol names a package's reference docs already cover, reading
 *  both the per-symbol files and the composed reference document. */
export function documentedNames(dir: string): ReadonlySet<string> {
  const present = new Set<string>();
  const refDir = path.join(dir, "dev", "docs", "reference");
  if (existsSync(refDir)) {
    for (const file of readdirSync(refDir)) {
      if (file.endsWith(".md")) present.add(file.slice(0, -3));
    }
  }
  const composed = path.join(dir, "dev", "docs", "reference.md");
  if (existsSync(composed)) {
    // Each entry is `### \`name\`` — exactly what formatReferenceEntry emits.
    for (const match of readFileSync(composed, "utf8").matchAll(/^###\s+`([^`]+)`/gm)) {
      if (match[1] !== undefined) present.add(match[1]);
    }
  }
  return present;
}

/** Audit a read surface against the reference docs on disk. A symbol counts as
 *  documented when it has a per-symbol file OR an entry in the composed
 *  reference. */
export function auditPackageDocs(surface: PackageSurface): PackageDocAudit {
  const present = documentedNames(surface.dir);

  const symbols = surface.symbols.map((sym): SymbolCoverage => ({
    name: sym.name,
    kind: sym.kind,
    rank: sym.rank,
    documented: present.has(sym.name),
  }));

  return Object.freeze({
    kind: "content.doc.audit" as const,
    packageName: surface.name,
    total: symbols.length,
    documented: symbols.filter((s) => s.documented).length,
    symbols: Object.freeze(symbols),
  });
}
