import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {join,dirname,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const realSpawn=childProcess.spawn;
const calls=[];
// Test transport substitutes ONLY synthetic github fixture URLs with local
// filter-capable repositories. GIT_ALLOW_PROTOCOL=file forbids real networking.
childProcess.spawn=function(program,args,options){
 assert.equal(program,'git');
 assert.ok(options.env?.FIXTURE_ROOT && options.cwd?.startsWith(options.env.FIXTURE_ROOT+'/') || args[0]==='-C' && args[1]?.startsWith(options.env?.FIXTURE_ROOT+'/'));
 calls.push({cwd:options.cwd,args:[...args]});
 const mapped=args.map(value=>value==='protocol.file.allow=never'?'protocol.file.allow=always':value);
 return realSpawn(program,mapped,options);
};
syncBuiltinESMExports();
const {receiveSelectedSources,verifyWorkspaceSelection}=await import(pathToFileURL(resolve(process.env.ACQUISITION_SOURCE??'workspace-selected-acquisition-20261013/candidate/src/install-workspace-selection.mjs')));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'selected-package-acquisition-')),servers=join(root,'servers');mkdirSync(servers);
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const environment={PATH:process.env.PATH,HOME:root,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1',GIT_ALLOW_PROTOCOL:'file',FIXTURE_ROOT:root,GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:`url.${pathToFileURL(servers).href}/.insteadOf`,GIT_CONFIG_VALUE_0:'https://github.com/',GIT_CONFIG_KEY_1:'core.hooksPath',GIT_CONFIG_VALUE_1:'/dev/null'};
 const git=(cwd,args,{check=true,offline=false}={})=>{const result=childProcess.spawnSync('git',['-C',cwd,...args],{env:{...environment,...offline?{GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:''}:{}},encoding:'utf8',maxBuffer:16*1024*1024});if(check&&result.status!==0)throw new Error(result.stderr);return check?result.stdout.trim():result;};
 let serial=0;
 const source=(name,{files={'sites/app/package.json':'{"name":"app","version":"1.0.0"}\n','sites/app/index.mjs':'export const value=1;\n','root-excluded.md':'# Excluded root body\n','private/excluded.md':'# Excluded sibling body\n'},mounts=[],filter=true}={})=>{
  const directory=join(root,'source-'+(++serial));mkdirSync(directory);git(directory,['init','-q']);git(directory,['config','user.name','Fixture']);git(directory,['config','user.email','fixture@example.invalid']);
  for(const [path,body]of Object.entries(files)){mkdirSync(dirname(join(directory,path)),{recursive:true});writeFileSync(join(directory,path),body);}
  if(mounts.length)writeFileSync(join(directory,'.gitmodules'),mounts.map(m=>`[submodule "${m.path}"]\n\tpath = ${m.path}\n\turl = https://github.com/fixture/${m.name}.git\n`).join(''));
  git(directory,['add','.']);for(const m of mounts)git(directory,['update-index','--add','--cacheinfo',`160000,${m.commit},${m.path}`]);git(directory,['commit','-qm','synthetic source']);
  const commit=git(directory,['rev-parse','HEAD']),server=join(servers,'fixture',name+'.git');mkdirSync(dirname(server),{recursive:true});git(directory,['clone','--bare','--no-hardlinks',directory,server]);git(server,['config','uploadpack.allowFilter',String(filter)]);git(server,['config','uploadpack.allowAnySHA1InWant','true']);
  const blobs=git(directory,['ls-tree','-r','HEAD']).split('\n').filter(x=>x.includes(' blob ')).map(x=>{const[h,path]=x.split('\t');return{oid:h.split(' ')[2],path};});
  return{name,directory,commit,server,blobs};
 };
 const machine=(mounts)=>{const s=source('machine',{files:{'package.json':'{"name":"machine","version":"1.0.0"}\n','pnpm-lock.yaml':'synthetic committed lock\n'},mounts});for(const m of mounts)mkdirSync(join(s.directory,m.path),{recursive:true});return s;};
 const receive=(s,importerIds,materialize=true)=>receiveSelectedSources({root:s.directory,importerIds,environment,materialize});
 const physical=directory=>git(directory,['cat-file','--batch-all-objects','--batch-check=%(objectname) %(objecttype)'],{offline:true}).split('\n').filter(x=>x.endsWith(' blob')).map(x=>x.split(' ')[0]).sort();
 return{root,environment,git,source,machine,receive,physical};
}
function assertProjection(f,directory,source,prefixes){
 const expected=source.blobs.filter(row=>row.path==='.gitmodules'||prefixes.some(prefix=>prefix==='.'||row.path.startsWith(prefix+'/'))).map(row=>row.oid).sort();
 assert.deepEqual(f.physical(directory),[...new Set(expected)]);
 for(const row of source.blobs.filter(row=>!expected.includes(row.oid)))assert.notEqual(f.git(directory,['cat-file','-e',row.oid],{offline:true,check:false}).status,0,`${row.path} must remain physically absent`);
}
test('selected package checkout never hydrates excluded root or sibling blobs; read-only receiving remains valid',async t=>{
 const f=fixture(t),owner=f.source('science'),machine=f.machine([{...owner,path:'sources/science'}]),ids=['.','sources/science/sites/app'];
 const mounts=await f.receive(machine,ids);assert.deepEqual(mounts,[{path:'sources/science',revision:owner.commit}]);assertProjection(f,join(machine.directory,'sources/science'),owner,['sites/app']);
 assert.ok(!existsSync(join(machine.directory,'sources/science/root-excluded.md')));assert.deepEqual(await f.receive(machine,ids,false),mounts);
 const artifact=join(f.root,'selection');mkdirSync(artifact);writeFileSync(join(artifact,'pnpm-lock.yaml'),'selected lock');
 const receipt={type:'NodeRuntimeWorkspaceSelectionInstallReceipt',version:1,status:'installed',sourceConfigurationUnchanged:true,workspace:machine.directory,commit:machine.commit,artifact,sourceMounts:mounts,importerIds:ids,manifestHashes:Object.fromEntries(ids.map(id=>[id,hash(readFileSync(join(machine.directory,id,'package.json')))])),sourceHashes:{'package.json':hash(readFileSync(join(machine.directory,'package.json'))),'pnpm-lock.yaml':hash(readFileSync(join(machine.directory,'pnpm-lock.yaml')))},scopedLockSha256:hash('selected lock')};
 assert.equal(await verifyWorkspaceSelection(receipt,{environment:f.environment}),machine.directory);
});
test('selected nested Gitlink descendant is received without sibling or ancestor corpus',async t=>{
 const f=fixture(t),child=f.source('child'),owner=f.source('science',{mounts:[{...child,path:'services/child'}]}),machine=f.machine([{...owner,path:'sources/science'}]);
 const mounts=await f.receive(machine,['.','sources/science/services/child/sites/app']);
 assert.deepEqual(mounts,[{path:'sources/science',revision:owner.commit},{path:'sources/science/services/child',revision:child.commit}]);
 assertProjection(f,join(machine.directory,'sources/science'),owner,['services/child/sites/app']);assertProjection(f,join(machine.directory,'sources/science/services/child'),child,['sites/app']);
});
test('literal sparse projection does not widen glob-special selected package names',async t=>{
 const f=fixture(t),path='sites/app[one]*? space',owner=f.source('science',{files:{[path+'/package.json']:'{"name":"literal"}\n',[path+'/index.mjs']:'export const literal=1;\n','sites/appoZZZ space/private.md':'excluded pattern neighbour\n','root-excluded.md':'excluded root\n'}}),machine=f.machine([{...owner,path:'sources/science'}]);
 await f.receive(machine,['.','sources/science/'+path]);assertProjection(f,join(machine.directory,'sources/science'),owner,[path]);assert.ok(existsSync(join(machine.directory,'sources/science',path,'index.mjs')));
});
test('explicit owner-root package retains its ordinary declared source tree',async t=>{
 const f=fixture(t),owner=f.source('science'),machine=f.machine([{...owner,path:'sources/science'}]);await f.receive(machine,['.','sources/science']);assertProjection(f,join(machine.directory,'sources/science'),owner,['.']);
});
test('server ignoring blob filter is refused, and unreceived carrier is retained',async t=>{
 const f=fixture(t),owner=f.source('science',{filter:false}),machine=f.machine([{...owner,path:'sources/science'}]),target=join(machine.directory,'sources/science');
 await assert.rejects(f.receive(machine,['.','sources/science/sites/app']),/did not honor blob:none/);assert.ok(existsSync(join(target,'.git')));assert.ok(f.physical(target).length>0);assert.ok(!existsSync(join(target,'sites/app/index.mjs')));
 await assert.rejects(f.receive(machine,['.','sources/science/sites/app']),/existing contents|ambiguous argument|needed a single revision/);
});
test('existing unreceived contents and read-only missing mounts are preserved without fetch',async t=>{
 const f=fixture(t),owner=f.source('science'),machine=f.machine([{...owner,path:'sources/science'}]),target=join(machine.directory,'sources/science'),start=calls.length;
 await assert.rejects(f.receive(machine,['.','sources/science/sites/app'],false),/not materialized/);writeFileSync(join(target,'held'),'preserve');await assert.rejects(f.receive(machine,['.','sources/science/sites/app']),/existing contents/);assert.equal(readFileSync(join(target,'held'),'utf8'),'preserve');assert.ok(!calls.slice(start).some(x=>x.args.includes('fetch')));
});
test('failed filtered fetch retains partial initialized state without destructive retry',async t=>{
 const f=fixture(t),owner=f.source('science'),machine=f.machine([{...owner,commit:'f'.repeat(40),path:'sources/science'}]),target=join(machine.directory,'sources/science');
 await assert.rejects(f.receive(machine,['.','sources/science/sites/app']),/exited/);assert.ok(existsSync(join(target,'.git')));await assert.rejects(f.receive(machine,['.','sources/science/sites/app']),/existing contents|ambiguous argument|needed a single revision/);
});
test('previously initialized sparse mount is not silently widened for a new package',async t=>{
 const f=fixture(t),owner=f.source('science',{files:{'sites/first/package.json':'{"name":"first"}\n','sites/second/package.json':'{"name":"second"}\n'}}),machine=f.machine([{...owner,path:'sources/science'}]),target=join(machine.directory,'sources/science');
 await f.receive(machine,['.','sources/science/sites/first']);const before=f.physical(target),start=calls.length;await f.receive(machine,['.','sources/science/sites/second']);assert.deepEqual(f.physical(target),before);assert.ok(!existsSync(join(target,'sites/second/package.json')));assert.ok(!calls.slice(start).some(x=>x.args.includes('checkout')||x.args.includes('fetch')));
 const artifact=join(f.root,'new-selection');mkdirSync(artifact);writeFileSync(join(artifact,'pnpm-lock.yaml'),'new lock');
 const receipt={type:'NodeRuntimeWorkspaceSelectionInstallReceipt',version:1,status:'installed',sourceConfigurationUnchanged:true,workspace:machine.directory,commit:machine.commit,artifact,sourceMounts:[{path:'sources/science',revision:owner.commit}],importerIds:['.','sources/science/sites/second'],manifestHashes:{'.':hash(readFileSync(join(machine.directory,'package.json'))),'sources/science/sites/second':hash('{"name":"second"}\n')},sourceHashes:{'package.json':hash(readFileSync(join(machine.directory,'package.json')))},scopedLockSha256:hash('new lock')};
 await assert.rejects(verifyWorkspaceSelection(receipt,{environment:f.environment}),/selected source carrier is missing or not materialized/);
});
