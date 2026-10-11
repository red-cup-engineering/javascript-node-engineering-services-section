/**
 * STD-ENTRY: every ECMAScript module decides whether it is the script Node was asked to run through one owner,
 * `isEntryModule(import.meta.url)` from `@red-cup-engineering/node-process-services-section/entrypoint`, never
 * through a hand-written comparison of `process.argv[1]` with `import.meta.url`. Node resolves
 * `import.meta.url` to the real path while `argv[1]` keeps symbolic links, so the usual hand-written shapes
 * answer false for a script run through a pnpm-linked `node_modules/@scope/pkg` directory: the script then
 * does nothing and exits 0 (Cold Red Gate runs 388 and 399).
 *
 * This module reads one source text with the house parser and finds every hand-written guard: a comparison
 * (`===`, `==`, `!==`, `!=`) between an expression reading `process.argv[1]` and one reading
 * `import.meta.url`, together with the `process.argv[1] &&` presence checks and try/catch IIFEs wrapped
 * around it; and a helper function that makes that comparison against a URL parameter. It rewrites each to
 * the owner's call, adds the owner's import, and drops the imports only the guard used.
 */
import { applyExactSourceEdits } from "@red-cup-engineering/computer-code-engineering-services-section/exact-source-edits";
import { lineColumnOf, parseJavaScript, walkJavaScript } from "./javascript-parser.mjs";

export const STD_ENTRY_OWNER = "@red-cup-engineering/node-process-services-section";
export const STD_ENTRY_SPECIFIER = `${STD_ENTRY_OWNER}/entrypoint`;
export const STD_ENTRY_FUNCTION = "isEntryModule";

const COMPARISONS = new Set(["===", "==", "!==", "!="]);
const NEGATIONS = new Set(["!==", "!="]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
// Names a guard typically imports only for itself; one of these is dropped when nothing else reads it.
const GUARD_NAMES = new Set(["realpathSync", "fileURLToPath", "pathToFileURL", "resolve", "path", "url", "fs"]);

const isArgv1 = (node) => node.type === "MemberExpression" && node.computed && node.property.type === "Literal" && node.property.value === 1
  && node.object.type === "MemberExpression" && !node.object.computed && node.object.property.name === "argv"
  && node.object.object.type === "Identifier" && node.object.object.name === "process";
// The module's own location as Node gives it: `import.meta.url`, or `import.meta.filename` (its path).
const isMetaUrl = (node) => node.type === "MemberExpression" && !node.computed && ["url", "filename"].includes(node.property.name) && node.object.type === "MetaProperty";

function mentions(node, test) {
  let found = false;
  walkJavaScript(node, (child) => { if (found) return false; if (test(child)) { found = true; return false; } return true; });
  return found;
}
const identifierNamed = (name) => (node) => node.type === "Identifier" && node.name === name;

/** Every node with its parent, so a guard can be widened to what encloses it. */
function parents(program) {
  const parentOf = new Map();
  walkJavaScript(program, (node, parent) => { parentOf.set(node, parent); return true; });
  return parentOf;
}

/** The function `node` is the body (or sole try's return) of, when that function is an immediately called IIFE. */
function enclosingCalledFunction(node, parentOf) {
  let cur = node;
  for (let hops = 0; hops < 6 && cur; hops += 1) {
    const parent = parentOf.get(cur);
    if (!parent) return undefined;
    if (FUNCTIONS.has(parent.type) && parent.body === cur) {
      const call = parentOf.get(parent);
      if (call?.type === "CallExpression" && call.callee === parent && call.arguments.length === 0 && parent.params.length === 0) return call;
      return undefined;
    }
    if (!["ReturnStatement", "BlockStatement", "TryStatement", "IfStatement"].includes(parent.type)) return undefined;
    cur = parent;
  }
  return undefined;
}

/** Widen a comparison to the whole guard: `process.argv[1] && …` presence checks and try/catch IIFEs. */
function widen(comparison, parentOf) {
  let cur = comparison;
  for (;;) {
    const parent = parentOf.get(cur);
    if (parent?.type === "LogicalExpression" && parent.operator === "&&") {
      const other = parent.left === cur ? parent.right : parent.left;
      if (mentions(other, isArgv1) && !mentions(other, isMetaUrl)) { cur = parent; continue; }
    }
    const call = enclosingCalledFunction(cur, parentOf);
    if (call !== undefined) { cur = call; continue; }
    return cur;
  }
}

const returnsFalse = (statement) => statement?.type === "ReturnStatement" && statement.argument?.type === "Literal" && statement.argument.value === false;
const onlyStatement = (block) => (block?.type === "BlockStatement" && block.body.length === 1 ? block.body[0] : block);

/** Whether a helper's body is nothing but the guard: presence checks returning false, the comparison
 *  (bare, `&&`-guarded, or returned from a try whose catch returns false). Anything else is left alone. */
function onlyGuard(body, comparison) {
  const isGuardExpression = (node) => node === comparison || (node?.type === "LogicalExpression" && node.operator === "&&"
    && [node.left, node.right].includes(comparison) && mentions(node.left === comparison ? node.right : node.left, isArgv1));
  if (body.type !== "BlockStatement") return isGuardExpression(body);
  return body.body.every((statement) => {
    if (statement.type === "IfStatement") return mentions(statement.test, isArgv1) && returnsFalse(onlyStatement(statement.consequent)) && !statement.alternate;
    if (statement.type === "ReturnStatement") return isGuardExpression(statement.argument);
    if (statement.type === "TryStatement") {
      const tried = onlyStatement(statement.block);
      return tried?.type === "ReturnStatement" && isGuardExpression(tried.argument) && returnsFalse(onlyStatement(statement.handler?.body)) && !statement.finalizer;
    }
    return false;
  });
}

/** A helper function whose whole body compares `process.argv[1]` against one of its own URL parameters. */
function helperParameter(comparison, otherSide, parentOf) {
  for (let cur = parentOf.get(comparison); cur; cur = parentOf.get(cur)) {
    if (!FUNCTIONS.has(cur.type)) continue;
    const parameter = cur.params.find((param) => param.type === "Identifier" && mentions(otherSide, identifierNamed(param.name)));
    if (parameter === undefined || !onlyGuard(cur.body, comparison)) return undefined;
    return { fn: cur, parameter: parameter.name };
  }
  return undefined;
}

/** The text between an `if`'s own parentheses, so `if ((guard))` becomes `if (isEntryModule(…))`. */
function ifTestSpan(text, statement) {
  const open = text.indexOf("(", statement.start + 2);
  let close = statement.consequent.start - 1;
  while (close > open && text[close] !== ")") close -= 1;
  return { start: open + 1, end: close };
}

/** Each hand-written entry guard in `text`: where it is, its shape, and what it becomes. */
export function findEntryGuards(text) {
  const program = parseJavaScript(text);
  const parentOf = parents(program);
  const guards = [], unrewritten = [], seen = new Set();
  walkJavaScript(program, (node) => {
    if (node.type !== "BinaryExpression" || !COMPARISONS.has(node.operator)) return true;
    const leftArgv = mentions(node.left, isArgv1), rightArgv = mentions(node.right, isArgv1);
    if (!leftArgv && !rightArgv) return true;
    const otherSide = leftArgv ? node.right : node.left;
    const where = lineColumnOf(text, node.start);
    const symlinkBlind = !/realpath/u.test(text.slice(node.start, node.end));
    if (mentions(otherSide, isMetaUrl)) {
      const span = widen(node, parentOf);
      if (seen.has(span)) return false;
      seen.add(span);
      const negated = span === node && NEGATIONS.has(node.operator);
      const parent = parentOf.get(span);
      const range = parent?.type === "IfStatement" && parent.test === span ? ifTestSpan(text, parent) : { start: span.start, end: span.end };
      guards.push({ line: where.line, shape: "inline", symlinkBlind, start: range.start, end: range.end,
        from: text.slice(range.start, range.end), to: `${negated ? "!" : ""}${STD_ENTRY_FUNCTION}(import.meta.url)` });
      return false;
    }
    const helper = helperParameter(node, otherSide, parentOf);
    if (helper !== undefined) {
      const { fn, parameter } = helper;
      if (seen.has(fn)) return false;
      seen.add(fn);
      const body = fn.body;
      const to = body.type === "BlockStatement" ? `{ return ${STD_ENTRY_FUNCTION}(${parameter}); }` : `${STD_ENTRY_FUNCTION}(${parameter})`;
      guards.push({ line: where.line, shape: "helper", symlinkBlind, start: body.start, end: body.end, from: text.slice(body.start, body.end), to });
      return false;
    }
    if (/import\.meta|fileURLToPath|realpath/u.test(text.slice(node.start, node.end))) unrewritten.push({ line: where.line, text: text.slice(node.start, node.end) });
    return true;
  });
  return { guards, unrewritten };
}

/** Identifier references in `program` by name, outside import declarations, member property names and keys. */
function references(program) {
  const counts = new Map();
  walkJavaScript(program, (node, parent) => {
    if (node.type === "ImportDeclaration") return false;
    if (node.type !== "Identifier") return true;
    if (parent?.type === "MemberExpression" && parent.property === node && !parent.computed) return true;
    if (parent?.type === "Property" && parent.key === node && !parent.computed && !parent.shorthand) return true;
    counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
    return true;
  });
  return counts;
}

function importEdits(text, program, guardNames) {
  const used = references(program);
  const edits = [], removed = [];
  let ownerImport;
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    if (statement.source.value === STD_ENTRY_SPECIFIER) ownerImport = statement;
    const drop = statement.specifiers.filter((specifier) => GUARD_NAMES.has(specifier.local.name) && guardNames.has(specifier.local.name) && !used.has(specifier.local.name));
    if (drop.length === 0) continue;
    removed.push(...drop.map((specifier) => specifier.local.name));
    const keep = statement.specifiers.filter((specifier) => !drop.includes(specifier));
    let end = statement.end;
    if (keep.length === 0) {
      while (text[end] === "\n" || text[end] === "\r") { end += 1; if (text[end - 1] === "\n") break; }
      edits.push({ start: statement.start, end, text: "" });
      continue;
    }
    const named = keep.filter((specifier) => specifier.type === "ImportSpecifier").map((specifier) => text.slice(specifier.start, specifier.end));
    const head = keep.filter((specifier) => specifier.type !== "ImportSpecifier").map((specifier) => text.slice(specifier.start, specifier.end));
    const clause = [...head, ...(named.length ? [`{ ${named.join(", ")} }`] : [])].join(", ");
    edits.push({ start: statement.start, end: statement.end, text: `import ${clause} from ${text.slice(statement.source.start, statement.source.end)};` });
  }
  return { edits, removed, ownerImport };
}

/**
 * Rewrite every hand-written entry guard in `text` to the owner's call. Returns the new text, each rewrite
 * (with whether the old guard was symlink-blind, the behaviour change a caller through `node_modules` sees),
 * the comparisons it could not rewrite, and the imports it added and removed.
 */
export function rewriteEntryGuards(text) {
  const { guards, unrewritten } = findEntryGuards(text);
  if (guards.length === 0) return { text, changed: false, rewrites: [], unrewritten, imports: { added: [], removed: [] } };
  const program = parseJavaScript(text);
  const bound = references(program);
  const declaresOwnName = (() => {
    let found = false;
    walkJavaScript(program, (node) => {
      if ((node.type === "FunctionDeclaration" || node.type === "VariableDeclarator") && node.id?.type === "Identifier" && node.id.name === STD_ENTRY_FUNCTION) found = true;
      return !found;
    });
    return found;
  })();
  if (declaresOwnName) return { text, changed: false, rewrites: [], unrewritten: [...unrewritten, ...guards.map(({ line, from }) => ({ line, text: from, reason: `the module declares its own ${STD_ENTRY_FUNCTION}` }))], imports: { added: [], removed: [] } };
  let rewritten = applyExactSourceEdits(text, guards.map(({ start, end, to }) => ({ start, end, text: to })));
  const after = parseJavaScript(rewritten);
  const guardNames = new Set(guards.flatMap(({ from }) => [...from.matchAll(/[A-Za-z_$][\w$]*/gu)].map((match) => match[0])).filter((name) => bound.has(name)));
  const { edits, removed, ownerImport } = importEdits(rewritten, after, guardNames);
  rewritten = applyExactSourceEdits(rewritten, edits);
  const added = [];
  const hasOwnerBinding = ownerImport?.specifiers.some((specifier) => specifier.local.name === STD_ENTRY_FUNCTION);
  if (!hasOwnerBinding) {
    added.push(STD_ENTRY_SPECIFIER);
    const imports = parseJavaScript(rewritten).body.filter((statement) => statement.type === "ImportDeclaration");
    const anchor = imports.length ? imports[imports.length - 1].end : (rewritten.startsWith("#!") ? rewritten.indexOf("\n") + 1 : 0);
    const line = `import { ${STD_ENTRY_FUNCTION} } from "${STD_ENTRY_SPECIFIER}";`;
    rewritten = applyExactSourceEdits(rewritten, [imports.length ? { start: anchor, end: anchor, text: `\n${line}` } : { start: anchor, end: anchor, text: `${line}\n` }]);
  }
  parseJavaScript(rewritten);
  return {
    text: rewritten, changed: true, unrewritten,
    rewrites: guards.map(({ line, shape, symlinkBlind, from, to }) => ({ line, shape, symlinkBlind, from, to })),
    imports: { added, removed },
  };
}
