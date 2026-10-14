import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const contained=(root,file)=>{const path=relative(root,file);return !isAbsolute(path)&&path!=='..'&&!path.startsWith('..'+sep);};
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();

// Git owns recursive source acquisition. Reading never fetches, projects,
// repins or materializes a second source graph.
function recursiveSourceMounts(root){
  git(root,'diff','--cached','--quiet','HEAD','--');
  git(root,'diff','--quiet','HEAD','--','.gitmodules');
  const status=git(root,'submodule','status','--recursive');
  if(status.split('\n').some(line=>/^[-+U]/u.test(line)))throw new Error('recursive source is not at its recorded Gitlinks');
  const rows=execFileSync('git',['-C',root,'submodule','foreach','--quiet','--recursive',
    'test "$(git rev-parse HEAD)" = "$sha1" && git diff --cached --quiet HEAD -- && git diff --quiet HEAD -- .gitmodules && printf "%s\\0%s\\0" "$displaypath" "$sha1"'],
    {encoding:'utf8',maxBuffer:32*1024*1024}).split('\0');
  if(rows.pop()!==''||rows.length%2)throw new Error('Git returned an incomplete recursive source inventory');
  const mounts=[];
  for(let index=0;index<rows.length;index+=2){
    const path=rows[index],revision=rows[index+1];
    if(!path||!contained(root,resolve(root,path))||!/^[a-f0-9]{40}$/u.test(revision))throw new Error('Git returned an invalid recursive source owner');
    mounts.push({path,revision});
  }
  return mounts;
}

/** Read PNPM's actual whole workspace. Its root lock and configured registry
 * remain native inputs; no selected lock, source inventory or receipt is written.
 * Call after the owning caller's ordinary frozen PNPM installation. */
export async function readNodeWorkspace({workspace,pnpm='pnpm',filter}={}){
  if(typeof workspace!=='string'||!workspace)throw new TypeError('workspace root is required');
  const root=realpathSync(resolve(workspace));
  assert.equal(realpathSync(git(root,'rev-parse','--show-toplevel')),root,'workspace must be its Git root');
  const commit=git(root,'rev-parse','HEAD^{commit}');
  const reader=await workspaceSourceReader({workspace:root,commit,importerIds:['.'],recursive:true});
  const sourceFiles=['package.json','pnpm-workspace.yaml','pnpm-lock.yaml'];
  for(const path of ['.npmrc','.pnpmfile.cjs','.pnpmfile.mjs'])if(existsSync(join(root,path)))sourceFiles.push(path);
  for(const path of sourceFiles)reader.bytes(join(root,path));
  const manifest=JSON.parse(reader.bytes(join(root,'package.json')));
  const run=args=>execFileSync(pnpm,args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
  const version=run(['--version']);
  assert.equal(manifest.packageManager,'pnpm@'+version,'use the package manager declared by the source owner');
  if(filter!==undefined&&(typeof filter!=='string'||!filter.trim()||filter!==filter.trim()||/[\0\r\n]/u.test(filter)))throw new TypeError('workspace filter must be a nonempty native PNPM selector');
  const projects=JSON.parse(run(['list','--recursive','--depth=-1','--json',...(filter===undefined?[]:['--filter',filter,'--fail-if-no-match'])]));
  if(!Array.isArray(projects))throw new TypeError('PNPM returned no workspace project inventory');
  const importerIds=[...new Set(['.',...projects.map(project=>{
    if(typeof project.path!=='string')throw new TypeError('PNPM project has no source path');
    const path=resolve(project.path);
    if(!contained(root,path)||realpathSync(path)!==path)throw new TypeError('PNPM workspace project leaves its source root');
    return relative(root,path).split(sep).join('/')||'.';
  })])].sort();
  for(const id of importerIds)reader.bytes(join(root,id,'package.json'));
  await reader.verify();
  return {workspace:root,commit,importerIds,reader,...(filter===undefined?{}:{filter})};
}

/** Exact Git-source reading shared by interface assessment and source producers. */
export async function workspaceSourceReader({workspace,commit,importerIds,recursive=false,environment=process.env}){
  const root=realpathSync(resolve(workspace));
  assert.equal(realpathSync(git(root,'rev-parse','--show-toplevel')),root);
  assert.equal(git(root,'rev-parse','HEAD^{commit}'),commit);
  if(!Array.isArray(importerIds)||!importerIds.length||new Set(importerIds).size!==importerIds.length)throw new TypeError('source reading requires distinct workspace importer paths');
  // Existing sparse development assessment remains with its existing owner.
  // Native production never imports or invokes that selected-install path.
  const readMounts=recursive?()=>recursiveSourceMounts(root):async()=>{
    const {receiveSelectedSources}=await import('./install-workspace-selection.mjs');
    return receiveSelectedSources({root,importerIds,environment});
  };
  const mounts=await readMounts();
  const repositories=[{path:'.',revision:commit},...mounts].map(item=>({...item,root:resolve(root,item.path)})).sort((a,b)=>b.root.length-a.root.length),trees=new Map(),sources=new Map();
  for(const owner of repositories){
    const rows=execFileSync('git',['-C',owner.root,'ls-tree','-r','-z',owner.revision],{encoding:'utf8',maxBuffer:32*1024*1024}).split('\0').filter(Boolean);
    trees.set(owner.root,new Map(rows.map(row=>{const [head,path]=row.split('\t'),[mode,kind,identity]=head.split(' ');return [path,{mode,kind,identity}];})));
  }
  function confine(file){
    file=resolve(file);
    if(!contained(root,file))throw new TypeError('source interface escapes source workspace: '+file);
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
    assert.deepEqual(await readMounts(),mounts,'source mounts changed during reading');
    assert.equal(git(root,'rev-parse','HEAD^{commit}'),commit);
    for(const file of [...sources.keys()])bytes(file);
  }
  return {root,mounts,sources,confine,object,uncommittedOutput,bytes,source,verify};
}

