/**
 * @emsenn/jsnode-content-computer — LLM-written, gate-checked documentation for
 * jsnode workspace packages.
 *
 * Documentation is cultivated bottom-up: a package's introspected surface (its
 * exported symbols, their signatures, their JSDoc — read by
 * @emsenn/javascript-computer) is the intake; the model is asked for the
 * smallest prose it can give per symbol; our code formats the markdown and the
 * gates verify it, the keystone gate refusing any reference to API the surface
 * does not vouch for. Symbol references compose upward into explanations and a
 * README.
 *
 * The pure pieces (parse, gates, format) live in @emsenn/content-topology's
 * `documentation` module; the I/O edges (reading a surface, running the model
 * cycle) live in ./surface and ./cycle; ./cli binds them to the filesystem, the
 * provider, and stdout.
 */

export { readPackageSurface, surfaceVocabulary } from "./surface.mts";
export type { PackageSurface, SurfaceSymbol, ReadSurfaceOptions } from "./surface.mts";

export { documentSymbol, documentPackage, documentReadme } from "./cycle.mts";
export type {
  SymbolDocResult, DocumentSymbolOptions, Ask,
  PackageReferenceResult, DocumentPackageOptions,
  ReadmeResult, DocumentReadmeOptions,
} from "./cycle.mts";

export { auditPackageDocs } from "./audit.mts";
export type { PackageDocAudit, SymbolCoverage } from "./audit.mts";

// The documentation primitives are re-exported for convenience; their home is
// @emsenn/content-topology/documentation.
export {
  parseDocReply, judgeDoc, docFindings,
  hallucinatedApiFindings, exampleFindings,
  symbolDocPrompt, formatReferenceEntry, formatReference,
} from "@emsenn/content/topology/documentation";
export type {
  DocReply, DocGate, DocVoice, DocSymbolKind,
  DocumentableSymbol, SymbolPromptInput,
} from "@emsenn/content/topology/documentation";
