/**
 * cycle — one witnessed documentation cycle for one symbol.
 *
 * The editorial loop the content farm uses, inverted for code: ask the model
 * for the three small prose fields, judge the result with the doc gates, and
 * revise at most twice when a gate fails. The model's `ask` enters as a value,
 * so the whole cycle runs hermetically in tests with a stub.
 *
 * Our language tools do the detection, never the mutation: prose-lint runs as a
 * gate (errors) and its suggestions are folded into the revision findings so
 * the MODEL tightens its own prose. We deliberately do NOT auto-splice lint
 * `suggest` values — language-editing's weasel rules put authorial directives
 * there ("various" → "list them"), not mechanical replacements, so splicing
 * them corrupts the text. (See dev/planning for the copyedit note.) All
 * structural formatting is still ours; only prose authorship is the model's.
 *
 * The cycle never touches the filesystem: it reads a PackageSurface value and
 * returns a result value. Projecting the entry to disk and recording the run
 * trace is the CLI's job.
 */

import { proseLintSuggestions } from "@emsenn/content/topology/gates";
import {
  judgeDoc,
  docFindings,
  parseDocReply,
  symbolDocPrompt,
  formatReferenceEntry,
  formatReference,
  overviewPrompt,
  parseOverview,
  judgeOverview,
  formatReadme,
  type DocGate,
  type DocReply,
  type DocVoice,
  type SymbolSummary,
} from "@emsenn/content/topology/documentation";

import type { PackageSurface, SurfaceSymbol } from "./surface.mts";
import { surfaceVocabulary, surfaceValueExports } from "./surface.mts";

export type Ask = (prompt: string) => Promise<string> | string;

/** The result of documenting one symbol: the parsed reply, the gate verdict,
 *  the rendered entry, and how many model calls it took. `shipped` records only
 *  the gate verdict — publication is the operator's read, exactly as the farm
 *  keeps `draft: true`. */
export interface SymbolDocResult {
  readonly kind: "content.doc.symbol:witness";
  readonly symbol: SurfaceSymbol;
  readonly reply: DocReply;
  readonly gates: readonly DocGate[];
  readonly shipped: boolean;
  readonly entry: string;
  readonly attempts: number;
}

export interface DocumentSymbolOptions {
  readonly ask: Ask;
  readonly voice?: DocVoice;
  /** Maximum revision rounds after the first draft (default 2 — three calls). */
  readonly maxRevisions?: number;
}

/** Document one exported symbol by name. Throws if the surface has no such
 *  symbol, or if the model never returns a parseable reply across all
 *  attempts (a malformed shape, per the substrate law). */
export async function documentSymbol(
  surface: PackageSurface,
  symbolName: string,
  options: DocumentSymbolOptions,
): Promise<SymbolDocResult> {
  const symbol = surface.symbols.find((s) => s.name === symbolName);
  if (symbol === undefined) throw new TypeError(`package ${surface.name} exports no symbol "${symbolName}"`);

  const vocabulary = surfaceVocabulary(surface);
  const valueExports = surfaceValueExports(surface);
  const siblings = surface.symbols.filter((s) => s.name !== symbolName).map((s) => s.name);
  const maxRevisions = options.maxRevisions ?? 2;

  let previous: string | undefined;
  let findings: readonly string[] | undefined;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRevisions; attempt += 1) {
    const prompt = symbolDocPrompt({
      packageName: surface.name,
      packageDescription: surface.description,
      symbol,
      siblings,
      ...(options.voice === undefined ? {} : { voice: options.voice }),
      ...(previous === undefined ? {} : { previous }),
      ...(findings === undefined ? {} : { findings }),
    });

    const raw = await options.ask(prompt);

    let reply: DocReply;
    try {
      reply = parseDocReply(raw);
    } catch (error) {
      // A shape the parser cannot read is a failed attempt: feed the defect
      // back as a finding and try again rather than crash mid-cycle.
      lastError = error instanceof Error ? error.message : String(error);
      previous = String(raw).slice(0, 1200);
      findings = [`format: ${lastError} — output exactly the SUMMARY:, DETAILS:, EXAMPLE: structure`];
      continue;
    }

    const gates = judgeDoc(symbol, reply, vocabulary, valueExports);
    const shipped = gates.every((gate) => gate.charge === "pass");
    if (shipped || attempt === maxRevisions) {
      return Object.freeze({
        kind: "content.doc.symbol:witness" as const,
        symbol,
        reply,
        gates,
        shipped,
        entry: formatReferenceEntry(symbol, reply),
        attempts: attempt + 1,
      });
    }

    // Detection feeds revision: the failing gates plus prose-lint suggestions
    // (weasel words, wordiness) become findings the MODEL fixes on the next
    // pass — our tools locate the defects, the model rewrites the prose.
    previous = formatReferenceEntry(symbol, reply);
    findings = [...docFindings(gates), ...proseLintSuggestions(`${reply.summary}\n${reply.details}`, 4)];
  }

  // Unreachable: the loop returns on the final attempt. Guards the type only.
  throw new TypeError(`documentation cycle for "${symbolName}" produced no reply${lastError === "" ? "" : ` (${lastError})`}`);
}

// ---------- composition: the whole-package reference ----------

export interface PackageReferenceResult {
  readonly kind: "content.doc.reference:witness";
  readonly packageName: string;
  /** The composed reference document, our formatting around the model's prose. */
  readonly document: string;
  /** Per-symbol results, in the order documented (load-bearing first). */
  readonly symbols: readonly SymbolDocResult[];
  /** Symbols beyond `limit` that were not documented — reported, never silent. */
  readonly skipped: readonly string[];
  /** Symbols whose cycle never produced a usable reply — reported, never
   *  silent; one stubborn symbol must not abort the whole package run. */
  readonly failed: readonly { readonly name: string; readonly reason: string }[];
}

export interface DocumentPackageOptions extends DocumentSymbolOptions {
  /** Document only the top-N most load-bearing symbols (the surface is already
   *  rank-sorted). Omitted means all. Reported skips are never silent. */
  readonly limit?: number;
  /** Notified as each symbol completes, for CLI progress. */
  readonly onSymbol?: (result: SymbolDocResult, index: number, total: number) => void;
}

/** Document a whole package: run the symbol cycle over its surface (most
 *  load-bearing first) and compose the entries into one reference document via
 *  the lib formatter. The intro is the package description — our deterministic
 *  prose, not the model's. */
export async function documentPackage(
  surface: PackageSurface,
  options: DocumentPackageOptions,
): Promise<PackageReferenceResult> {
  const chosen = options.limit === undefined ? surface.symbols : surface.symbols.slice(0, options.limit);
  const skipped = options.limit === undefined ? [] : surface.symbols.slice(options.limit).map((s) => s.name);

  const results: SymbolDocResult[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (let index = 0; index < chosen.length; index += 1) {
    const symbol = chosen[index];
    if (symbol === undefined) continue;
    try {
      const result = await documentSymbol(surface, symbol.name, options);
      results.push(result);
      options.onSymbol?.(result, index, chosen.length);
    } catch (error) {
      // A symbol the model can never format must not abort the package run —
      // record it and move on. The reference composes the symbols that worked.
      failed.push({ name: symbol.name, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const intro = surface.description === "" ? `Reference for the exported surface of \`${surface.name}\`.` : surface.description;
  const document = formatReference(surface.name, intro, results.map((result) => result.entry));

  return Object.freeze({
    kind: "content.doc.reference:witness" as const,
    packageName: surface.name,
    document,
    symbols: Object.freeze(results),
    skipped: Object.freeze(skipped),
    failed: Object.freeze(failed),
  });
}

// ---------- composition: the LLM-written README ----------

export interface ReadmeResult {
  readonly kind: "content.doc.readme:witness";
  readonly packageName: string;
  /** The composed README — our structure around the model's overview. */
  readonly readme: string;
  /** The reference run the README was composed from. */
  readonly reference: PackageReferenceResult;
  readonly overview: string;
  readonly overviewGates: readonly DocGate[];
  readonly overviewShipped: boolean;
}

export interface DocumentReadmeOptions extends DocumentPackageOptions {
  /** A usage block (e.g. the CLI invocation) inserted before the API section. */
  readonly usage?: string;
  /** Relative link to the full reference doc, when one is written alongside. */
  readonly referencePath?: string;
}

/** Compose a README for a package: document its surface, distil each symbol to
 *  its summary, ask the model for a package overview over those SUMMARIES (never
 *  the source — context spacesuiting at the top rung), gate and revise it, then
 *  let our code assemble the README around it. The headline of the plan: an
 *  LLM-written README, not a manifest skeleton. */
export async function documentReadme(
  surface: PackageSurface,
  options: DocumentReadmeOptions,
): Promise<ReadmeResult> {
  const reference = await documentPackage(surface, options);
  const summaries: readonly SymbolSummary[] = reference.symbols.map((result) => ({
    name: result.symbol.name,
    summary: result.reply.summary,
  }));

  const vocabulary = surfaceVocabulary(surface);
  const maxRevisions = options.maxRevisions ?? 2;
  let previous: string | undefined;
  let findings: readonly string[] | undefined;
  let overview = "";
  let overviewGates: readonly DocGate[] = [];

  for (let attempt = 0; attempt <= maxRevisions; attempt += 1) {
    const prompt = overviewPrompt({
      packageName: surface.name,
      packageDescription: surface.description,
      summaries,
      ...(options.voice === undefined ? {} : { voice: options.voice }),
      ...(previous === undefined ? {} : { previous }),
      ...(findings === undefined ? {} : { findings }),
    });
    try {
      overview = parseOverview(await options.ask(prompt));
    } catch {
      overview = surface.description; // fall back to the manifest prose, never crash
    }
    overviewGates = judgeOverview(overview, vocabulary);
    if (overviewGates.every((gate) => gate.charge === "pass") || attempt === maxRevisions) break;
    previous = overview;
    findings = [...docFindings(overviewGates), ...proseLintSuggestions(overview, 3)];
  }

  const readme = formatReadme({
    packageName: surface.name,
    overview,
    symbols: summaries,
    ...(options.usage === undefined ? {} : { usage: options.usage }),
    ...(options.referencePath === undefined ? {} : { referencePath: options.referencePath }),
  });

  return Object.freeze({
    kind: "content.doc.readme:witness" as const,
    packageName: surface.name,
    readme,
    reference,
    overview,
    overviewGates,
    overviewShipped: overviewGates.every((gate) => gate.charge === "pass"),
  });
}
