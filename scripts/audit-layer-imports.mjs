#!/usr/bin/env node
// Audits the house's DAG: every import edge whose target layer is not named in the source layer's
// `imports` list (and is not the source layer itself), or that inside the relationality layer runs
// to a higher faculty or to a different faculty of equal rank, is a finding. The layers are a data
// record (data/records/house-layers.json), and package names resolve from manifests on disk,
// and the report is JSON so the norm is queryable rather than asserted.
//
// `--ref <git ref>` audits a read-only export of lib/emsenn/services/561-group at that ref (git
// archive piped into tar, no worktree, no checkout) instead of the working tree, resolving `layers`
// and discovered package directories under the export's temp root instead of `root` — so a caller
// (the gate) can compare the working tree's findings against the ref's without a hand-refreshed
// baseline directory. `refCache`, a Map keyed by ref, lets several calls at the same ref within one
// process (the gate audits both layers and phantoms at the same ref) share one export rather than
// each re-archiving the tree; without one, this call exports and tears down its own.
//
//   node audit-layer-imports.mjs [--root /home/emsenn/info] [--layers <house-layers.json>] [--ref <git ref>] [--summary]
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { exportHouseTreeAtRef } from "./export-house-tree-at-ref.mjs";
import { argument } from "../src/argv.mjs";
import { discoverHousePackages } from "../src/discover-house-packages.mjs";

const SKIP = new Set(["node_modules", ".git", "dist", "legacy", ".tmp", ".cache", "coverage"]);
const SOURCE = /\.(mjs|cjs|js|mts|cts|ts)$/u;
// The `from` and bare-import alternatives anchor on start-of-line, newline, or a preceding
// semicolon, so a second statement minified onto the same line after `;` is still seen. The last
// two alternatives need no line anchor: a dynamic `import(...)` or `import.meta.resolve(...)` is an
// expression that can appear anywhere, including a bootstrap hiding behind `import.meta.resolve`.
// The `d` (hasIndices) flag costs matching nothing extra — a caller that only reads `match[n]` for
// the specifier text never notices it — but it gives a caller that needs the specifier's own
// character offsets (not the whole matched statement's) `match.indices[n]`, quote characters
// excluded, without a second, parser-based implementation of "where is the specifier" existing
// alongside this one.
export const SPECIFIER = /(?:^|\n|;)[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|(?:^|\n|;)[ \t]*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\bimport\.meta\.resolve\(\s*["']([^"']+)["']\s*\)/gdu;
const HOUSE_SCOPE = /^@(red-cup-engineering|lenticule-science|561-group|emsenn|causeway-services|coesite-operations)\//u;

// Comments are not code: a JSDoc type reference (`@param {import("./x.mjs").Thing}`), an import
// statement written out as documentation inside a comment, or a template literal holding an import
// example are text a writer can shape however they like without it ever running -- SPECIFIER's
// unanchored `import(...)` and `import.meta.resolve(...)` alternatives don't know that, and read
// them as real edges. stripCommentsAndLiterals masks that non-code text to spaces before any
// scanner built over SPECIFIER runs, so a comment can no longer dodge or fake a finding.
const REGEX_PRECEDING_KEYWORDS = Object.freeze(new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw",
  "case", "do", "else", "yield", "await", "extends", "default", "let", "const", "var",
  "if", "while", "for", "switch", "with", "class", "function", "async",
]));
const IDENTIFIER_CHARACTER = /[A-Za-z0-9_$]/u;

/**
 * Tokenizes `text` from `start`, pushing every comment/string/template/regex span found (each
 * `{ type, start, end }`) into `spans`, and returns the index scanning stopped at. Ordinary code
 * characters are walked to track context (division versus a regex literal) but never recorded --
 * only the non-code spans matter, since those are what get masked. `stopAtBrace`, when true, stops
 * (without consuming) at the first "}" this call sees at its own brace-depth 0: how a template
 * literal's `${ ... }` interpolation is scanned, since that interpolation is itself ordinary code
 * that can nest braces, strings, comments, even further template literals, before its own close.
 */
function tokenizeInto(text, start, stopAtBrace, spans) {
  let i = start;
  let lastToken = null; // "id" | "keyword" | "value" | "punct:<char>" | null (start of region)
  let braceDepth = 0;

  while (i < text.length) {
    const ch = text[i];

    if (stopAtBrace && ch === "}" && braceDepth === 0) return i;

    if (ch === "/" && text[i + 1] === "/") {
      const spanStart = i;
      let j = i + 2;
      while (j < text.length && text[j] !== "\n") j++;
      spans.push({ type: "line-comment", start: spanStart, end: j });
      i = j;
      continue;
    }

    if (ch === "/" && text[i + 1] === "*") {
      const spanStart = i;
      let j = i + 2;
      while (j < text.length && !(text[j] === "*" && text[j + 1] === "/")) j++;
      j = Math.min(j + 2, text.length);
      spans.push({ type: "block-comment", start: spanStart, end: j });
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const spanStart = i;
      let j = i + 1;
      while (j < text.length && text[j] !== quote) {
        if (text[j] === "\\") j += 2;
        else j += 1;
      }
      j = Math.min(j + 1, text.length);
      spans.push({ type: "string", start: spanStart, end: j });
      i = j;
      lastToken = "value";
      continue;
    }

    if (ch === "`") {
      const spanStart = i;
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "`") { j += 1; break; }
        if (text[j] === "$" && text[j + 1] === "{") {
          const stop = tokenizeInto(text, j + 2, true, spans);
          j = Math.min(stop + 1, text.length); // consume the interpolation's closing "}"
          continue;
        }
        j += 1;
      }
      spans.push({ type: "template", start: spanStart, end: j });
      i = j;
      lastToken = "value";
      continue;
    }

    if (ch === "/") {
      const regexAllowed = lastToken === null || lastToken === "keyword"
        || (lastToken.startsWith("punct:") && lastToken !== "punct:)" && lastToken !== "punct:]");
      if (regexAllowed) {
        const spanStart = i;
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < text.length && text[j] !== "\n") {
          if (text[j] === "\\") { j += 2; continue; }
          if (text[j] === "[") { inClass = true; j += 1; continue; }
          if (text[j] === "]") { inClass = false; j += 1; continue; }
          if (text[j] === "/" && !inClass) { j += 1; closed = true; break; }
          j += 1;
        }
        if (closed) {
          while (j < text.length && /[a-z]/iu.test(text[j])) j += 1;
          spans.push({ type: "regex", start: spanStart, end: j });
          i = j;
          lastToken = "value";
          continue;
        }
        // Not actually closed before end of line: not a regex after all -- fall through as division.
      }
      lastToken = "punct:/";
      i += 1;
      continue;
    }

    if (IDENTIFIER_CHARACTER.test(ch) && !/[0-9]/u.test(ch)) {
      let j = i + 1;
      while (j < text.length && IDENTIFIER_CHARACTER.test(text[j])) j += 1;
      lastToken = REGEX_PRECEDING_KEYWORDS.has(text.slice(i, j)) ? "keyword" : "id";
      i = j;
      continue;
    }

    if (/[0-9]/u.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[0-9a-fA-FxXoObB._eE+-]/u.test(text[j])) j += 1;
      lastToken = "value";
      i = j;
      continue;
    }

    if (/\s/u.test(ch)) { i += 1; continue; } // whitespace never changes lastToken

    if (ch === "{") { braceDepth += 1; lastToken = "punct:{"; i += 1; continue; }
    if (ch === "}") { if (braceDepth > 0) braceDepth -= 1; lastToken = "punct:}"; i += 1; continue; }

    lastToken = `punct:${ch}`;
    i += 1;
  }
  return i;
}

function maskSpan(chars, start, end) {
  for (let i = start; i < end; i++) if (chars[i] !== "\n") chars[i] = " ";
}

/**
 * Masks every comment (line and block), regex literal, and non-import string or template literal
 * in `text` to spaces -- preserving newlines and every other character's position, so a caller
 * that reports offsets against the result (SPECIFIER's `match.indices`) reports the same offsets
 * it would against `text` itself. A real import/export-from/dynamic-import/import.meta.resolve
 * specifier's own quoted text is left untouched: comments and strings are not code, but a real
 * specifier is. Exported beside SPECIFIER because every scanner built over it needs this first.
 */
export function stripCommentsAndLiterals(text) {
  const spans = [];
  tokenizeInto(text, 0, false, spans);

  // Mask comments and regex literals first, unconditionally: a JSDoc `{import("./x.mjs")}` type
  // reference or a regex literal that happens to hold import-shaped text (this file's own
  // SPECIFIER, audited like any other source) is documentation or pattern text, never an authored
  // import, in every one of this house's plain sources.
  const withoutCommentsOrRegex = text.split("");
  for (const span of spans) {
    if (span.type === "line-comment" || span.type === "block-comment" || span.type === "regex") {
      maskSpan(withoutCommentsOrRegex, span.start, span.end);
    }
  }
  const codeAndLiterals = withoutCommentsOrRegex.join("");

  // A real specifier is only ever a plain '"'/"'"-quoted string (SPECIFIER never captures a
  // backtick): find those real specifiers now, over text with comments and regexes already gone,
  // so a comment or regex literal holding import-shaped text was never a candidate to begin with.
  const protectedRanges = new Set();
  for (const match of codeAndLiterals.matchAll(SPECIFIER)) {
    for (let group = 1; group <= 4; group++) {
      if (match[group] === undefined) continue;
      const [start, end] = match.indices[group];
      protectedRanges.add(`${start}:${end}`);
    }
  }

  // Mask every string and template literal except a string that is exactly a protected
  // specifier's quoted content. A template literal is never protected: it can hold a
  // documentation example that merely looks like an import, and SPECIFIER cannot capture a real
  // specifier from inside backticks in the first place.
  const finalChars = codeAndLiterals.split("");
  for (const span of spans) {
    if (span.type === "template") { maskSpan(finalChars, span.start, span.end); continue; }
    if (span.type !== "string") continue;
    if (protectedRanges.has(`${span.start + 1}:${span.end - 1}`)) continue;
    maskSpan(finalChars, span.start, span.end);
  }
  return finalChars.join("");
}

function* walk(directory) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile() && SOURCE.test(entry.name) && !/\.d\.(mts|cts|ts)$/u.test(entry.name)) yield path;
  }
}

/** The layer record for a repository-relative path: the deepest matching directory wins, with its faculty when the layer has faculties. */
export function layerOf(relativePath, layers) {
  let best;
  for (const layer of layers.layers) {
    for (const directory of layer.directories) {
      const prefix = `${layers.root}/${directory}/`;
      if (!relativePath.startsWith(prefix)) continue;
      if (best === undefined || prefix.length > best.prefix.length) best = { layer, prefix };
    }
  }
  if (best === undefined) return undefined;
  const result = { name: best.layer.name };
  if (best.layer.faculties) {
    const tail = relativePath.slice(best.prefix.length);
    const match = /^lib\/([a-z]+)\//u.exec(tail);
    if (match && match[1] in best.layer.faculties) { result.faculty = match[1]; result.facultyRank = best.layer.faculties[match[1]]; }
  }
  return result;
}

/**
 * True when an import from `source` to `target` breaks the house DAG (data/records/house-layers.json):
 * the target layer is not in the source layer's `imports` list and is not the source layer itself, or
 * both layers are relationality and the target faculty outranks the source faculty, or both layers are
 * relationality with different faculties of equal rank (equal rank is allowed only within one faculty).
 */
export function isForbidden(source, target, layers) {
  if (source === undefined || target === undefined) return false;
  const bothRelationality = source.name === "relationality" && target.name === "relationality";
  if (bothRelationality && source.facultyRank !== undefined && target.facultyRank !== undefined) {
    if (target.facultyRank > source.facultyRank) return true;
    if (target.facultyRank === source.facultyRank && target.faculty !== source.faculty) return true;
  }
  if (target.name === source.name) return false;
  const layer = layers.layers.find((candidate) => candidate.name === source.name);
  const allowed = layer?.imports ?? [];
  return !allowed.includes(target.name);
}

/** Resolves a specifier to a repository-relative directory or file: relative paths against the importer, house names through the map. */
export function resolveSpecifier(specifier, importerRelativePath, map) {
  if (specifier.startsWith(".")) return join(dirname(importerRelativePath), specifier).split("\\").join("/");
  if (!HOUSE_SCOPE.test(specifier)) return undefined;
  const parts = specifier.split("/");
  const name = parts.slice(0, 2).join("/");
  const directory = map.packages[name];
  if (directory === undefined) return undefined;
  return `${directory}/${parts.slice(2).join("/")}`.replace(/\/$/u, "");
}

/**
 * Audits every source file under the layered root; returns the findings and a census by layer pair.
 * With `ref`, audits a read-only export of that ref instead of the working tree (see
 * exportHouseTreeAtRef); `refCache`, when given, is shared with sibling calls at the same ref (the
 * caller owns tearing it down), and without one this call exports and cleans up its own. A ref or
 * directory absent at that ref reports no findings at all, the same shape as an empty tree.
 */
export function auditLayerImports({ root, layers, map, ref, refCache }) {
  let effectiveRoot = root;
  let cleanup;
  if (ref) {
    const ownCache = refCache ?? new Map();
    effectiveRoot = exportHouseTreeAtRef(root, ref, { cache: ownCache });
    if (effectiveRoot === undefined) return { findings: [], census: {} };
    if (!refCache) cleanup = () => { for (const dir of ownCache.values()) if (dir) rmSync(dir, { recursive: true, force: true }); };
  }
  try {
    return auditLayerImportsTree({ root: effectiveRoot, layers, map });
  } finally {
    if (cleanup) cleanup();
  }
}

function auditLayerImportsTree({ root, layers, map }) {
  const findings = [];
  const census = {};
  const base = resolve(root, layers.root);
  for (const file of walk(base)) {
    const importerRelative = relative(root, file).split("\\").join("/");
    if (layerOf(importerRelative, layers) === undefined) continue;
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const finding of layerFindingsOfSource(importerRelative, text, layers, map)) {
      const key = layerEdgeOf(finding);
      census[key] = (census[key] ?? 0) + 1;
      findings.push(finding);
    }
  }
  return { findings, census };
}

/** True when a repository-relative path is a source file the audit reads: under no skipped directory, not a declaration file. */
export function isAuditedSource(relativePath) {
  const segments = relativePath.split("/");
  return SOURCE.test(relativePath) && !/\.d\.(mts|cts|ts)$/u.test(relativePath) && !segments.slice(0, -1).some((segment) => SKIP.has(segment));
}

/** A finding's layer edge as the census counts it: `from -> to`, each with its faculty when it has one. */
export const layerEdgeOf = (finding) => `${finding.from.name}${finding.from.faculty ? `:${finding.from.faculty}` : ""} -> ${finding.to.name}${finding.to.faculty ? `:${finding.to.faculty}` : ""}`;

/** The findings one source text holds, read at its repository-relative path against a layer record and package map. */
export function layerFindingsOfSource(importerRelative, text, layers, map) {
  const source = layerOf(importerRelative, layers);
  if (source === undefined) return [];
  const findings = [];
  for (const match of stripCommentsAndLiterals(text).matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    const targetPath = resolveSpecifier(specifier, importerRelative, map);
    if (targetPath === undefined) continue;
    const target = layerOf(`${targetPath}/`.replace(/\/+$/u, "/"), layers) ?? layerOf(targetPath, layers);
    if (isForbidden(source, target, layers)) findings.push({ importer: importerRelative, specifier, from: source, to: target });
  }
  return findings;
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const root = resolve(argument("--root", args) || process.cwd());
  const here = dirname(new URL(import.meta.url).pathname);
  const layers = JSON.parse(readFileSync(argument("--layers", args) || join(here, "../data/records/house-layers.json"), "utf8"));
  const map = discoverHousePackages(root);
  const report = auditLayerImports({ root, layers, map, ref: argument("--ref", args) });
  process.stdout.write(`${JSON.stringify(args.includes("--summary") ? { findings: report.findings.length, census: report.census } : report, null, 2)}\n`);
}
