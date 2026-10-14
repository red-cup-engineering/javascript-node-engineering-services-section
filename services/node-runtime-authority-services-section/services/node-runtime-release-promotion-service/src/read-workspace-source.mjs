import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {receiveSelectedSources} from './install-workspace-selection.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const contained=(root,file)=>{const path=relative(root,file);return !isAbsolute(path)&&path!=='..'&&!path.startsWith('..'+sep);};
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();

/** Exact Git-source reading shared by interface assessment and source producers. */
export async function workspaceSourceReader({workspace,commit,importerIds,environment=process.env}){
  const root=realpathSync(resolve(workspace));
  assert.equal(realpathSync(git(root,'rev-parse','--show-toplevel')),root);
  assert.equal(git(root,'rev-parse','HEAD^{commit}'),commit);
  if(!Array.isArray(importerIds)||!importerIds.length||new Set(importerIds).size!==importerIds.length)throw new TypeError('source reading requires distinct selected importer paths');
  const mounts=await receiveSelectedSources({root,importerIds,environment});
  const repositories=[{path:'.',revision:commit},...mounts].map(item=>({...item,root:resolve(root,item.path)})).sort((a,b)=>b.root.length-a.root.length),trees=new Map(),sources=new Map();
  for(const owner of repositories){
    const rows=execFileSync('git',['-C',owner.root,'ls-tree','-r','-z',owner.revision],{encoding:'utf8',maxBuffer:32*1024*1024}).split('\0').filter(Boolean);
    trees.set(owner.root,new Map(rows.map(row=>{const [head,path]=row.split('\t'),[mode,kind,identity]=head.split(' ');return [path,{mode,kind,identity}];})));
  }
  function confine(file){
    file=resolve(file);
    if(!contained(root,file))throw new TypeError('source interface escapes selected checkout: '+file);
    let current=root;
    for(const part of relative(root,file).split(sep)){
      current=join(current,part);
      try{if(lstatSync(current).isSymbolicLink())throw new TypeError('source interface follows a link: '+current);}
      catch(error){if(error.code==='ENOENT')break;throw error;}
    }
    return file;
  }
  function object(file){
    file=confine(file);
    const owner=repositories.find(item=>contained(item.root,file)),path=relative(owner.root,file).split(sep).join('/'),fact=trees.get(owner.root).get(path);
    return fact?{path:relative(root,file).split(sep).join('/'),sourceRepository:owner.path,sourceCommit:owner.revision,sourcePath:path,...fact}:null;
  }
  function uncommittedOutput(file){
    const fact=object(file);
    if(fact)throw new TypeError('source emission would overwrite a committed object: '+JSON.stringify(fact));
    return confine(file);
  }
  function bytes(file){
    file=confine(file);
    const fact=object(file);
    if(!fact||fact.kind!=='blob'||!['100644','100755'].includes(fact.mode))throw new TypeError('interface is not a committed regular source: '+file);
    const body=readFileSync(file);
    assert.equal(blob(body),fact.identity,'interface bytes differ from exact Git source: '+file);
    sources.set(file,{path:relative(root,file).split(sep).join('/'),sourceRepository:fact.sourceRepository,sourceCommit:fact.sourceCommit,gitBlob:fact.identity,sha256:hash(body)});
    return body;
  }
  const source=file=>new TextDecoder('utf-8',{fatal:true}).decode(bytes(file));
  async function verify(){
    assert.deepEqual(await receiveSelectedSources({root,importerIds,environment}),mounts,'selected source mounts changed during reading');
    assert.equal(git(root,'rev-parse','HEAD^{commit}'),commit);
    for(const file of [...sources.keys()])bytes(file);
  }
  return {root,mounts,sources,confine,object,uncommittedOutput,bytes,source,verify};
}
