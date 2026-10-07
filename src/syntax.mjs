import { readJavascriptFileExportDocumentation } from "@red-cup-engineering/read-javascript-file-export-documentation-service";
import { posix as path } from "node:path";
import { lineColumnOf, parseJavaScript, walkJavaScript } from "./javascript-parser.mjs";
import { applyExactSourceEdits } from "@red-cup-engineering/computer-code-engineering-services-section/exact-source-edits";
import { sha256Digest, sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";

const OPERATION_SOURCE_PATH = /^(?:src|scripts)\/[a-z][a-z0-9-]*\.mjs$/u;

function exportedFunctionStatement(statement) {
  return (statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration") && statement.declaration?.type === "FunctionDeclaration" && statement.declaration.id !== null;
}

function exportedName(node) {
  return node.type === "Identifier" ? node.name : node.value;
}

function importRecord(statement, text) {
  const record = { source: statement.source.value, names: [], text: text.slice(statement.start, statement.end), bindings: [], attributes: null };
  if (statement.attributes?.length) {
    const first = statement.attributes[0];
    const last = statement.attributes[statement.attributes.length - 1];
    const open = text.lastIndexOf("with", first.start) >= statement.source.end ? text.lastIndexOf("with", first.start) : text.lastIndexOf("assert", first.start);
    record.attributes = text.slice(open, text.indexOf("}", last.end) + 1);
  }
  for (const specifier of statement.specifiers) {
    if (specifier.type === "ImportDefaultSpecifier") record.default = specifier.local.name;
    else if (specifier.type === "ImportNamespaceSpecifier") record.namespace = specifier.local.name;
    else {
      record.names.push(specifier.local.name);
      record.bindings.push({ imported: exportedName(specifier.imported), local: specifier.local.name });
    }
  }
  return record;
}

function mainGuard(statements, text) {
  return statements.find((statement) => statement.type === "IfStatement" && text.slice(statement.test.start, statement.test.end).trim() === "import.meta.main");
}

function containsIdentifier(node, pattern) {
  let found = false;
  walkJavaScript(node, (child) => {
    if (found) return false;
    if (child.type === "Identifier" && pattern.test(child.name)) found = true;
    return !found;
  });
  return found;
}

function declaredNames(statement) {
  const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  if (!declaration) return [];
  if ((declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") && declaration.id) return [declaration.id.name];
  if (declaration.type === "VariableDeclaration") return declaration.declarations.filter((item) => item.id.type === "Identifier").map((item) => item.id.name);
  return [];
}

/**
 * Reads one JavaScript module's exported operation shape. Schemas are never
 * guessed from JSDoc: callers may carry an explicit schema in the request,
 * otherwise each schema is null.
 */
export function readJsnodeOperationArguments(request) {
  if (typeof request?.text !== "string") throw new TypeError("text must be a string");
  if (typeof request?.path !== "string" || !OPERATION_SOURCE_PATH.test(request.path)) throw new TypeError("path must match ^(?:src|scripts)/[a-z][a-z0-9-]*\\.mjs$");
  const { text, path: sourcePath } = request;
  const program = parseJavaScript(text);
  const statements = program.body;
  const functions = statements.filter(exportedFunctionStatement);
  const exported = functions.length === 1 ? functions[0] : null;
  const exportName = exported?.declaration.id.name ?? null;
  const documentation = exported ? readJavascriptFileExportDocumentation({ type: "TextFileRead", path: sourcePath, text }).find((entry) => entry.name === exportName) : null;
  const guard = mainGuard(statements, text);
  const slice = (node) => text.slice(node.start, node.end);
  const residueStatements = statements.filter((statement) => statement !== exported && statement !== guard && statement.type !== "ImportDeclaration");
  const residue = residueStatements.flatMap((statement) => {
    const names = declaredNames(statement);
    return names.length ? names : [slice(statement)];
  });
  return {
    type: "JsnodeOperationArguments", version: 1, path: sourcePath, exportName, exportCount: functions.length,
    isAsync: exported ? exported.declaration.async : false,
    description: documentation?.description?.length ? documentation.description : null,
    params: documentation?.parameters.map((parameter) => ({ name: parameter.name, type: parameter.type, description: parameter.description })) ?? [],
    returns: documentation?.returns ? { type: documentation.returns.type, description: documentation.returns.description } : null,
    inputSchema: Object.hasOwn(request, "inputSchema") ? request.inputSchema : null,
    outputSchema: Object.hasOwn(request, "outputSchema") ? request.outputSchema : null,
    throws: documentation?.throws.map((entry) => ({ type: entry.type, description: entry.description })) ?? [],
    imports: statements.filter((statement) => statement.type === "ImportDeclaration").map((statement) => importRecord(statement, text)),
    hasMainGuard: guard !== undefined, readsStdin: guard ? containsIdentifier(guard, /stdin/iu) : false, writesStdout: guard ? containsIdentifier(guard, /stdout/iu) : false,
    bodyText: exported ? jsdocInclusiveSlice(program, exported, text) : null,
    shebang: text.startsWith("#!"), residue, residueStatements: residueStatements.map(slice),
    mainGuardText: guard ? slice(guard) : null, shebangText: text.startsWith("#!") ? text.split(/\r?\n/u, 1)[0] : null,
  };
}

/** A statement's text from its attached JSDoc (when present) to its end. */
function jsdocInclusiveSlice(program, node, text) {
  const before = program.comments.filter((comment) => comment.end <= node.start && comment.type === "Block" && comment.value.startsWith("*") && /^\s*$/u.test(text.slice(comment.end, node.start)));
  const start = before.length ? before[before.length - 1].start : node.start;
  return text.slice(start, node.end);
}

function languageOf(fileName) {
  if (/\.json$/iu.test(fileName)) return "json";
  return "js";
}

function requireFileName(fileName) {
  if (typeof fileName !== "string" || fileName === "") throw new TypeError("file name must be a non-empty string");
}

function withFileName(error, fileName) {
  if (!(error instanceof SyntaxError) || error.line === undefined) return error;
  const located = new SyntaxError(`${fileName}:${error.line}:${error.column}: ${error.message.replace(/ \(\d+:\d+\)$/u, "")}`);
  located.pos = error.pos;
  located.line = error.line;
  located.column = error.column;
  return located;
}

/** Parse JavaScript (or, for a `.json` name, one JSON value) into an ESTree tree. */
function admittedProgram(text, fileName) {
  if (typeof text !== "string") throw new TypeError("source text must be a string");
  requireFileName(fileName);
  if (/\.(?:[cm]?tsx?|jsx)$/iu.test(fileName)) throw new SyntaxError(`${fileName}: TypeScript and JSX are not JavaScript; the house parses JavaScript only`);
  try {
    if (languageOf(fileName) === "json") {
      JSON.parse(text);
      const wrapped = parseJavaScript(`(${text})`, { sourceType: "script" });
      const shift = (node) => { node.start = Math.max(0, node.start - 1); node.end = Math.min(text.length, node.end - 1); };
      walkJavaScript(wrapped, (node) => { shift(node); });
      for (const token of wrapped.tokens) shift(token);
      wrapped.tokens = wrapped.tokens.slice(1, -1);
      wrapped.start = 0;
      wrapped.end = text.length;
      return wrapped;
    }
    return parseJavaScript(text);
  } catch (error) {
    if (error instanceof SyntaxError && error.line === undefined && languageOf(fileName) === "json") {
      const located = new SyntaxError(`${fileName}: ${error.message}`);
      throw located;
    }
    throw withFileName(error, fileName);
  }
}

function sourceDigest(text) {
  if (typeof text !== "string") throw new TypeError("source text must be a string");
  return sha256Digest(text);
}

/** A portable, cacheable description of a source carrier. It deliberately
 * identifies its bytes rather than embedding them, so a change plan can prove
 * which exact source it was admitted against. */
export function readJsnodeSourceRecord(text, fileName) {
  requireFileName(fileName);
  return Object.freeze({
    kind: "jsnode.source-record", version: 1, fileName, language: languageOf(fileName),
    length: text.length, digest: sourceDigest(text),
  });
}

/** The ESTree `Program` of one admitted JavaScript source, with `comments`
 * and `tokens`; a syntax error throws, located by file, line and column. */
export function readJsnodeAst(text, fileName) {
  return admittedProgram(text, fileName);
}

function projectNode(node) {
  const children = [];
  walkJavaScript(node, (child) => {
    if (child === node) return true;
    children.push(projectNode(child));
    return false;
  });
  return Object.freeze({ kind: node.type, start: node.start, end: node.end, children: Object.freeze(children) });
}

/** Parse JavaScript or JSON into a data-only tree and source-coordinate
 * diagnostics. This is syntactic admission, never import resolution or type checking. */
export function readJsnodeSyntax(text, fileName) {
  requireFileName(fileName);
  try {
    const program = admittedProgram(text, fileName);
    return Object.freeze({ fileName, language: languageOf(fileName), diagnostics: Object.freeze([]), tree: projectNode(program) });
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const start = error.pos ?? 0;
    const { line, column } = lineColumnOf(text, start);
    const diagnostic = Object.freeze({ message: error.message.replace(/^[^:]*:\d+:\d+: /u, ""), start, length: 0, line, column });
    return Object.freeze({ fileName, language: languageOf(fileName), diagnostics: Object.freeze([diagnostic]), tree: null });
  }
}

/** Read stable lexical data for scripts that need exact source spans but not
 * a syntax tree. Comments and whitespace remain source bytes; tokens carry
 * their kind (name, punct, string, num, template, regexp, privateName) and
 * original text. */
export function readJsnodeTokens(text, fileName) {
  const program = admittedProgram(text, fileName);
  const tokens = program.tokens.map((token) => Object.freeze({ kind: token.type, text: text.slice(token.start, token.end), start: token.start, end: token.end }));
  return Object.freeze({ source: readJsnodeSourceRecord(text, fileName), diagnostics: Object.freeze([]), tokens: Object.freeze(tokens) });
}

function literalRequest(kind, node) {
  if (!node || node.type !== "Literal" || typeof node.value !== "string") return Object.freeze({ kind, specifier: null, start: null, end: null });
  return Object.freeze({ kind, specifier: node.value, start: node.start, end: node.end });
}

function isRequireCall(node) {
  return node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require" && node.arguments.length > 0;
}

/** Read every static import/re-export, dynamic import, and CommonJS require.
 * Computed requests stay explicit as `specifier: null`; the engine never guesses. */
export function readJsnodeModuleRequests(text, fileName) {
  const program = admittedProgram(text, fileName);
  const requests = [];
  walkJavaScript(program, (node) => {
    if ((node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source) requests.push(literalRequest("static-import", node.source));
    else if (node.type === "ImportExpression") requests.push(literalRequest("dynamic-import", node.source));
    else if (isRequireCall(node)) requests.push(literalRequest("commonjs-require", node.arguments[0]));
  });
  return Object.freeze(requests.sort((left, right) => (left.start ?? 0) - (right.start ?? 0)));
}

/** Traverse an admitted JavaScript syntax tree without giving each consumer a
 * second parser. Nodes are ESTree; `visit(node, parent)` returning `false`
 * skips that node's children. */
export function visitJsnodeSyntax(text, fileName, visit) {
  if (typeof visit !== "function") throw new TypeError("JSNode syntax visitor must be a function");
  const program = admittedProgram(text, fileName);
  walkJavaScript(program, (node, parent) => (node === program ? true : visit(node, parent)));
}

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Read runtime-module edges with the same lexical try/catch qualification
 * used by release materialization. Function bodies intentionally leave an
 * enclosing try boundary because they execute later. */
export function readJsnodeRuntimeModuleRequests(text, fileName) {
  const program = admittedProgram(text, fileName);
  const requests = [];
  const visit = (node, guarded) => {
    if ((node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source) {
      requests.push(Object.freeze({ kind: "import", specifier: node.source.value }));
    } else if (node.type === "ImportExpression") {
      const request = literalRequest("dynamic-import", node.source);
      requests.push(Object.freeze({ kind: request.kind, specifier: request.specifier }));
    } else if (isRequireCall(node)) {
      const request = literalRequest("require", node.arguments[0]);
      requests.push(Object.freeze({ kind: request.kind, specifier: request.specifier, guarded }));
    }
    const crossesFunction = FUNCTION_TYPES.has(node.type);
    walkJavaScript(node, (child) => {
      if (child === node) return true;
      const insideTry = node.type === "TryStatement" && child === node.block && node.handler !== null;
      visit(child, !crossesFunction && (guarded || insideTry));
      return false;
    });
  };
  for (const statement of program.body) visit(statement, false);
  return Object.freeze(requests);
}

/** Read locally enumerable exports. `hasStarExport` prevents a caller from
 * treating a re-export whose dependency was not read as a complete surface. */
export function readJsnodeModuleExports(text, fileName = "module.mjs") {
  const program = admittedProgram(text, fileName);
  const names = [];
  let hasStarExport = false;
  const add = (name) => { if (!names.includes(name)) names.push(name); };
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") add("default");
    else if (statement.type === "ExportAllDeclaration") {
      if (statement.exported) add(exportedName(statement.exported)); else hasStarExport = true;
    } else if (statement.type === "ExportNamedDeclaration") {
      if (statement.declaration) for (const name of declaredNames(statement)) add(name);
      for (const specifier of statement.specifiers) add(exportedName(specifier.exported));
    }
  }
  return Object.freeze({ names: Object.freeze(names), hasStarExport });
}



function freezePlan(plan) {
  return Object.freeze({ ...plan, edits: Object.freeze(plan.edits.map((edit) => Object.freeze({ ...edit }))) });
}

function replacementLiteral(raw, replacement) {
  const quote = raw[0];
  if (quote !== "'" && quote !== '"') throw new TypeError("module request must be a quoted string literal");
  const escaped = replacement.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`).replaceAll("\n", "\\n").replaceAll("\r", "\\r");
  return `${quote}${escaped}${quote}`;
}

/** Make a portable, side-effect-free codemod plan for exact static module
 * specifiers. Unlike a text find/replace, only parser-admitted import,
 * re-export, dynamic-import, and require literals participate. */
export function planJsnodeModuleSpecifierRewrite(text, fileName, from, to) {
  if (typeof from !== "string" || from === "") throw new TypeError("source module specifier must be a non-empty string");
  if (typeof to !== "string" || to === "") throw new TypeError("target module specifier must be a non-empty string");
  const edits = readJsnodeModuleRequests(text, fileName)
    .filter((request) => request.specifier === from && request.start !== null && request.end !== null)
    .map((request) => ({ start: request.start, end: request.end, text: replacementLiteral(text.slice(request.start, request.end), to) }));
  return freezePlan({
    kind: "jsnode.module-specifier-rewrite.plan", version: 1, source: readJsnodeSourceRecord(text, fileName), from, to, edits,
  });
}

/** Apply a plan only to the exact source carrier it admitted. The receipt is
 * data, not an assertion: callers can persist it or decide to write its text
 * at their explicit filesystem boundary. */
export function applyJsnodeSourceEditPlan(text, fileName, plan) {
  if (plan === null || typeof plan !== "object" || plan.kind !== "jsnode.module-specifier-rewrite.plan" || plan.version !== 1) {
    throw new TypeError("not a JSNode module-specifier rewrite plan");
  }
  if (plan.source?.fileName !== fileName) throw new Error(`plan was admitted for ${String(plan.source?.fileName)}, not ${fileName}`);
  const actual = readJsnodeSourceRecord(text, fileName);
  if (plan.source.digest !== actual.digest) throw new Error("source changed after the JSNode plan was admitted");
  const output = applyExactSourceEdits(text, plan.edits);
  return Object.freeze({
    kind: "jsnode.source-edit.receipt", version: 1, planKind: plan.kind, source: actual,
    output: readJsnodeSourceRecord(output, fileName), editCount: plan.edits.length, text: output,
  });
}

function repositoryPath(value, label) {
  if (typeof value !== "string" || value === "" || path.isAbsolute(value)) throw new TypeError(`${label} must be a non-empty repository-relative path`);
  const normalized = path.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) throw new TypeError(`${label} must stay within the repository`);
  return normalized;
}

function collapseMappings(mapping) {
  if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)) throw new TypeError("collapse mapping must be an object");
  const files = Array.isArray(mapping.files) ? mapping.files : [];
  const packageExports = Array.isArray(mapping.packageExports) ? mapping.packageExports : [];
  const fileTargets = new Map();
  for (const item of files) {
    const from = repositoryPath(item?.from, "file mapping from");
    const to = repositoryPath(item?.to, "file mapping to");
    if (fileTargets.has(from)) throw new TypeError(`duplicate file mapping ${from}`);
    fileTargets.set(from, to);
  }
  const packageTargets = new Map();
  for (const item of packageExports) {
    if (typeof item?.specifier !== "string" || item.specifier === "" || item.specifier.startsWith(".") || item.specifier.startsWith("/")) throw new TypeError("package export specifier must be a bare module specifier");
    const to = repositoryPath(item.to, "package export mapping to");
    if (packageTargets.has(item.specifier)) throw new TypeError(`duplicate package export mapping ${item.specifier}`);
    if (item.replacement !== undefined && (typeof item.replacement !== "string" || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:\/[a-zA-Z0-9._/-]+)?$/u.test(item.replacement) || item.replacement.split("/").some((part) => part === "." || part === ".."))) throw new TypeError("package export replacement must be a bare package export");
    packageTargets.set(item.specifier, { to, replacement: item.replacement });
  }
  return { fileTargets, packageTargets };
}

function splitSpecifier(specifier) {
  const marker = specifier.search(/[?#]/u);
  return marker === -1 ? { pathname: specifier, suffix: "" } : { pathname: specifier.slice(0, marker), suffix: specifier.slice(marker) };
}

function relativeSpecifier(from, to) {
  const value = path.relative(path.dirname(from), to);
  return `${value === "" ? "./" : value.startsWith(".") ? value : `./${value}`}`;
}

function localTarget(specifier, fileName, fileTargets) {
  const { pathname, suffix } = splitSpecifier(specifier);
  if (!pathname.startsWith(".")) return undefined;
  const resolved = path.normalize(path.join(path.dirname(fileName), pathname));
  return { target: fileTargets.get(resolved) ?? resolved, suffix };
}


function collapseRequests(text, fileName) {
  const program = admittedProgram(text, fileName);
  const requests = [...readJsnodeModuleRequests(text, fileName)].filter((request) => request.specifier !== null && request.start !== null && request.end !== null);
  walkJavaScript(program, (node) => {
    if (node.type === "NewExpression" && node.callee.type === "Identifier" && node.callee.name === "URL" && node.arguments.length >= 2) {
      const [literal, base] = node.arguments;
      const importMetaUrl = base.type === "MemberExpression" && base.object.type === "MetaProperty" && base.object.meta.name === "import" && !base.computed && base.property.name === "url";
      if (literal.type === "Literal" && typeof literal.value === "string" && importMetaUrl) {
        requests.push(Object.freeze({ kind: "module-url", specifier: literal.value, start: literal.start, end: literal.end }));
      }
    }
  });
  for (const comment of program.comments) {
    for (const match of comment.value.matchAll(/import\(\s*(["'])([^"']+)\1\s*\)/gu)) {
      const start = comment.start + 2 + match.index + match[0].indexOf(match[1]);
      requests.push(Object.freeze({ kind: "type-import", specifier: match[2], start, end: start + match[2].length + 2 }));
    }
  }
  return [...new Map(requests.map((request) => [request.start, request])).values()];
}

/** Read source-bound package consumers with the same parser used by the
 * package-collapse planner. A matching data string is not an import edge. */
export function readJsnodePackageConsumers(text, fileName, specifiers) {
  const names = new Set(specifiers);
  return Object.freeze(collapseRequests(text, fileName)
    .filter((request) => request.kind !== "module-url" && names.has(request.specifier))
    .map((request) => Object.freeze({ kind: request.kind, specifier: request.specifier })));
}

/** Plan a selected source carrier's collapse from package boundaries into an
 * app module. The caller supplies every admissible old/new pathname and
 * package export target; this function discovers, moves, or deletes nothing. */
export function planJsnodePackageCollapse(text, fileName, mapping) {
  const originalPath = repositoryPath(fileName, "fileName");
  const { fileTargets, packageTargets } = collapseMappings(mapping);
  const outputPath = fileTargets.get(originalPath) ?? originalPath;
  const edits = collapseRequests(text, originalPath).flatMap((request) => {
    const packageTarget = request.kind === "module-url" ? undefined : packageTargets.get(request.specifier);
    const local = packageTarget === undefined ? localTarget(request.specifier, originalPath, fileTargets) : undefined;
    const target = packageTarget?.to ?? local?.target;
    if (target === undefined) return [];
    const replacement = packageTarget?.replacement ?? `${relativeSpecifier(outputPath, target)}${local?.suffix ?? ""}`;
    if (replacement === request.specifier) return [];
    return [{ start: request.start, end: request.end, text: replacementLiteral(text.slice(request.start, request.end), replacement) }];
  });
  return freezePlan({
    kind: "jsnode.package-collapse.plan", version: 1, source: readJsnodeSourceRecord(text, originalPath), outputPath, edits,
  });
}

/** Apply a selected package-collapse plan; filesystem mutation and retirement
 * remain outside the pure projection. */
export function applyJsnodePackageCollapsePlan(text, fileName, plan) {
  if (plan === null || typeof plan !== "object" || plan.kind !== "jsnode.package-collapse.plan" || plan.version !== 1) throw new TypeError("not a JSNode package-collapse plan");
  const originalPath = repositoryPath(fileName, "fileName");
  if (plan.source?.fileName !== originalPath) throw new Error(`plan was admitted for ${String(plan.source?.fileName)}, not ${originalPath}`);
  const actual = readJsnodeSourceRecord(text, originalPath);
  if (plan.source.digest !== actual.digest) throw new Error("source changed after the JSNode plan was admitted");
  const output = applyExactSourceEdits(text, plan.edits);
  return Object.freeze({ kind: "jsnode.package-collapse.receipt", version: 1, planKind: plan.kind, source: actual, output: readJsnodeSourceRecord(output, plan.outputPath), outputPath: plan.outputPath, editCount: plan.edits.length, text: output });
}
