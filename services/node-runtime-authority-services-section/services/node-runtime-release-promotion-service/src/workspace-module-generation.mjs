import {isAbsolute,resolve,relative} from 'node:path';

const canonical=path=>typeof path==='string'&&path&&!isAbsolute(path)&&!/[\\\0]/u.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..');
/** The authored module supplies source bytes; Code alone writes declared products.
 * This is a module contract, never a shell/build-script selection. */
export function workspaceModuleGenerationContract({root,manifest}){
  const declaration=manifest.nodeRuntimeGeneration;
  if(declaration===undefined)return null;
  if(!declaration||typeof declaration!=='object'||Array.isArray(declaration)||Object.keys(declaration).sort().join(',')!=='export,module,outputs'
    ||!canonical(declaration.module)||!/\.[cm]?js$/u.test(declaration.module)||typeof declaration.export!=='string'||!/^[A-Za-z_$][\w$]*$/u.test(declaration.export)
    ||!Array.isArray(declaration.outputs)||!declaration.outputs.length||declaration.outputs.some(path=>!canonical(path))||new Set(declaration.outputs).size!==declaration.outputs.length)
    throw new TypeError('invalid source-owned module generation contract');
  const module=resolve(root,declaration.module),outputs=declaration.outputs.map(path=>resolve(root,path));
  for(const file of [module,...outputs]){const offset=relative(root,file);if(isAbsolute(offset)||offset==='..'||offset.startsWith('../'))throw new TypeError('module generation escapes its package owner');}
  if(outputs.includes(module))throw new TypeError('module generation cannot replace its programme');
  return {module,export:declaration.export,outputs,declaration};
}

/** Order native producers through the existing source-interface graph. Ordinary
 * authored module cycles terminate in the visited set; a cycle between missing
 * generated products has no executable predecessor and refuses before writes.
 */
export function workspaceGenerationOrder(providers,assessment){
  const owners=new Map(),byId=new Map(),edges=new Map();
  for(const provider of providers){
    if(byId.has(provider.id))throw new TypeError('generation repeats a producer');
    byId.set(provider.id,provider);
    for(const output of provider.outputs){
      if(owners.has(output))throw new TypeError('generation producers declare conflicting products');
      owners.set(output,provider.id);
    }
  }
  for(const edge of assessment.moduleGraph){
    const rows=edges.get(edge.file)??[];rows.push(edge);edges.set(edge.file,rows);
  }
  const dependencies=new Map();
  for(const provider of providers){
    const required=new Set(),visited=new Set();
    function visit(file){
      const owner=owners.get(file);
      if(owner!==undefined){required.add(owner);return;}
      if(visited.has(file))return;visited.add(file);
      const missing=assessment.missing.find(item=>item.file===file||item.path===file);
      if(missing)throw new TypeError('generation prerequisite source interface is absent: '+file+' '+missing.reason);
      const refusal=assessment.unreceived.find(item=>item.file===file&&item.reason==='source-parser-refusal');
      if(refusal)throw new TypeError('generation programme has an unresolved source interface: '+file+' '+refusal.reason);
      for(const edge of edges.get(file)??[])if(edge.target?.file)visit(edge.target.file);
    }
    for(const input of provider.inputs)visit(input);
    dependencies.set(provider.id,[...required].sort());
  }
  const active=new Set(),done=new Set(),order=[];
  function receive(id){
    if(done.has(id))return;
    if(active.has(id))throw new TypeError('cyclic generated-product prerequisite: '+[...active,id].join(' -> '));
    active.add(id);
    for(const prerequisite of dependencies.get(id))receive(prerequisite);
    active.delete(id);done.add(id);order.push({provider:byId.get(id),requires:dependencies.get(id)});
  }
  for(const id of [...byId.keys()].sort())receive(id);
  return order;
}
