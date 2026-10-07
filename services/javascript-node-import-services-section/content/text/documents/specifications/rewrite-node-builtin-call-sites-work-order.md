# rewrite-node-builtin-call-sites
## Requirements
- `call-sites-rewritten`: The operation rewrites every call site whose callee resolves — by direct identifier for a named import, or by property access for a namespace or default import — to the mapping's `builtin`/`importedName` pair, replacing the call with `${mapping.houseFunction}(...)`: an existing single spread argument (`resolve(...xs)`) is unwrapped to its bare expression (`resolveFilepath(xs)`), and one or more plain arguments are wrapped into a single array literal (`resolve(a, b)` → `resolveFilepath([a, b])`).
- `house-import-added`: When no import in the source already binds `mapping.houseFunction` from `mapping.housePackage`, the operation inserts `import { <houseFunction> } from "<housePackage>";` after the source's last top-level import declaration (or after a leading shebang line, or at the very top when the source carries neither), and reports it as `importAdded: {source, name}`.
- `builtin-import-removed-when-unused`: When rewriting leaves no remaining reference to the local binding that resolved the matched call sites, the operation removes that import: the whole import declaration when it was the only specifier bound to that module, or just the matched specifier (rejoining the remaining specifiers) when others remain — and reports it as `importRemoved: {source, name}`. A binding still referenced elsewhere (as a value, or through another call site) is left untouched and `importRemoved` is `null`.
- `no-match-is-a-no-op`: When no call site resolves to the mapping's `builtin`/`importedName` pair, the operation returns the input `text` unchanged with `rewrittenCallSites: 0`, `importAdded: null`, `importRemoved: null`.
- `pure-rewrite`: The operation performs no filesystem access; it reads only `text` and `mapping` from its request and returns a new in-memory record.
## Prohibitions
- `gap-mapping-refusal`: The operation must refuse (throw `TypeError`) a mapping whose `housePackage` or `houseFunction` is missing — a gap mapping has no house hand to rewrite to.
- `async-mismatch-refusal`: The operation must refuse a mapping whose `builtinIsAsync` differs from `houseHandIsAsync` — this operation performs no await/promise-shape rewriting.
- `unsupported-from-form-refusal`: The operation must refuse a mapping whose `fromForm` is not a single-rest-parameter call form (`name(...ident)`) — the only argument-shape transform this operation implements.
- `no-byte-drift-elsewhere`: Characters outside a rewritten call site and the touched import text must be returned byte-identical to the input.
## Laws
- `fabricate-do-not-hand-write` | 561 Group working discipline, dispatch-agents skill | 2026-09-04 | .claude/skills/dispatch-agents/SKILL.md | Applies to this operation's own birth. | This codemod operation is fabricated through the jsnode fabrication line from this work order, never hand-written, so the tree's own house-hand migration does not itself start as an exception to the rule it enforces.
- `primitives-exist-once` | 561 Group working discipline | 2026-08-30 | CLAUDE.md | Applies to every call site this operation rewrites. | A rewritten call site retires one more hand-rolled use of a Node builtin the registry already owns once as a house primitive.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation, its import.meta.main guard, and downstream package-birth assays. | The package uses one executable ESM operation source file that is eligible for downstream staged package-birth assays.
- `typescript-compiler-api` | TypeScript | 5.9.3 | https://github.com/microsoft/TypeScript/wiki/Architectural-Overview | Applies to the AST parse, traversal, and text-range edits used to find and rewrite call sites and import declarations. | The 5.9.3 pin is fixed because the classic Compiler API surface this operation calls (`ts.createSourceFile`, `ts.forEachChild`, node type guards, `getStart`/`getEnd`/`getText`) is dropped starting with TypeScript 7.
## Open questions
- `positional-from-form-rule` [nonblocking]: A mapping whose `fromForm` is a positional (non-rest-parameter) call — e.g. `map-url-file-url-to-path`'s `fileURLToPath(urlOrString)`, whose `toForm` also transforms the argument expression itself (`urlOrString.href ?? urlOrString`) rather than only renaming the callee — needs a second argument-shape rule this first version does not implement; `unsupported-from-form-refusal` makes that gap loud rather than silently mis-rewriting.
## Package
```json
{"packageName":"@red-cup-engineering/rewrite-node-builtin-call-sites-service","packageVersion":"0.1.0","license":"MIT","dependencies":{"typescript":"5.9.3"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/rewrite-node-builtin-call-sites.mjs
#!/usr/bin/env node
import ts from "typescript";

const FROM_FORM_PATTERN = /^[A-Za-z_$][\w$]*\(\.\.\.[A-Za-z_$][\w$]*\)$/u;

function collectBuiltinBindings(statements, builtin) {
  const named = new Map();
  const namespaceLike = new Set();
  const declarations = [];
  for (const statement of statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== builtin) continue;
    declarations.push(statement);
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) namespaceLike.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaceLike.add(bindings.name.text);
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = element.propertyName ? element.propertyName.text : element.name.text;
        named.set(element.name.text, importedName);
      }
    }
  }
  return { named, namespaceLike, declarations };
}

function matchSite(node, named, namespaceLike, importedName) {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) {
    if (named.get(expression.text) === importedName) return { localName: expression.text, node: expression };
    return null;
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && ts.isIdentifier(expression.name)) {
    if (namespaceLike.has(expression.expression.text) && expression.name.text === importedName) {
      return { localName: expression.expression.text, node: expression.expression };
    }
  }
  return null;
}

function collectCallSites(source, named, namespaceLike, importedName) {
  const sites = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const match = matchSite(node, named, namespaceLike, importedName);
      if (match !== null) sites.push({ call: node, ...match });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

function rewrittenCallText(call, source, houseFunction) {
  const args = call.arguments;
  let argsText;
  if (args.length === 1 && ts.isSpreadElement(args[0])) {
    argsText = args[0].expression.getText(source);
  } else {
    argsText = `[${args.map((a) => a.getText(source)).join(", ")}]`;
  }
  return `${houseFunction}(${argsText})`;
}

function hasOtherIdentifierUse(source, name, excluded) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name && !excluded.has(node)) {
      const parent = node.parent;
      const isImportName =
        (ts.isImportSpecifier(parent) && parent.name === node) ||
        (ts.isNamespaceImport(parent) && parent.name === node) ||
        (ts.isImportClause(parent) && parent.name === node);
      if (!isImportName) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function consumeTrailingNewline(text, pos) {
  if (text[pos] === "\r" && text[pos + 1] === "\n") return pos + 2;
  if (text[pos] === "\n") return pos + 1;
  return pos;
}

function shebangEnd(text) {
  if (!text.startsWith("#!")) return 0;
  const newline = text.indexOf("\n");
  return newline === -1 ? text.length : newline + 1;
}

function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let result = "";
  let cursor = 0;
  for (const edit of sorted) {
    result += text.slice(cursor, edit.start);
    result += edit.text;
    cursor = edit.end;
  }
  result += text.slice(cursor);
  return result;
}

/**
 * Rewrites every call site of one node-builtin-to-house-hand mapping's builtin form in a JavaScript ESM source to the house form, adding the house import when absent and dropping the builtin import when it becomes unused — a pure text transform with no filesystem access.
 * @param {object} request A record with `text` (complete JavaScript ESM source) and `mapping` (one entry from the 2026-09-04 node-builtin-to-house-hand mapping record, carrying `builtin`, `importedName`, `fromForm`, `housePackage`, `houseFunction`, `builtinIsAsync`, `houseHandIsAsync`).
 * @returns {object} A record with `text` (the rewritten source), `rewrittenCallSites` (count), `importAdded` (`{source, name}` or `null`), `importRemoved` (`{source, name}` or `null`).
 * @throws {TypeError} When `text` is not a string, `mapping` is not an object, `mapping.housePackage`/`mapping.houseFunction` is missing (a gap mapping has no house hand to rewrite to), `mapping.builtinIsAsync` differs from `mapping.houseHandIsAsync`, or `mapping.fromForm` is not a single-rest-parameter call form (`name(...ident)`).
 * @throws {SyntaxError} When the carried JavaScript does not parse (propagated from the TypeScript source-file parse).
 */
export function rewriteNodeBuiltinCallSites(request) {
  if (typeof request?.text !== "string") throw new TypeError("text must be a string");
  const mapping = request?.mapping;
  if (typeof mapping !== "object" || mapping === null) throw new TypeError("mapping must be an object");
  const { builtin, importedName, fromForm, housePackage, houseFunction, builtinIsAsync, houseHandIsAsync } = mapping;
  if (typeof builtin !== "string" || typeof importedName !== "string" || typeof fromForm !== "string") {
    throw new TypeError("mapping must carry builtin, importedName, and fromForm strings");
  }
  if (typeof housePackage !== "string" || typeof houseFunction !== "string") {
    throw new TypeError("mapping has no house hand to rewrite to (housePackage/houseFunction missing)");
  }
  if (Boolean(builtinIsAsync) !== Boolean(houseHandIsAsync)) {
    throw new TypeError("mapping's builtin and house hand differ in async shape; unsupported by this operation");
  }
  if (!FROM_FORM_PATTERN.test(fromForm)) {
    throw new TypeError("mapping.fromForm must be a single-rest-parameter call form: name(...ident)");
  }

  const text = request.text;
  const source = ts.createSourceFile("scripts/x.mjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const statements = [...source.statements];
  const { named, namespaceLike, declarations } = collectBuiltinBindings(statements, builtin);
  const sites = collectCallSites(source, named, namespaceLike, importedName);

  if (sites.length === 0) {
    return { text, rewrittenCallSites: 0, importAdded: null, importRemoved: null };
  }

  const edits = [];
  const excludedIdentifiers = new Set(sites.map((s) => s.node));
  for (const site of sites) {
    edits.push({ start: site.call.getStart(source), end: site.call.getEnd(), text: rewrittenCallText(site.call, source, houseFunction) });
  }

  const localName = sites[0].localName;
  let importRemoved = null;
  let removedDeclaration = null;
  if (!hasOtherIdentifierUse(source, localName, excludedIdentifiers)) {
    for (const decl of declarations) {
      const clause = decl.importClause;
      if (!clause) continue;
      if (clause.name && clause.name.text === localName) {
        removedDeclaration = decl;
        importRemoved = { source: builtin, name: importedName };
        break;
      }
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === localName) {
        removedDeclaration = decl;
        importRemoved = { source: builtin, name: importedName };
        break;
      }
      if (bindings && ts.isNamedImports(bindings)) {
        const match = bindings.elements.find((e) => e.name.text === localName);
        if (match) {
          const remaining = bindings.elements.filter((e) => e.name.text !== localName);
          if (remaining.length === 0) {
            removedDeclaration = decl;
          } else {
            const newBindingsText = `{ ${remaining.map((e) => e.getText(source)).join(", ")} }`;
            edits.push({ start: bindings.getStart(source), end: bindings.getEnd(), text: newBindingsText });
          }
          importRemoved = { source: builtin, name: importedName };
          break;
        }
      }
    }
  }

  const alreadyImported = statements.some((s) => {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) return false;
    if (s.moduleSpecifier.text !== housePackage) return false;
    const clause = s.importClause;
    if (!clause || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
    return clause.namedBindings.elements.some((e) => (e.propertyName ? e.propertyName.text : e.name.text) === houseFunction);
  });

  let importAdded = null;
  if (!alreadyImported) {
    importAdded = { source: housePackage, name: houseFunction };
    const importDecls = statements.filter((s) => ts.isImportDeclaration(s));
    const isRemovedDeclLast = removedDeclaration !== null && importDecls[importDecls.length - 1] === removedDeclaration;
    if (isRemovedDeclLast) {
      edits.push({
        start: removedDeclaration.getStart(source),
        end: consumeTrailingNewline(text, removedDeclaration.getEnd()),
        text: `import { ${houseFunction} } from "${housePackage}";\n`,
      });
    } else {
      if (removedDeclaration !== null) {
        edits.push({
          start: removedDeclaration.getStart(source),
          end: consumeTrailingNewline(text, removedDeclaration.getEnd()),
          text: "",
        });
      }
      const remaining = removedDeclaration === null ? importDecls : importDecls.filter((d) => d !== removedDeclaration);
      const anchorEnd = remaining.length > 0 ? remaining[remaining.length - 1].getEnd() : shebangEnd(text);
      edits.push({ start: anchorEnd, end: anchorEnd, text: `\nimport { ${houseFunction} } from "${housePackage}";` });
    }
  } else if (removedDeclaration !== null) {
    edits.push({
      start: removedDeclaration.getStart(source),
      end: consumeTrailingNewline(text, removedDeclaration.getEnd()),
      text: "",
    });
  }

  const rewritten = applyEdits(text, edits);
  return { text: rewritten, rewrittenCallSites: sites.length, importAdded, importRemoved };
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "rewriteNodeBuiltinCallSites — Rewrites every call site of one node-builtin-to-house-hand mapping's builtin form in a JavaScript ESM source to the house form, adding the house import when absent and dropping the builtin import when it becomes unused — a pure text transform with no filesystem access.\n",
    );
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.length > 0) process.stdout.write(`${JSON.stringify(rewriteNodeBuiltinCallSites(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/rewrite-node-builtin-call-sites.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { rewriteNodeBuiltinCallSites } from "../scripts/rewrite-node-builtin-call-sites.mjs";

const mapping = {
  id: "map-path-resolve",
  builtin: "node:path",
  importedName: "resolve",
  fromForm: "resolve(...segments)",
  toForm: "resolveFilepath(segments)  // segments: string[]",
  housePackage: "@red-cup-engineering/resolve-filepath-service",
  houseVersion: "0.1.1",
  houseFunction: "resolveFilepath",
  builtinIsAsync: false,
  houseHandIsAsync: false,
  exactCallShapeMatch: true,
  rewritableWithoutFurtherChange: true,
};

test("swaps sole import when it is the last import (shebang anchor)", () => {
  const text = "#!/usr/bin/env node\nimport { resolve } from \"node:path\";\nconst p = resolve(...parts);\n";
  const result = rewriteNodeBuiltinCallSites({ text, mapping });
  assert.equal(
    result.text,
    "#!/usr/bin/env node\nimport { resolveFilepath } from \"@red-cup-engineering/resolve-filepath-service\";\nconst p = resolveFilepath(parts);\n",
  );
  assert.equal(result.rewrittenCallSites, 1);
  assert.deepEqual(result.importAdded, { source: "@red-cup-engineering/resolve-filepath-service", name: "resolveFilepath" });
  assert.deepEqual(result.importRemoved, { source: "node:path", name: "resolve" });
});

test("wraps multiple plain arguments into one array literal", () => {
  const text = "import { resolve } from \"node:path\";\nconst p = resolve(a, b);\n";
  const result = rewriteNodeBuiltinCallSites({ text, mapping });
  assert.match(result.text, /resolveFilepath\(\[a, b\]\)/u);
  assert.equal(result.rewrittenCallSites, 1);
});

test("removes only the matched specifier when other specifiers remain in use", () => {
  const text = "import { resolve, join } from \"node:path\";\nconst p = resolve(...xs);\nconst q = join(\"a\", \"b\");\n";
  const result = rewriteNodeBuiltinCallSites({ text, mapping });
  assert.match(result.text, /import \{ join \} from "node:path";/u);
  assert.match(result.text, /import \{ resolveFilepath \} from "@red-cup-engineering\/resolve-filepath-service";/u);
  assert.match(result.text, /resolveFilepath\(xs\)/u);
  assert.deepEqual(result.importRemoved, { source: "node:path", name: "resolve" });
  assert.deepEqual(result.importAdded, { source: "@red-cup-engineering/resolve-filepath-service", name: "resolveFilepath" });
});

test("does not re-add an already-present house import", () => {
  const text =
    "import { resolveFilepath } from \"@red-cup-engineering/resolve-filepath-service\";\n" +
    "import { resolve } from \"node:path\";\n" +
    "const p = resolve(...xs);\n" +
    "const q = resolveFilepath([1]);\n";
  const result = rewriteNodeBuiltinCallSites({ text, mapping });
  assert.equal(result.importAdded, null);
  assert.deepEqual(result.importRemoved, { source: "node:path", name: "resolve" });
  const occurrences = result.text.match(/resolveFilepath \} from/gu) ?? [];
  assert.equal(occurrences.length, 1);
});

test("leaves the builtin import when the local name is still used elsewhere", () => {
  const text = "import { resolve } from \"node:path\";\nconst p = resolve(...xs);\nconst f = resolve;\n";
  const result = rewriteNodeBuiltinCallSites({ text, mapping });
  assert.match(result.text, /import \{ resolve \} from "node:path";/u);
  assert.equal(result.importRemoved, null);
  assert.match(result.text, /resolveFilepath\(xs\)/u);
});

test("resolves a namespace-import call site", () => {
  const text = "import * as path from \"node:path\";\nconst p = path.resolve(...xs);\n";
  const result = rewriteNodeBuiltinCallSites({ text, mapping });
  assert.match(result.text, /resolveFilepath\(xs\)/u);
  assert.deepEqual(result.importRemoved, { source: "node:path", name: "resolve" });
});

test("is a no-op when no call site matches", () => {
  const text = "import { dirname } from \"node:path\";\nconst d = dirname(\"/a/b\");\n";
  const result = rewriteNodeBuiltinCallSites({ text, mapping });
  assert.equal(result.text, text);
  assert.equal(result.rewrittenCallSites, 0);
  assert.equal(result.importAdded, null);
  assert.equal(result.importRemoved, null);
});

test("refuses a gap mapping with no house hand", () => {
  const gap = { ...mapping, housePackage: null, houseFunction: null };
  assert.throws(() => rewriteNodeBuiltinCallSites({ text: "const x = 1;\n", mapping: gap }), /house hand/u);
});

test("refuses an async-shape mismatch", () => {
  const mismatched = { ...mapping, houseHandIsAsync: true };
  assert.throws(() => rewriteNodeBuiltinCallSites({ text: "const x = 1;\n", mapping: mismatched }), /async shape/u);
});

test("refuses a non-single-rest-parameter fromForm", () => {
  const positional = { ...mapping, fromForm: "fileURLToPath(urlOrString)" };
  assert.throws(() => rewriteNodeBuiltinCallSites({ text: "const x = 1;\n", mapping: positional }), /single-rest-parameter/u);
});

test("refuses a missing text", () => {
  assert.throws(() => rewriteNodeBuiltinCallSites({ mapping }), /text must be a string/u);
});
```
## Examples
```json name="swaps a sole spread-argument call site and its import"
{"input":{"text":"import { resolve } from \"node:path\";\nconst p = resolve(...parts);\n","mapping":{"id":"map-path-resolve","builtin":"node:path","importedName":"resolve","fromForm":"resolve(...segments)","toForm":"resolveFilepath(segments)  // segments: string[]","housePackage":"@red-cup-engineering/resolve-filepath-service","houseVersion":"0.1.1","houseFunction":"resolveFilepath","builtinIsAsync":false,"houseHandIsAsync":false,"exactCallShapeMatch":true,"rewritableWithoutFurtherChange":true}},"output":{"text":"import { resolveFilepath } from \"@red-cup-engineering/resolve-filepath-service\";\nconst p = resolveFilepath(parts);\n","rewrittenCallSites":1,"importAdded":{"source":"@red-cup-engineering/resolve-filepath-service","name":"resolveFilepath"},"importRemoved":{"source":"node:path","name":"resolve"}}}
```
## Traceability
- `call-sites-rewritten` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`, `typescript-compiler-api`
- `house-import-added` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`, `typescript-compiler-api`
- `builtin-import-removed-when-unused` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`, `typescript-compiler-api`
- `no-match-is-a-no-op` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `pure-rewrite` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `gap-mapping-refusal` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `fabricate-do-not-hand-write`, `primitives-exist-once`
- `async-mismatch-refusal` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `unsupported-from-form-refusal` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `no-byte-drift-elsewhere` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `typescript-compiler-api`
