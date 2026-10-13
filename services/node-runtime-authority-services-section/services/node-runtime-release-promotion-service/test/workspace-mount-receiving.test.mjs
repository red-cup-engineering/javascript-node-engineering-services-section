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
async function fixture(t){
  const temp=await mkdtemp(join(tmpdir(),'workspace-mount-receiving-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const root=join(temp,'source'),child=join(root,'packages/library'),leaf=join(child,'vendor/leaf'),artifact=join(temp,'state');
  await repository(root);await repository(child);await repository(leaf);await mkdir(artifact);
  await writeFile(join(leaf,'package.json'),'{}\n');await writeFile(join(leaf,'index.mjs'),'export const value=1;\n');const leafRevision=commit(leaf);
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

test('unchanged recursively committed selected mounts pass the genuine verifier',async t=>{const f=await fixture(t);assert.equal(await verifyWorkspaceSelection(f.receipt),f.root);});
test('a selected child revision change with the same manifest is refused',async t=>{const f=await fixture(t);await writeFile(join(f.child,'index.mjs'),'export const value=2;\n');commit(f.child);await assert.rejects(verifyWorkspaceSelection(f.receipt),/mount.*differs|mount.*changed/u);});
test('a selected nested revision change with the same manifest is refused',async t=>{const f=await fixture(t);await writeFile(join(f.leaf,'index.mjs'),'export const value=2;\n');commit(f.leaf);await assert.rejects(verifyWorkspaceSelection(f.receipt),/mount.*differs|mount.*changed/u);});
test('an omitted recorded mount cannot remove committed source custody',async t=>{const f=await fixture(t);f.receipt.sourceMounts=[];await assert.rejects(verifyWorkspaceSelection(f.receipt),/mount/u);});
test('a staged gitlink change is refused before a consumer command',async t=>{const f=await fixture(t);git(f.root,'update-index','--cacheinfo','160000,'+'a'.repeat(40)+',packages/library');await assert.rejects(verifyWorkspaceSelection(f.receipt),/mount index differs/u);});
test('changed recursive mount declarations are refused',async t=>{const f=await fixture(t);await writeFile(join(f.child,'.gitmodules'),'[submodule "leaf"]\n path = vendor/leaf\n url = https://github.com/fixture/other.git\n');await assert.rejects(verifyWorkspaceSelection(f.receipt),/mount configuration differs/u);});
test('a missing selected mount is refused without acquiring its remote',async t=>{const f=await fixture(t);await rm(f.leaf,{recursive:true});await assert.rejects(verifyWorkspaceSelection(f.receipt),/not materialized|missing|ENOENT/u);});

async function consumer(f,body){
  const marker=join(f.receipt.artifact,'command-ran'),program=join(f.receipt.artifact,'fixture-pnpm');
  await writeFile(program,'#!'+process.execPath+'\n'+body+'\n');await chmod(program,0o755);
  f.receipt.executable=program;
  return marker;
}
test('unchanged selected mounts permit the genuine command consumer',async t=>{
  const f=await fixture(t),marker=join(f.receipt.artifact,'command-ran');
  await consumer(f,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran');`);
  const result=await runWorkspaceSelection({receipt:f.receipt,arguments:['fixture-command']});
  assert.equal(await readFile(marker,'utf8'),'ran');assert.equal(result.sourceConfigurationUnchanged,true);
});
test('changed mount refuses before invoking the selected command',async t=>{
  const f=await fixture(t),marker=join(f.receipt.artifact,'command-ran');
  await consumer(f,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran');`);
  await writeFile(join(f.child,'index.mjs'),'export const value=2;\n');commit(f.child);
  await assert.rejects(runWorkspaceSelection({receipt:f.receipt,arguments:['fixture-command']}),/mount.*differs/u);
  await assert.rejects(access(marker),{code:'ENOENT'});
});
test('a command cannot silently change the selected nested revision',async t=>{
  const f=await fixture(t),marker=join(f.receipt.artifact,'command-ran');
  await consumer(f,`const fs=require('node:fs'),cp=require('node:child_process');fs.writeFileSync(${JSON.stringify(marker)},'ran');fs.writeFileSync(${JSON.stringify(join(f.leaf,'index.mjs'))},'export const value=2;\\n');for(const args of [['add','.'],['commit','-qm','fixture mutation']])cp.execFileSync('git',['-C',${JSON.stringify(f.leaf)},...args]);`);
  await assert.rejects(runWorkspaceSelection({receipt:f.receipt,arguments:['fixture-command']}),/mount.*differs/u);
  assert.equal(await readFile(marker,'utf8'),'ran');
});

test('read-only verification cannot acquire or alter Git state, including a missing mount',async t=>{
  const f=await fixture(t),bin=join(f.receipt.artifact,'bin'),trace=join(f.receipt.artifact,'git-calls');
  await mkdir(bin);
  const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim();
  const wrapper=`#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process');const args=process.argv.slice(2),a=args[0]==='-C'?args.slice(2):args;fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+'\\n');const allowed=['rev-parse','ls-tree','ls-files'].includes(a[0])||(a[0]==='show'&&a[1]==='HEAD:.gitmodules')||(a[0]==='submodule'&&a[1]==='status')||(a[0]==='config'&&(a[1]==='--bool'||a[1]==='--blob'));if(!allowed){console.error('forbidden Git mutation or acquisition: '+JSON.stringify(args));process.exit(92);}const p=cp.spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});if(p.error)throw p.error;process.exit(p.status);\n`;
  await writeFile(join(bin,'git'),wrapper);await chmod(join(bin,'git'),0o755);
  const environment={...process.env,PATH:bin+':'+process.env.PATH};
  const state=async()=>Promise.all([f.root,f.child].flatMap(root=>['config','index','HEAD'].map(async file=>[join(root,'.git',file),hash(await readFile(join(root,'.git',file)))])));
  const before=await state();
  await verifyWorkspaceSelection(f.receipt,{environment});
  assert.deepEqual(await state(),before);
  git(f.root,'update-index','--cacheinfo','160000,'+'a'.repeat(40)+',packages/library');
  const mismatched=await state();
  await assert.rejects(verifyWorkspaceSelection(f.receipt,{environment}),/mount index differs/u);
  assert.deepEqual(await state(),mismatched);
  git(f.root,'update-index','--cacheinfo','160000,'+f.receipt.sourceMounts[0].revision+',packages/library');
  const beforeMissing=await state();
  await rm(f.leaf,{recursive:true});
  await assert.rejects(verifyWorkspaceSelection(f.receipt,{environment}),/not materialized/u);
  assert.deepEqual(await state(),beforeMissing);
  const calls=(await readFile(trace,'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(calls.some(args=>args.includes('status')));
  assert.equal(calls.some(args=>args.some(arg=>['update','init','checkout','fetch','clone','add'].includes(arg))),false);
});
