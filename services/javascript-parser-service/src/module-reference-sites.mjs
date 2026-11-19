import { bindJavaScript, walkJavaScript } from "./javascript-parser.mjs";

/**
 * Read module-request sites from an admitted ESTree Program without executing it.
 * Each frozen site carries its owning AST node, request kind, string specifier
 * (or null for a computed expression), and exact quoted-literal UTF-16 start/end
 * offsets (or null). The AST is borrowed, not cloned or frozen.
 *
 * Recognizes static imports/reexports, dynamic imports, unbound require, and
 * direct calls through const loaders created by a named node:module/module
 * createRequire import with import.meta.url. Factory/loader aliases are resolved
 * by lexical binding identity, not spelling. Other loader constructions and
 * mutable method properties (including .resolve) are outside this profile.
 * This is syntax/binding evidence, not dependency resolution, execution timing,
 * optional-dependency policy or authority to edit source.
 */
export function readJavaScriptModuleRequestSites(program) {
  const { references } = bindJavaScript(program);
  const binding = node => node?.type === "Identifier" ? references.get(node) : undefined;
  const property = node => node?.type === "MemberExpression"
    ? (!node.computed ? node.property.name : node.property.type === "Literal" ? node.property.value : null) : null;
  const isModuleUrl = node => property(node) === "url" && node.object?.type === "MetaProperty"
    && node.object.meta.name === "import" && node.object.property.name === "meta";
  const creators = new Set(), loaders = new Set();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || !["node:module", "module"].includes(statement.source.value)) continue;
    for (const item of statement.specifiers) {
      if (item.type === "ImportSpecifier" && (item.imported.name ?? item.imported.value) === "createRequire") creators.add(binding(item.local));
    }
  }
  walkJavaScript(program, (node, parent) => {
    if (node.type !== "VariableDeclarator" || parent?.kind !== "const" || node.id.type !== "Identifier" || node.init?.type !== "CallExpression") return;
    const { callee, arguments: args } = node.init;
    if (creators.has(binding(callee)) && args.length === 1 && isModuleUrl(args[0])) loaders.add(binding(node.id));
  });
  const isRequire = callee => callee.type === "Identifier"
    && ((callee.name === "require" && binding(callee) === null) || loaders.has(binding(callee)));
  const sites = [];
  const add = (node, kind, request) => {
    const literal = request?.type === "Literal" && typeof request.value === "string";
    sites.push(Object.freeze({ node, kind, specifier: literal ? request.value : null,
      start: literal ? request.start : null, end: literal ? request.end : null }));
  };
  walkJavaScript(program, node => {
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) && node.source) add(node, "import", node.source);
    else if (node.type === "ImportExpression") add(node, "dynamic-import", node.source);
    else if (node.type === "CallExpression" && isRequire(node.callee) && node.arguments.length) add(node, "require", node.arguments[0]);
  });
  return Object.freeze(sites);
}
