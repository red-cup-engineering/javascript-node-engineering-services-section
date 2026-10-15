import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {receiveSelectedSources,verifyWorkspaceSelection} from '../src/install-workspace-selection.mjs';

const environment={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1'};
const git=(root,...args)=>execFileSync('git',['-C',root,'-c','core.hooksPath=/dev/null',...args],{encoding:'utf8',env:environment,stdio:['ignore','pipe','pipe']}).trim();
const hash=body=>createHash('sha256').update(body).digest('hex');
function write(root,path,body){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body);}
function initialize(root,files){
  mkdirSync(root,{recursive:true});git(root,'init','-q');git(root,'config','user.name','Sparse receiving fixture');git(root,'config','user.email','sparse-receiving@example.invalid');
  for(const [path,body]of Object.entries(files))write(root,path,body);
  git(root,'add','.');git(root,'-c','commit.gpgsign=false','commit','-qm','Authentic sparse receiving source');
  return git(root,'rev-parse','HEAD');
}
const selected='packages/chosen[one]';
function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'workspace-sparse-receiving-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const provider=join(directory,'provider'),root=join(directory,'root');
  const providerCommit=initialize(provider,{
    'package.json':'{"name":"source-owner","version":"1.0.0"}\n',
    '.gitattributes':'*.mjs text eol=lf\n',
    'packages/.gitattributes':'*.json text eol=lf\n',
    [selected+'/package.json']:'{"name":"selected","version":"1.0.0"}\n',
    [selected+'/index.mjs']:'export const selected = true;\n',
    [selected+'/.gitattributes']:'*.txt text eol=lf\n',
    [selected+'/nested/.gitattributes']:'*.json -text\n',
    [selected+'/nested/data.json']:'{"selected":true}\n',
    'packages/choseno/private/.gitattributes':'*.mjs -text\n',
    'unrelated/deep/private.mjs':'export const unrelated = true;\n',
  });
  initialize(root,{
    'package.json':'{"name":"root","version":"1.0.0","files":["instance"]}\n',
    'pnpm-lock.yaml':'lockfileVersion: 9.0\n',
    '.gitattributes':'*.json text eol=lf\n',
    'mounts/.gitattributes':'*.mjs text eol=lf\n',
    'instance/.gitattributes':'*.json -text\n',
    'instance/config.json':'{"own":true}\n',
    'unrelated/deep/private.mjs':'export const rootUnrelated = true;\n',
  });
  git(root,'-c','protocol.file.allow=always','submodule','add','-q','--name','library',provider,'mounts/library');
  git(root,'-c','commit.gpgsign=false','commit','-qm','Recorded source owner');
  const mount=join(root,'mounts/library'),importerIds=['.','mounts/library/'+selected];
  const receive=(ids=importerIds)=>receiveSelectedSources({root,importerIds:ids,environment});
  const removeTree=(repository,path)=>{
    const identity=git(repository,'rev-parse','HEAD:'+path),objectDirectory=git(repository,'rev-parse','--absolute-git-dir');
    rmSync(join(objectDirectory,'objects',identity.slice(0,2),identity.slice(2)));
    assert.throws(()=>git(repository,'cat-file','-e',identity));
  };
  return {directory,provider,providerCommit,root,mount,importerIds,receive,removeTree};
}

test('selected source receipts retain ancestor, package and descendant attributes',async t=>{
  const f=fixture(t),mounts=await f.receive(),owner=mounts.find(row=>row.path==='mounts/library');
  assert.equal(owner.revision,f.providerCommit);
  assert.deepEqual(owner.attributes.map(row=>row.path),['.gitattributes','packages/.gitattributes',selected+'/.gitattributes',selected+'/nested/.gitattributes']);
  for(const row of owner.attributes)assert.equal(row.gitBlob,git(f.mount,'rev-parse','HEAD:'+row.path));
  writeFileSync(join(f.mount,selected+'/nested/.gitattributes'),'*.json text\n');
  await assert.rejects(f.receive(),/attributes differ from committed checkout policy/u);
});

test('selected child receiving ignores unrelated and glob-neighbour descendant trees',async t=>{
  const f=fixture(t),before=await f.receive();
  git(f.mount,'sparse-checkout','init','--cone','--sparse-index');git(f.mount,'sparse-checkout','set','--skip-checks',selected);
  f.removeTree(f.mount,'unrelated/deep');f.removeTree(f.mount,'packages/choseno/private');
  assert.throws(()=>git(f.mount,'ls-tree','-r','HEAD'));
  const after=await f.receive();assert.deepEqual(after,before);
  assert.equal(existsSync(join(f.mount,'unrelated/deep/private.mjs')),false);
  assert.equal(existsSync(join(f.mount,'packages/choseno/private/.gitattributes')),false);
});

test('an explicit mounted owner root still requires its complete owned tree',async t=>{
  const f=fixture(t);git(f.mount,'sparse-checkout','init','--cone','--sparse-index');git(f.mount,'sparse-checkout','set','--skip-checks',selected);
  f.removeTree(f.mount,'unrelated/deep');
  await assert.rejects(f.receive(['.','mounts/library']));
});

test('automatic workspace dot checks only selected root source and declared root assets',async t=>{
  const f=fixture(t),before=await f.receive();
  git(f.root,'sparse-checkout','init','--cone','--sparse-index');git(f.root,'sparse-checkout','set','--skip-checks','mounts/library','instance');
  f.removeTree(f.root,'unrelated/deep');assert.throws(()=>git(f.root,'ls-tree','-r','HEAD'));
  assert.deepEqual(await f.receive(),before);
  writeFileSync(join(f.root,'instance/.gitattributes'),'*.json text\n');
  await assert.rejects(f.receive(),/attributes differ from committed checkout policy/u);
});

test('root and selected ancestor attribute bytes cannot be silently changed or omitted',async t=>{
  const f=fixture(t),rootAttributes=join(f.root,'.gitattributes'),original=readFileSync(rootAttributes);
  writeFileSync(rootAttributes,'*.json -text\n');await assert.rejects(f.receive(),/attributes differ from committed checkout policy/u);
  writeFileSync(rootAttributes,original);rmSync(join(f.root,'mounts/.gitattributes'));
  await assert.rejects(f.receive(),/selected source carrier is missing or not materialized/u);
});

test('missing selected attribute objects and source subtrees refuse receiving',async t=>{
  const f=fixture(t);git(f.mount,'sparse-checkout','init','--cone','--sparse-index');git(f.mount,'sparse-checkout','set','--skip-checks',selected);
  f.removeTree(f.mount,selected+'/nested');
  await assert.rejects(f.receive());
});

test('sparse receiving and verification use read-only Git and preserve source metadata',async t=>{
  const f=fixture(t),state=join(f.directory,'state'),bin=join(state,'bin'),trace=join(state,'git-calls.jsonl');mkdirSync(bin,{recursive:true});
  git(f.mount,'sparse-checkout','init','--cone','--sparse-index');git(f.mount,'sparse-checkout','set','--skip-checks',selected);
  git(f.root,'sparse-checkout','init','--cone','--sparse-index');git(f.root,'sparse-checkout','set','--skip-checks','mounts/library','instance');
  f.removeTree(f.mount,'unrelated/deep');f.removeTree(f.root,'unrelated/deep');
  writeFileSync(join(state,'pnpm-lock.yaml'),'fixture selected lock\n');
  const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim();
  const wrapper=`#!${process.execPath}\nimport fs from 'node:fs';import cp from 'node:child_process';
const args=process.argv.slice(2),a=[...args];
if(a[0]==='-C')a.splice(0,2);
while(['--no-lazy-fetch','--literal-pathspecs'].includes(a[0]))a.shift();
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+'\\n');
const allowed=['rev-parse','ls-tree','ls-files'].includes(a[0])
 ||a[0]==='config'&&['--bool','--blob'].includes(a[1])
 ||a[0]==='show'&&(/^(?:HEAD:package\\.json)$/.test(a[1])||/^HEAD:(?:.*\\/)?(?:\\.gitmodules|\\.gitattributes)$/.test(a[1]))
 ||a[0]==='submodule'&&a[1]==='status'&&a[2]==='--'
 ||a[0]==='diff'&&a[1]==='--cached'&&a[2]==='--name-only'&&a[3]==='--ignore-submodules=none'&&a[4]==='--'&&process.env.GIT_OPTIONAL_LOCKS==='0'
 ||a[0]==='status'&&['--porcelain=v1','--porcelain=v2'].includes(a[1])&&a.includes('--untracked-files=no')&&a.includes('--ignore-submodules=all')&&a.includes('--')&&process.env.GIT_OPTIONAL_LOCKS==='0';
if(!allowed){console.error('forbidden Git mutation or acquisition: '+JSON.stringify(args));process.exit(92);}
const result=cp.spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});if(result.error)throw result.error;process.exit(result.status);\n`;
  writeFileSync(join(bin,'git'),wrapper);chmodSync(join(bin,'git'),0o755);
  const guarded={...environment,PATH:bin+':'+environment.PATH};
  const repositories=[f.root,f.mount].map(root=>git(root,'rev-parse','--absolute-git-dir'));
  const metadata=()=>Object.fromEntries(repositories.flatMap(root=>['config','index','HEAD'].map(path=>[join(root,path),hash(readFileSync(join(root,path)))])));
  const before=metadata(),sourceMounts=await receiveSelectedSources({root:f.root,importerIds:f.importerIds,environment:guarded});
  const receipt={type:'NodeRuntimeWorkspaceSelectionInstallReceipt',version:1,status:'installed',sourceConfigurationUnchanged:true,workspace:f.root,commit:git(f.root,'rev-parse','HEAD'),artifact:state,scopedLockSha256:hash(readFileSync(join(state,'pnpm-lock.yaml'))),importerIds:f.importerIds,sourceMounts,sourceHashes:Object.fromEntries(['package.json','pnpm-lock.yaml'].map(path=>[path,hash(readFileSync(join(f.root,path)))])),manifestHashes:Object.fromEntries(f.importerIds.map(path=>[path,hash(readFileSync(join(f.root,path,'package.json')))]))};
  assert.equal(await verifyWorkspaceSelection(receipt,{environment:guarded}),f.root);
  assert.deepEqual(metadata(),before);
  const calls=readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.some(args=>args.includes('--no-lazy-fetch')&&args.includes('--literal-pathspecs')&&args.includes('ls-tree')));
  assert.equal(calls.some(args=>args.some(arg=>['fetch','clone','checkout','init','update','add','read-tree'].includes(arg))),false);
});

test('root-only selection authenticates root attributes without a files declaration',async t=>{
  const f=fixture(t);writeFileSync(join(f.root,'package.json'),'{"name":"root","version":"1.0.0"}\n');
  git(f.root,'add','package.json');git(f.root,'-c','commit.gpgsign=false','commit','-qm','Root package has no files declaration');
  assert.deepEqual(await f.receive(['.']),[]);
  writeFileSync(join(f.root,'.gitattributes'),'*.json -text\n');
  await assert.rejects(f.receive(['.']),/attributes differ from committed checkout policy/u);
});

test('root manifest redirection and changed manifest bytes refuse policy selection',async t=>{
  const f=fixture(t),manifest=join(f.root,'package.json'),original=readFileSync(manifest),outside=join(f.directory,'redirected-package.json');
  writeFileSync(outside,original);rmSync(manifest);symlinkSync(outside,manifest);
  await assert.rejects(f.receive(),/redirected|not regular/u);
  rmSync(manifest);writeFileSync(manifest,'{"name":"root","version":"1.0.0","files":[]}\n');
  await assert.rejects(f.receive(),/root package carrier declaration differs from committed source/u);
});

test('missing promisor attribute blob refuses without attempted acquisition',async t=>{
  const f=fixture(t),trace=join(f.directory,'promisor-trace.log'),events=join(f.directory,'promisor-trace.jsonl'),identity=git(f.mount,'rev-parse','HEAD:.gitattributes'),gitDirectory=git(f.mount,'rev-parse','--absolute-git-dir');
  rmSync(join(gitDirectory,'objects',identity.slice(0,2),identity.slice(2)));
  git(f.mount,'config','remote.origin.promisor','true');git(f.mount,'config','remote.origin.partialclonefilter','blob:none');git(f.mount,'config','remote.origin.url','https://example.invalid/refused.git');
  const guarded={...environment,GIT_NO_LAZY_FETCH:'0',GIT_ALLOW_PROTOCOL:'',GIT_TRACE:trace,GIT_TRACE2_EVENT:events};
  await assert.rejects(receiveSelectedSources({root:f.root,importerIds:f.importerIds,environment:guarded}),/git exited/u);
  const calls=readFileSync(trace,'utf8');
  const commands=readFileSync(events,'utf8').trim().split('\n').map(JSON.parse).filter(row=>row.event==='start').map(row=>row.argv);
  assert.ok(commands.some(args=>args.includes('--no-lazy-fetch')&&args.includes('show')&&args.includes('HEAD:.gitattributes')));
  assert.equal(/(?:\s|')fetch(?:\s|')/u.test(calls),false,'missing policy blob must not start a fetch even when lazy fetching would otherwise be enabled');
});
