// Source-derived extraction of compile-node-runtime.mjs's native PNPM traversal.
// See specifications/packed-package-receiving-provenance.md. Reading only: this
// module never imports package code, discovers tests or executes package scripts.
import assert from 'node:assert/strict';
import {lstatSync,readFileSync,readdirSync,readlinkSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';

export const insidePackedRoot=(root,path)=>{
  const offset=relative(root,path);
  return !isAbsolute(offset)&&offset!=='..'&&!offset.startsWith('..'+sep);
};

// Check every link hop; a link which leaves and re-enters the runtime is refused.
export function packedPath(root,path){
  if(!insidePackedRoot(root,path))throw new TypeError('packed path escapes runtime: '+path);
  let parts=relative(root,path).split(sep).filter(Boolean),current=root,hops=0;
  while(parts.length){
    const next=join(current,parts.shift()),stat=lstatSync(next);
    if(stat.isSymbolicLink()){
      const target=resolve(dirname(next),readlinkSync(next));
      if(++hops>40||!insidePackedRoot(root,target))throw new TypeError('packed link escapes runtime or cycles: '+next);
      parts=[...relative(root,target).split(sep).filter(Boolean),...parts];current=root;
    }else{
      if(parts.length&&!stat.isDirectory())throw new TypeError('packed path parent is not a directory: '+next);
      current=next;
    }
  }
  return current;
}

export function comparePackedManifest(manifest,source){
  for(const field of ['name','version','type','exports','bin','main','files'])
    assert.deepEqual(manifest[field],source[field],'packed declaration differs from workspace source: '+manifest.name+'.'+field);
}

export function readPackedWorkspacePackages(runtimePath){
  const runtime=realpathSync(resolve(runtimePath)),packages=[],seen=new Map();
  if(!lstatSync(runtime).isDirectory())throw new TypeError('packed runtime is not a directory');
  function add(alias,required=false){
    const directory=packedPath(runtime,alias);
    if(!lstatSync(directory).isDirectory())throw new TypeError('packed package is not a directory: '+alias);
    const file=join(directory,'package.json'),stat=lstatSync(file,{throwIfNoEntry:false});
    if(!stat&&!required)return;
    if(!stat?.isFile())throw new TypeError('packed manifest is not a regular file: '+file);
    if(seen.has(directory)){seen.get(directory).aliases.push(alias);return;}
    const bytes=readFileSync(file),manifest=JSON.parse(bytes);
    const item={directory,aliases:[alias],manifest,manifestBytes:bytes};
    seen.set(directory,item);packages.push(item);
  }
  add(runtime,true);
  const modules=join(runtime,'node_modules'),store=join(modules,'.pnpm'),directories=[];
  if(lstatSync(modules,{throwIfNoEntry:false}))directories.push(packedPath(runtime,modules));
  if(lstatSync(store,{throwIfNoEntry:false})){
    const physical=packedPath(runtime,store);
    for(const entry of readdirSync(physical,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(entry.name==='node_modules'||entry.name.startsWith('.'))continue;
      if(!entry.isDirectory()&&!entry.isSymbolicLink())continue;
      const cell=packedPath(runtime,join(physical,entry.name)),nested=join(cell,'node_modules');
      if(lstatSync(nested,{throwIfNoEntry:false}))directories.push(packedPath(runtime,nested));
    }
  }
  for(const directory of [...new Set(directories)]){
    for(const entry of readdirSync(directory).sort()){
      if(entry.startsWith('.')||entry==='node_modules')continue;
      const path=join(directory,entry);
      if(entry.startsWith('@')){
        const scope=packedPath(runtime,path);
        for(const name of readdirSync(scope).sort())add(join(path,name));
      }else add(path);
    }
  }
  return {runtime,packages};
}
