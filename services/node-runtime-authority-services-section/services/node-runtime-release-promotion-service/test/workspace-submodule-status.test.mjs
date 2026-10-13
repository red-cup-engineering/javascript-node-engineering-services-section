import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, writeFile, readFile, rm, chmod, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyWorkspaceSelection, runWorkspaceSelection} from '../src/install-workspace-selection.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
async function repository(path){await mkdir(path,{recursive:true});git(path,'init','-q');git(path,'config','user.name','Fixture');git(path,'config','user.email','fixture@example.invalid');}
function commit(root){git(root,'add','--','.');git(root,'commit','-qm','fixture');return git(root,'rev-parse','HEAD');}
async function fixture(t,{extraCount=0}={}){
  const temp=await mkdtemp(join(tmpdir(),'workspace-mount-receiving-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const root=join(temp,'source'),child=join(root,'packages/library'),leaf=join(child,'vendor/leaf'),artifact=join(temp,'state');
  await repository(root);await repository(child);await repository(leaf);await mkdir(artifact);
  await writeFile(join(leaf,'package.json'),'{}\n');await writeFile(join(leaf,'index.mjs'),'export const value=1;\n');for(let i=0;i<extraCount;i++)await writeFile(join(leaf,'extra-'+i+'.mjs'),'original '+i);const leafRevision=commit(leaf);
  await writeFile(join(child,'package.json'),'{}\n');await writeFile(join(child,'index.mjs'),'export const value=1;\n');
  await writeFile(join(child,'.gitmodules'),'[submodule "leaf"]\n path = vendor/leaf\n url = https://github.com/fixture/leaf.git\n');
  git(child,'update-index','--add','--cacheinfo','160000,'+leafRevision+',vendor/leaf');const childRevision=commit(child);
  await writeFile(join(root,'package.json'),'{}\n');await writeFile(join(root,'pnpm-lock.yaml'),'lockfileVersion: 9.0\n');
  await writeFile(join(root,'.gitmodules'),'[submodule "library"]\n path = packages/library\n url = https://github.com/fixture/library.git\n');
  git(root,'update-index','--add','--cacheinfo','160000,'+childRevision+',packages/library');const revision=commit(root);git(root,'submodule','init');git(child,'submodule','init');
  await writeFile(join(artifact,'pnpm-lock.yaml'),'scope\n');
  const importerIds=['.','packages/library','packages/library/vendor/leaf'];
  const manifestHashes=Object.fromEntries(await Promise.all(importerIds.map(async id=>[id,hash(await readFile(join(root,id,'package.json')))])));
  const receipt={type:'NodeRuntimeWorkspaceSelectionInstallReceipt',version:1,status:'installed',sourceConfigurationUnchanged:true,
    workspace:root,commit:revision,artifact,scopedLockSha256:hash('scope\n'),importerIds,
    sourceHashes:{'package.json':hash('{}\n'),'pnpm-lock.yaml':hash('lockfileVersion: 9.0\n')},manifestHashes,
    sourceMounts:[{path:'packages/library',revision:childRevision},{path:'packages/library/vendor/leaf',revision:leafRevision}]};
  return {root,child,leaf,receipt};
}


const errorContainsBodies=error=>error.message.includes('derived fixture')||error.message.includes('changed fixture');
for(const [label,mutate] of [
 ['tracked leaf body',async f=>{await writeFile(join(f.leaf,'index.mjs'),'changed fixture');}],
 ['tracked leaf executable mode',async f=>{await chmod(join(f.leaf,'index.mjs'),0o755);}],
])test(label+' has exact separate nested status evidence',async t=>{
 const f=await fixture(t);await mutate(f);
 const evidence=[];for(const directory of [f.root,f.child,f.leaf])evidence.push({scope:directory===f.root?'.':directory.slice(f.root.length+1),v1:git(directory,'status','--porcelain=v1','--untracked-files=no','--ignore-submodules=none','--','.'),v2:git(directory,'status','--porcelain=v2','--untracked-files=no','--ignore-submodules=none','--','.')});
 console.log(JSON.stringify({label,evidence}));
 let observed;await assert.rejects(verifyWorkspaceSelection(f.receipt),error=>{observed=error;return /selected source has tracked changes/.test(error.message);});
 assert.ok(Array.isArray(observed.sourceState));
 const rootState=observed.sourceState.find(row=>row.scope==='.'),childState=observed.sourceState.find(row=>row.scope==='packages/library');
 assert.ok(rootState.porcelainV1.startsWith(' M '));assert.deepEqual(rootState.porcelainV2,[evidence[0].v2]);
 assert.equal(rootState.mounts[0].recordedCommit,f.receipt.sourceMounts[0].revision);assert.equal(rootState.mounts[0].actualCommit,f.receipt.sourceMounts[0].revision);assert.equal(rootState.mounts[0].indexGitlink,'160000 '+f.receipt.sourceMounts[0].revision+' 0\tpackages/library\n');
 assert.equal(childState.mounts.find(row=>row.path==='packages/library/vendor/leaf').actualCommit,f.receipt.sourceMounts[1].revision);
 assert.ok(!errorContainsBodies(observed));
 assert.match(evidence[0].v2,/S.M./);assert.match(evidence[2].v1,/M index.mjs/);
});

test('refusal metadata is bounded and reports omitted records without contents',async t=>{
 const f=await fixture(t,{extraCount:40});for(let i=0;i<40;i++)await writeFile(join(f.leaf,'extra-'+i+'.mjs'),'private changed body '+i);
 const indexes=await Promise.all([f.root,f.child,f.leaf].map(directory=>readFile(join(directory,'.git/index'))));let observed;
 await assert.rejects(verifyWorkspaceSelection(f.receipt),error=>{observed=error;return /selected source has tracked changes/.test(error.message);});
 const leaf=observed.sourceState.find(row=>row.scope==='packages/library/vendor/leaf');assert.equal(leaf.porcelainV2.length,24);assert.equal(leaf.omittedRecords,16);assert.ok(!observed.message.includes('private changed body'));
 assert.deepEqual(await Promise.all([f.root,f.child,f.leaf].map(directory=>readFile(join(directory,'.git/index')))),indexes);
});

async function untracked(t){const f=await fixture(t);await writeFile(join(f.leaf,'untracked-output.mjs'),'derived fixture');return f;}
test('authenticated nested untracked state preserves tracked-source admission and index bytes',async t=>{
 const f=await untracked(t);const indexes=await Promise.all([f.root,f.child,f.leaf].map(directory=>readFile(join(directory,'.git/index'))));
 assert.match(git(f.root,'status','--porcelain=v2','--untracked-files=no','--ignore-submodules=none','--','.'),/S\.\.U/);
 assert.equal(await verifyWorkspaceSelection(f.receipt),f.root);
 assert.deepEqual(await Promise.all([f.root,f.child,f.leaf].map(directory=>readFile(join(directory,'.git/index')))),indexes);
});
for(const [label,mutate]of[
 ['body',async f=>writeFile(join(f.leaf,'index.mjs'),'changed body')],
 ['mode',async f=>chmod(join(f.leaf,'index.mjs'),0o755)],
 ['staged body',async f=>{await writeFile(join(f.leaf,'index.mjs'),'changed body');git(f.leaf,'add','index.mjs');}],
 ['rename',async f=>git(f.leaf,'mv','index.mjs','renamed.mjs')],
 ['commit',async f=>{await writeFile(join(f.leaf,'index.mjs'),'new commit');commit(f.leaf);}],
 ['index gitlink',async f=>git(f.child,'update-index','--cacheinfo','160000,'+'1'.repeat(40)+',vendor/leaf')],
])test('untracked state cannot conceal tracked '+label+' drift',async t=>{
 const f=await untracked(t);await mutate(f);await assert.rejects(verifyWorkspaceSelection(f.receipt));
});
test('unselected untracked gitlink cannot substitute for an authenticated selected mount',async t=>{
 const f=await untracked(t);f.receipt.importerIds=['.'];f.receipt.manifestHashes={'.':f.receipt.manifestHashes['.']};f.receipt.sourceMounts=[];
 await assert.rejects(verifyWorkspaceSelection(f.receipt),/selected source has tracked changes or nested submodule state/);
});
test('genuine command may retain untracked output but cannot return with changed tracked bytes',async t=>{
 const f=await untracked(t),executable=join(f.receipt.artifact,'producer'),marker=join(f.receipt.artifact,'ran');
 const program=body=>'#!'+process.execPath+'\n'+body;
 await writeFile(executable,program('const fs=require("node:fs");fs.writeFileSync('+JSON.stringify(marker)+',"ran");fs.writeFileSync('+JSON.stringify(join(f.leaf,'more-output.mjs'))+',"untracked");'));await chmod(executable,0o755);f.receipt.executable=executable;
 const result=await runWorkspaceSelection({receipt:f.receipt,arguments:['build']});assert.equal(result.sourceConfigurationUnchanged,true);assert.equal(await readFile(marker,'utf8'),'ran');assert.equal(result.produced,undefined,'ordinary command does not attest untracked payload');
 await writeFile(executable,program('require("node:fs").writeFileSync('+JSON.stringify(join(f.leaf,'index.mjs'))+',"changed during command");'));
 await assert.rejects(runWorkspaceSelection({receipt:f.receipt,arguments:['build']}),/selected source has tracked changes/);
});
