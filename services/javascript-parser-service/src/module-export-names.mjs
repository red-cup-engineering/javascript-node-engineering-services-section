/** Project locally enumerable export names from an already parsed ECMAScript
 * Program. Unresolved star exports remain explicit; no source is executed. */
export function readJavaScriptModuleExportNames(program) {
  const names = new Set();
  let hasStarExport = false;
  const name = node => node.name ?? node.value;
  function pattern(node) {
    if (!node) return;
    if (node.type === "Identifier") names.add(node.name);
    else if (node.type === "RestElement") pattern(node.argument);
    else if (node.type === "AssignmentPattern") pattern(node.left);
    else if (node.type === "ArrayPattern") node.elements.forEach(pattern);
    else if (node.type === "ObjectPattern") node.properties.forEach(item => pattern(item.type === "RestElement" ? item.argument : item.value));
  }
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") names.add("default");
    else if (statement.type === "ExportAllDeclaration") {
      if (statement.exported) names.add(name(statement.exported)); else hasStarExport = true;
    } else if (statement.type === "ExportNamedDeclaration") {
      const declaration = statement.declaration;
      if (declaration?.type === "VariableDeclaration") declaration.declarations.forEach(item => pattern(item.id));
      else if (declaration?.id) names.add(declaration.id.name);
      for (const item of statement.specifiers) names.add(name(item.exported));
    }
  }
  return Object.freeze({ names: Object.freeze([...names]), hasStarExport });
}

