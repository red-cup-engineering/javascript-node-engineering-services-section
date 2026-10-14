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
