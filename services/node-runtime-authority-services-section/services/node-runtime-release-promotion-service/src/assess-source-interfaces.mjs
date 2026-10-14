import ts from "typescript";
import { workspaceTypeScriptOutputContract } from "./generate-workspace-typescript.mjs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { indexModuleCorpus, readImports } from "@red-cup-engineering/javascript-computer";
import { jsdocOf } from "@red-cup-engineering/javascript-node-services-section/javascript-parser";
import { javascriptSourceResolver } from "@red-cup-engineering/javascript-node-services-section/module-closure";
import { declaredNodeRuntimeEntries } from "./source-entrances.mjs";
import { workspaceSourceReader } from "./read-workspace-source.mjs";
import { workspaceModuleGenerationContract } from "./workspace-module-generation.mjs";

/** Assess exact authored workspace interfaces before application installation.
 * Uses the house module resolver and module corpus; it neither executes an
 * application nor treats unknown registry/generated interfaces as admitted.
 * Declared JSDoc/parameters are evidence for design review, not inferred
 * guarantees of execution, resource consumption or scientific correctness.
 */
export async function assessSourceInterfaces({ workspace, commit, importerIds, entries = [], environment = process.env } = {}) {
  if (!Array.isArray(entries) || entries.some(entry => typeof entry !== "string" || !entry)) throw new TypeError("explicit source programmes require nonempty paths");
  const reader = await workspaceSourceReader({ workspace, commit, importerIds, environment });
  const { root, mounts, sources, confine, source } = reader;
  const packages = importerIds.map(id => {
    const directory = resolve(root, id);
    return { root: directory, manifest: JSON.parse(source(join(directory, "package.json"))) };
  });
  const declaredOutputs = new Map();
  for (const item of packages) {
    const contract = workspaceTypeScriptOutputContract({ root: item.root, manifest: item.manifest, compiler: ts, readSource: source });
    if (!contract) continue;
    for (const output of contract.outputs) { source(output.input); reader.uncommittedOutput(output.output); declaredOutputs.set(output.output, { package: item.manifest.name, configuration: contract.configuration, input: output.input }); }
  }
  const moduleContracts = [];
  for (const item of packages) {
    const contract = workspaceModuleGenerationContract(item);
    if (!contract) continue;
    source(contract.module); moduleContracts.push(contract);
    for (const output of contract.outputs) { reader.uncommittedOutput(output); if (declaredOutputs.has(output)) throw new TypeError("source producers declare conflicting output paths"); declaredOutputs.set(output, { package: item.manifest.name, module: contract.module, export: contract.export }); }
  }
  const generatedOwner = file => declaredOutputs.has(resolve(file));
  const resolveSource = javascriptSourceResolver(packages);
  const packageNames = new Set(packages.map(item => item.manifest.name));
  const pending = [...entries.map(file => resolve(root, file)), ...moduleContracts.map(item => item.module)], missing = [], unreceived = [], bindings = [], files = [], imports = new Map(), edges = new Map();
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
  await reader.verify();
  return { type: "NodeRuntimeSourceInterfaceAssessment", version: 1, status: missing.length ? "refused" : "assessed", workspace: root, commit, importerIds,
    applicationExecuted: false, applicationInstalled: false, interfaceAdmissionComplete: !missing.length && !unreceived.length,
    sourceMounts: mounts, generationContracts: [...declaredOutputs].map(([output, contract]) => ({ output, ...contract })), sources: [...sources.values()], entries: [...new Set([...entries, ...packages.flatMap(item => declaredNodeRuntimeEntries(item.root, item.manifest).entries)])],
    moduleGraph: [...edges].map(([key, target]) => { const [file, specifier] = key.split("\0"); return { file, specifier, target }; }), bindings, missing, unreceived };
}
