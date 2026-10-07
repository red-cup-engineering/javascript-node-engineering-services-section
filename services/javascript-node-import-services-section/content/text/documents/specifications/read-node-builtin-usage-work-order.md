# read-node-builtin-usage
## Requirements
- `import-specifiers-listed`: The operation returns a NodeBuiltinUsageReading record listing every `node:`-prefixed import declaration in the source, each with its line, the builtin specifier, and its named/default/namespace local bindings.
- `call-sites-with-line-and-form`: The operation walks the whole source (not only top-level statements) and returns every call site whose callee resolves to an imported Node built-in — by direct identifier for a named import, or by property access for a namespace or default import — each with its line number and its exact call-expression source text (`form`).
- `mapping-id-or-null`: Each call site carries the `mappingId` from an embedded builtin.importedName lookup table mirroring the 2026-09-04 node-builtin-to-house-hand mapping record, or `null` when the pair is not in the table.
- `awaited-flag`: Each call site records whether it is the operand of an `await` expression, so a later pass can tell an already-async call site from a synchronous one without re-parsing.
- `pure-reading`: The operation performs no filesystem access; it reads only the `text` and `path` fields of its request.
## Prohibitions
- `missing-text-or-path-refusal`: The operation must refuse a request whose `text` is not a string, or whose `path` does not end in `scripts/<name>.mjs` (at any directory depth).
- `no-mapping-invention`: The operation must not invent a mapping id for a builtin.importedName pair absent from its embedded table; such a pair reports `mappingId: null`.
## Laws
- `fabricate-do-not-hand-write` | 561 Group working discipline, dispatch-agents skill | 2026-09-04 | .claude/skills/dispatch-agents/SKILL.md | Applies to the imports of every new script and source module in the tree. | A direct node:fs, node:path, or node:child_process import where a house service exists is a defect a lot must not ship; this operation is what measures how many such imports remain and whether an exact house-hand mapping already exists for each.
- `primitives-exist-once` | 561 Group working discipline | 2026-08-30 | CLAUDE.md | Applies to every Node builtin call site this operation finds a mapping id for. | A call site with a non-null mappingId is evidence the tree still hand-rolls a primitive the registry already owns once.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation, its import.meta.main guard, and downstream package-birth assays. | The package uses one executable ESM operation source file that is eligible for downstream staged package-birth assays.
- `typescript-compiler-api` | TypeScript | 5.9.3 | https://github.com/microsoft/TypeScript/wiki/Architectural-Overview | Applies to the AST parse and traversal used to find import declarations and call expressions. | The 5.9.3 pin is fixed because the classic Compiler API surface this operation calls (`ts.createSourceFile`, `ts.forEachChild`, node type guards) is dropped starting with TypeScript 7.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/read-node-builtin-usage-service","packageVersion":"0.1.1","license":"MIT","dependencies":{"typescript":"5.9.3"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/read-node-builtin-usage.mjs
#!/usr/bin/env node
import ts from "typescript";

const PATH_PATTERN = /(^|\/)scripts\/[a-z][a-z0-9-]*\.mjs$/u;

// Mirrors the mapping ids in the 2026-09-04 node-builtin-to-house-hand mapping record; a builtin.importedName pair absent here has no exact house-hand mapping yet.
const MAPPING_TABLE = Object.freeze({
  "node:path.resolve": "map-path-resolve",
  "node:url.fileURLToPath": "map-url-file-url-to-path",
  "node:fs/promises.readFile": "map-fs-promises-read-file",
  "node:fs/promises.writeFile": "map-fs-promises-write-file",
  "node:fs/promises.mkdir": "map-fs-promises-mkdir",
  "node:fs/promises.rm": "map-fs-promises-rm",
  "node:fs/promises.stat": "map-fs-promises-stat",
  "node:path.relative": "map-path-relative",
  "node:path.isAbsolute": "map-path-is-absolute",
  "node:path.extname": "map-path-extname",
  "node:fs.readFileSync": "map-fs-read-file-sync",
  "node:fs.writeFileSync": "map-fs-write-file-sync",
  "node:fs.mkdirSync": "map-fs-mkdir-sync",
  "node:fs.statSync": "map-fs-stat-sync",
  "node:fs.rmSync": "map-fs-rm-sync",
  "node:path.dirname": "gap-path-dirname",
  "node:path.join": "gap-path-join",
  "node:url.pathToFileURL": "gap-url-path-to-file-url",
  "node:fs.existsSync": "gap-fs-exists-sync",
  "node:util.parseArgs": "gap-util-parse-args",
  "node:crypto.createHash": "gap-crypto-create-hash",
  "node:fs.readdirSync": "gap-fs-readdir-sync",
  "node:fs.realpathSync": "gap-fs-realpath-sync",
  "node:crypto.randomUUID": "gap-crypto-random-uuid",
  "node:path.basename": "gap-path-basename",
  "node:os.tmpdir": "gap-os-tmpdir",
  "node:fs/promises.readdir": "gap-fs-promises-readdir",
  "node:fs/promises.cp": "gap-fs-promises-cp",
  "node:fs/promises.mkdtemp": "gap-fs-promises-mkdtemp",
  "node:fs/promises.rename": "gap-fs-promises-rename",
  "node:util.promisify": "gap-util-promisify",
  "node:http.createServer": "gap-http-create-server",
  "node:fs/promises.lstat": "gap-fs-promises-lstat",
  "node:fs.mkdtempSync": "gap-fs-mkdtemp-sync",
  "node:fs.renameSync": "gap-fs-rename-sync",
  "node:crypto.randomBytes": "gap-crypto-random-bytes",
  "node:fs/promises.access": "gap-fs-promises-access",
  "node:fs/promises.realpath": "gap-fs-promises-realpath",
  "node:readline.createInterface": "gap-readline-create-interface",
  "node:os.homedir": "gap-os-homedir",
  "node:fs/promises.chmod": "gap-fs-promises-chmod",
  "node:fs.lstatSync": "gap-fs-lstat-sync",
  "node:fs.createWriteStream": "gap-fs-create-write-stream",
  "node:fs/promises.unlink": "gap-fs-promises-unlink",
  "node:module.createRequire": "gap-module-create-require",
  "node:module.stripTypeScriptTypes": "gap-module-strip-typescript-types",
  "node:fs.createReadStream": "gap-fs-create-read-stream",
  "node:fs.constants": "gap-fs-constants",
  "node:fs/promises.open": "gap-fs-promises-open",
  "node:fs/promises.appendFile": "gap-fs-promises-append-file",
  "node:fs.closeSync": "gap-fs-close-sync",
  "node:fs.openSync": "gap-fs-open-sync",
  "node:fs.readSync": "gap-fs-read-sync",
  "node:fs.accessSync": "gap-fs-access-sync",
  "node:timers/promises.setTimeout": "gap-timers-promises-set-timeout",
  "node:fs/promises.copyFile": "gap-fs-promises-copy-file",
  "node:module.builtinModules": "gap-module-builtin-modules",
  "node:fs.unlinkSync": "gap-fs-unlink-sync",
  "node:path.normalize": "gap-path-normalize",
  "node:fs/promises.glob": "gap-fs-promises-glob",
  "node:sqlite.DatabaseSync": "gap-sqlite-database-sync",
  "node:path.parse": "gap-path-parse",
  "node:path.posix": "gap-path-posix",
  "node:fs.copyFileSync": "gap-fs-copy-file-sync",
  "node:net.createConnection": "gap-net-create-connection",
  "node:net.createServer": "gap-net-create-server",
  "node:fs/promises.opendir": "gap-fs-promises-opendir",
  "node:fs.cpSync": "gap-fs-cp-sync",
  "node:zlib.gunzipSync": "gap-zlib-gunzip-sync",
  "node:net.isIP": "gap-net-is-ip",
  "node:crypto.createPrivateKey": "gap-crypto-create-private-key",
  "node:crypto.sign": "gap-crypto-sign",
  "node:events.once": "gap-events-once",
  "node:child_process.spawn": "map-child-process-spawn",
  "node:child_process.spawnSync": "map-child-process-spawn-sync",
  "node:child_process.execFileSync": "map-child-process-exec-file-sync",
});

function collectNodeBuiltinImports(statements, source) {
  const named = new Map();
  const namespaceLike = new Map();
  const imports = [];
  for (const statement of statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const builtin = statement.moduleSpecifier.text;
    if (!builtin.startsWith("node:")) continue;
    const line = source.getLineAndCharacterOfPosition(statement.getStart(source, true)).line + 1;
    const record = { line, builtin, names: [], default: null, namespace: null };
    const clause = statement.importClause;
    if (clause) {
      if (clause.name) {
        record.default = clause.name.text;
        namespaceLike.set(clause.name.text, builtin);
      }
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        record.namespace = bindings.name.text;
        namespaceLike.set(bindings.name.text, builtin);
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const localName = element.name.text;
          const importedName = element.propertyName ? element.propertyName.text : element.name.text;
          record.names.push(localName);
          named.set(localName, { builtin, importedName });
        }
      }
    }
    imports.push(record);
  }
  return { imports, named, namespaceLike };
}

function isAwaited(node) {
  return node.parent !== undefined && ts.isAwaitExpression(node.parent);
}

function resolveCallee(node, named, namespaceLike) {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) {
    const resolved = named.get(expression.text);
    if (resolved) return resolved;
    return null;
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && ts.isIdentifier(expression.name)) {
    const builtin = namespaceLike.get(expression.expression.text);
    if (builtin === undefined) return null;
    return { builtin, importedName: expression.name.text };
  }
  return null;
}

function collectCallSites(source, named, namespaceLike) {
  const callSites = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const resolved = resolveCallee(node, named, namespaceLike);
      if (resolved !== null) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source, true)).line + 1;
        const mappingId = MAPPING_TABLE[`${resolved.builtin}.${resolved.importedName}`] ?? null;
        callSites.push({
          line,
          builtin: resolved.builtin,
          importedName: resolved.importedName,
          form: node.getText(source),
          awaited: isAwaited(node),
          mappingId,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return callSites;
}

/**
 * Reads one JavaScript ESM script's source into a NodeBuiltinUsageReading record: every node: import specifier it declares, and every call site of an imported Node built-in with its line, exact form, whether it is awaited, and the node-builtin-to-house-hand mapping id it matches, or null when no exact mapping is known yet — a pure AST reading with no filesystem access.
 * @param {object} request A record with `text` (the complete JavaScript ESM source of one script) and `path` (its scripts/<name>.mjs path, at any depth).
 * @returns {object} A NodeBuiltinUsageReading record: type, version, path, imports, callSites, count.
 * @throws {TypeError} When text is not a string, or path does not end in scripts/<name>.mjs.
 * @throws {SyntaxError} When the carried JavaScript does not parse (propagated from the TypeScript source-file parse).
 */
export function readNodeBuiltinUsage(request) {
  if (typeof request?.text !== "string") throw new TypeError("text must be a string");
  if (typeof request?.path !== "string" || !PATH_PATTERN.test(request.path)) {
    throw new TypeError("path must end in scripts/<name>.mjs");
  }
  const { text, path } = request;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const statements = [...source.statements];
  const { imports, named, namespaceLike } = collectNodeBuiltinImports(statements, source);
  const callSites = collectCallSites(source, named, namespaceLike);
  return {
    type: "NodeBuiltinUsageReading",
    version: 1,
    path,
    imports,
    callSites,
    count: callSites.length,
  };
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "readNodeBuiltinUsage — Reads one JavaScript ESM script's source into a NodeBuiltinUsageReading record: every node: import specifier it declares, and every call site of an imported Node built-in with its line, exact form, whether it is awaited, and the node-builtin-to-house-hand mapping id it matches, or null when no exact mapping is known yet — a pure AST reading with no filesystem access.\n",
    );
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.length > 0) process.stdout.write(`${JSON.stringify(readNodeBuiltinUsage(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/read-node-builtin-usage.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readNodeBuiltinUsage } from "../scripts/read-node-builtin-usage.mjs";

test("lists a node: import declaration with its bindings", () => {
  const reading = readNodeBuiltinUsage({ path: "scripts/x.mjs", text: "import { readFileSync } from \"node:fs\";\n" });
  assert.deepEqual(reading.imports, [{ line: 1, builtin: "node:fs", names: ["readFileSync"], default: null, namespace: null }]);
});

test("finds a named-import call site with its line, form, and mapping id", () => {
  const reading = readNodeBuiltinUsage({ path: "scripts/x.mjs", text: "import { readFileSync } from \"node:fs\";\nconst t = readFileSync(\"/x\", \"utf8\");\n" });
  assert.deepEqual(reading.callSites, [{ line: 2, builtin: "node:fs", importedName: "readFileSync", form: "readFileSync(\"/x\", \"utf8\")", awaited: false, mappingId: "map-fs-read-file-sync" }]);
  assert.equal(reading.count, 1);
});

test("finds a namespace-import property-access call site and records awaited", () => {
  const reading = readNodeBuiltinUsage({ path: "scripts/x.mjs", text: "import * as fsp from \"node:fs/promises\";\nexport async function f() { return await fsp.readFile(\"/x\", \"utf8\"); }\n" });
  assert.equal(reading.callSites[0].builtin, "node:fs/promises");
  assert.equal(reading.callSites[0].importedName, "readFile");
  assert.equal(reading.callSites[0].awaited, true);
  assert.equal(reading.callSites[0].mappingId, "map-fs-promises-read-file");
});

test("reports a gap mapping id for a builtin with no house hand", () => {
  const reading = readNodeBuiltinUsage({ path: "scripts/x.mjs", text: "import { dirname } from \"node:path\";\nconst d = dirname(\"/a/b\");\n" });
  assert.equal(reading.callSites[0].mappingId, "gap-path-dirname");
});

test("reports null for a builtin.importedName pair absent from the table", () => {
  const reading = readNodeBuiltinUsage({ path: "scripts/x.mjs", text: "import { Worker } from \"node:worker_threads\";\nnew Worker(\"/x\");\nWorker(\"/x\");\n" });
  const site = reading.callSites.find((c) => c.importedName === "Worker");
  assert.equal(site.mappingId, null);
});

test("refuses a missing text", () => assert.throws(() => readNodeBuiltinUsage({ path: "scripts/x.mjs" }), /text must be a string/u));

test("refuses a path not ending in scripts/<name>.mjs", () => assert.throws(() => readNodeBuiltinUsage({ path: "lib/x.mjs", text: "" }), /path must end in/u));
```
## Examples
```json name="finds a mapped call site"
{"input":{"path":"scripts/x.mjs","text":"import { readFileSync } from \"node:fs\";\nconst t = readFileSync(\"/x\", \"utf8\");\n"},"output":{"type":"NodeBuiltinUsageReading","version":1,"path":"scripts/x.mjs","imports":[{"line":1,"builtin":"node:fs","names":["readFileSync"],"default":null,"namespace":null}],"callSites":[{"line":2,"builtin":"node:fs","importedName":"readFileSync","form":"readFileSync(\"/x\", \"utf8\")","awaited":false,"mappingId":"map-fs-read-file-sync"}],"count":1}}
```
## Traceability
- `import-specifiers-listed` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`, `typescript-compiler-api`
- `call-sites-with-line-and-form` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`, `typescript-compiler-api`
- `mapping-id-or-null` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `fabricate-do-not-hand-write`, `primitives-exist-once`
- `awaited-flag` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `pure-reading` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `missing-text-or-path-refusal` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `no-mapping-invention` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `fabricate-do-not-hand-write`, `primitives-exist-once`
