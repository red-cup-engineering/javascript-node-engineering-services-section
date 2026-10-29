/**
 * type-index — the whole workspace's API surface, attributed to packages.
 *
 * Every package's built `dist` declarations are projected in a single
 * TypeScript program (so the standard library loads once), then each
 * declaration is attributed back to the package whose `dist` it came from. The
 * result is the ecosystem's types and functions as one flat, queryable index:
 * the substrate for "is there already a type like this?" and "what functions
 * take this type as a domain?" read across all packages at once.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import {
  discoverJavaScriptSourceFiles,
  introspectDeclarationsByFile,
} from "@red-cup-engineering/javascript-computer";
import { eachWorkspacePackageDir, type WorkspaceFilter } from "@red-cup-engineering/jsnode-workspace-analysis-services-section/workspace";

export interface AttributedType {
  readonly pkg: string;
  readonly name: string;
  readonly kind: string;
}

export interface AttributedFunction {
  readonly pkg: string;
  readonly name: string;
  readonly domain: readonly string[];
  readonly codomain?: string;
}

/** A declared subtype relation, attributed to the package that declares the
 *  subtype: `sub` extends/implements `base`. `base` may name a type outside the
 *  package (or outside the workspace) — callers that want internal-only edges
 *  filter against the package's own type names. */
export interface AttributedSubtype {
  readonly pkg: string;
  readonly sub: string;
  readonly base: string;
}

export interface WorkspaceTypeIndex {
  readonly types: readonly AttributedType[];
  readonly functions: readonly AttributedFunction[];
  readonly subtypes: readonly AttributedSubtype[];
}

const isDeclarationFile = (file: string): boolean =>
  file.endsWith(".d.ts") || file.endsWith(".d.mts") || file.endsWith(".d.cts");

// Project every built package's dist into one attributed index. Packages with
// no `dist` (never built) contribute nothing — build them to make them legible.
export function workspaceTypeIndex(
  root: string,
  filter: WorkspaceFilter = {},
): WorkspaceTypeIndex {
  const fileToPkg = new Map<string, string>();
  const files: string[] = [];
  for (const { name, dir } of eachWorkspacePackageDir(root, filter)) {
    const distDir = path.join(dir, "dist");
    if (!existsSync(distDir)) continue;
    for (const f of discoverJavaScriptSourceFiles(distDir, { includeDeclarations: true })
      .filter(isDeclarationFile)) {
      files.push(f);
      fileToPkg.set(path.resolve(f), name);
    }
  }

  const types: AttributedType[] = [];
  const functions: AttributedFunction[] = [];
  const subtypes: AttributedSubtype[] = [];
  for (const { file, catalog } of introspectDeclarationsByFile(files)) {
    const pkg = fileToPkg.get(path.resolve(file)) ?? "?";
    for (const t of catalog.types) types.push({ pkg, name: t.name, kind: t.kind });
    for (const f of catalog.functions) {
      functions.push(
        f.codomain === undefined
          ? { pkg, name: f.name, domain: f.domain }
          : { pkg, name: f.name, domain: f.domain, codomain: f.codomain },
      );
    }
    // Subtype edges arrive as [sub, base] tuples; attribute each to the package
    // whose declaration file it came from.
    for (const [sub, base] of catalog.subtypes) subtypes.push({ pkg, sub, base });
  }
  return { types, functions, subtypes };
}
