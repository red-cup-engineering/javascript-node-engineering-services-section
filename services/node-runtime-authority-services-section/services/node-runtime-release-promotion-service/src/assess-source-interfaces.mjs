import assert from "node:assert/strict";
import ts from "typescript";
import { workspaceTypeScriptOutputContract } from "./generate-workspace-typescript.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { indexModuleCorpus, readImports } from "@red-cup-engineering/javascript-computer";
import { jsdocOf } from "@red-cup-engineering/javascript-node-services-section/javascript-parser";
import { javascriptSourceResolver } from "@red-cup-engineering/javascript-node-services-section/module-closure";
import { declaredNodeRuntimeEntries } from "./source-entrances.mjs";
import { receiveSelectedSources } from "./install-workspace-selection.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const blob = bytes => createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
const contained = (root, file) => { const path = relative(root, file); return !isAbsolute(path) && path !== ".." && !path.startsWith(".." + sep); };
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();

/** Assess exact authored workspace interfaces before application installation.
 * Uses the house module resolver and module corpus; it neither executes an
 * application nor treats unknown registry/generated interfaces as admitted.
 * Declared JSDoc/parameters are evidence for design review, not inferred
 * guarantees of execution, resource consumption or scientific correctness.
 */
export async function assessSourceInterfaces({ workspace, commit, importerIds, entries = [], environment = process.env } = {}) {
  if (!Array.isArray(entries) || entries.some(entry => typeof entry !== "string" || !entry)) throw new TypeError("explicit source programmes require nonempty paths");
  const root = realpathSync(resolve(workspace));
  assert.equal(realpathSync(git(root, "rev-parse", "--show-toplevel")), root);
  assert.equal(git(root, "rev-parse", "HEAD^{commit}"), commit);
  if (!Array.isArray(importerIds) || !importerIds.length || new Set(importerIds).size !== importerIds.length) throw new TypeError("source assessment requires distinct selected importer paths");
  const mounts = await receiveSelectedSources({ root, importerIds, environment });
  const repositories = [{ path: ".", revision: commit }, ...mounts].map(item => ({ ...item, root: resolve(root, item.path) })).sort((a, b) => b.root.length - a.root.length);
  const trees = new Map();
  for (const owner of repositories) {
    const rows = execFileSync("git", ["-C", owner.root, "ls-tree", "-r", "-z", owner.revision], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean);
    trees.set(owner.root, new Map(rows.map(row => { const [head, path] = row.split("\t"); const [mode, kind, identity] = head.split(" "); return [path, { mode, kind, identity }]; })));
  }
  const sources = new Map();
  function confine(file) {
    file = resolve(file);
    if (!contained(root, file)) throw new TypeError("source interface escapes selected checkout: " + file);
    let current = root;
    for (const part of relative(root, file).split(sep)) {
      current = join(current, part);
      try { if (lstatSync(current).isSymbolicLink()) throw new TypeError("source interface follows a link: " + current); }
      catch (error) { if (error.code === "ENOENT") break; throw error; }
    }
    return file;
  }
  function source(file) {
    file = confine(file);
    const owner = repositories.find(item => contained(item.root, file));
    const path = relative(owner.root, file).split(sep).join("/");
    const fact = trees.get(owner.root).get(path);
    if (!fact || fact.kind !== "blob" || !["100644", "100755"].includes(fact.mode)) throw new TypeError("interface is not a committed regular source: " + file);
    const bytes = readFileSync(file);
    assert.equal(blob(bytes), fact.identity, "interface bytes differ from exact Git source: " + file);
    sources.set(file, { path: relative(root, file), sourceRepository: owner.path, sourceCommit: owner.revision, gitBlob: fact.identity, sha256: hash(bytes) });
    return bytes.toString("utf8");
  }
  const packages = importerIds.map(id => {
    const directory = resolve(root, id);
    return { root: directory, manifest: JSON.parse(source(join(directory, "package.json"))) };
  });
  const declaredOutputs = new Map();
  for (const item of packages) {
    const contract = workspaceTypeScriptOutputContract({ root: item.root, manifest: item.manifest, compiler: ts, readSource: source });
    if (!contract) continue;
    for (const output of contract.outputs) { source(output.input); declaredOutputs.set(output.output, { package: item.manifest.name, configuration: contract.configuration, input: output.input }); }
  }
  const generatedOwner = file => declaredOutputs.has(resolve(file));
  const resolveSource = javascriptSourceResolver(packages);
  const packageNames = new Set(packages.map(item => item.manifest.name));
  const pending = [...entries.map(file => resolve(root, file))], missing = [], unreceived = [], bindings = [], files = [], imports = new Map(), edges = new Map();
  for (const item of packages) {
    const observed = declaredNodeRuntimeEntries(item.root, item.manifest);
    for (const carrier of [...observed.entries, ...observed.missing.map(item => item.path)]) confine(carrier);
    pending.push(...observed.entries);
    for (const carrier of observed.missing) (generatedOwner(carrier.path) ? unreceived : missing).push({ package: item.manifest.name, ...carrier, reason: generatedOwner(carrier.path) ? "published-carrier-requires-native-generation" : "absent-published-carrier" });
  }
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    confine(file);
    // An old output's presence does not turn a compiler product into authored
    // source. Its exact config/input mapping remains an obligation to generate.
    if (generatedOwner(file)) { unreceived.push({ file, reason: "published-carrier-requires-native-generation" }); continue; }
    const content = source(file);
    if (!/\.[cm]?js$/u.test(file)) { unreceived.push({ file, reason: "non-JavaScript-interface-requires-native-receiver" }); continue; }
    let demand;
    try { demand = readImports(content); }
    catch (error) { unreceived.push({ file, reason: "source-parser-refusal", message: error.message }); continue; }
    files.push({ absolutePath: file, content }); imports.set(file, demand);
    for (const input of demand) {
      if (input.specifier === undefined) { unreceived.push({ file, reason: "computed-dynamic-interface" }); continue; }
      const target = resolveSource(input.specifier, file);
      if (target?.file) confine(target.file);
      edges.set(file + "\0" + input.specifier, target);
      if (target?.file && generatedOwner(target.file)) unreceived.push({ file, specifier: input.specifier, target: target.file, reason: "interface-target-requires-native-generation" });
      else if (target?.file && existsSync(target.file)) pending.push(target.file);
      else if (target?.file) (generatedOwner(target.file) ? unreceived : missing).push({ file, specifier: input.specifier, target: target.file, reason: generatedOwner(target.file) ? "interface-target-requires-native-generation" : "absent-interface-target" });
      else if (target?.external) {
        const name = input.specifier.startsWith("@") ? input.specifier.split("/").slice(0, 2).join("/") : input.specifier.split("/")[0];
        if (input.specifier.startsWith(".") || input.specifier.startsWith("#") || packageNames.has(name)) missing.push({ file, ...input, reason: target.external });
        else unreceived.push({ file, ...input, reason: "registry-interface-not-installed" });
      }
    }
  }
  const corpus = indexModuleCorpus({ files, resolve: (specifier, fromFile) => edges.get(fromFile + "\0" + specifier)?.file });
  function openReexport(file, seen = new Set()) {
    if (seen.has(file)) return false;
    seen.add(file);
    if (!corpus.modules.has(file)) return true;
    const body = corpus.modules.get(file).program.body;
    const importedLocals = new Map(body.filter(node => node.type === "ImportDeclaration")
      .flatMap(node => node.specifiers.map(specifier => [specifier.local.name, node.source.value])));
    for (const node of body) {
      // `import {X} from vendor; export {X}` is a re-export too. Without
      // receiving the vendor, an unresolved declaration is unknown, not absent.
      const locals = node.type === "ExportNamedDeclaration" && !node.source
        ? node.specifiers.map(specifier => specifier.local.name)
        : node.type === "ExportDefaultDeclaration" && node.declaration.type === "Identifier"
          ? [node.declaration.name] : [];
      for (const local of locals) if (importedLocals.has(local)) {
        const target = edges.get(file + "\0" + importedLocals.get(local));
        if (!target?.file || openReexport(target.file, seen)) return true;
      }
      if (!["ExportAllDeclaration", "ExportNamedDeclaration"].includes(node.type) || !node.source) continue;
      const target = edges.get(file + "\0" + node.source.value);
      if (!target?.file || openReexport(target.file, seen)) return true;
    }
    return false;
  }
  for (const [file, demand] of imports) for (const input of demand) {
    const target = edges.get(file + "\0" + input.specifier);
    if (!target?.file || generatedOwner(target.file) || !existsSync(target.file) || !["named", "default"].includes(input.mode)) continue;
    const declarations = corpus.exportedDeclarations(target.file, input.name);
    if (!declarations.length) {
      const finding = { file, ...input, target: target.file };
      if (openReexport(target.file)) unreceived.push({ ...finding, reason: "binding-depends-on-unreceived-interface" });
      else missing.push({ ...finding, reason: "absent-exported-binding" });
    } else bindings.push({ file, ...input, target: target.file, declarations: declarations.map(node => ({ file: corpus.moduleOf(node)?.fileName, line: corpus.lineOf(node), kind: node.type, name: corpus.declarationName(node), sourceStart: node.start, sourceEnd: node.end, parameters: (node.params ?? node.body?.body?.find(method => method.kind === "constructor")?.value?.params)?.map(parameter => corpus.moduleOf(parameter)?.text.slice(parameter.start, parameter.end)), declaredDocumentation: jsdocOf(corpus.moduleOf(node).program, corpus.parentOf(node)?.type?.startsWith("Export") ? corpus.parentOf(node) : node)?.value, contract: corpus.contractOf(node) })) });
  }
  const repeatedMounts = await receiveSelectedSources({ root, importerIds, environment });
  assert.deepEqual(repeatedMounts, mounts, "selected source mounts changed during assessment");
  assert.equal(git(root, "rev-parse", "HEAD^{commit}"), commit);
  // Re-read all admitted bytes, including manifests, before returning source evidence.
  for (const file of [...sources.keys()]) source(file);
  return { type: "NodeRuntimeSourceInterfaceAssessment", version: 1, status: missing.length ? "refused" : "assessed", workspace: root, commit, importerIds,
    applicationExecuted: false, applicationInstalled: false, interfaceAdmissionComplete: !missing.length && !unreceived.length,
    sourceMounts: mounts, generationContracts: [...declaredOutputs].map(([output, contract]) => ({ output, ...contract })), sources: [...sources.values()], entries: [...new Set([...entries, ...packages.flatMap(item => declaredNodeRuntimeEntries(item.root, item.manifest).entries)])],
    moduleGraph: [...edges].map(([key, target]) => { const [file, specifier] = key.split("\0"); return { file, specifier, target }; }), bindings, missing, unreceived };
}
