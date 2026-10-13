import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyWorkspaceSelection,runWorkspaceSelection} from '../src/install-workspace-selection.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
async function fixture(t){
  const temp=await mkdtemp(join(tmpdir(),'workspace-body-receiving-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const root=join(temp,'source'),artifact=join(temp,'state');await mkdir(root);await mkdir(artifact);git(root,'init','-q');
  await writeFile(join(root,'package.json'),'{"name":"fixture","version":"1.0.0"}\n');await writeFile(join(root,'pnpm-lock.yaml'),'lockfileVersion: 9.0\n');await writeFile(join(root,'index.mjs'),'export const value=1;\n');await mkdir(join(root,'src/generated'),{recursive:true});await writeFile(join(root,'src/generated/descriptors.mjs'),'export const generated=1;\n');
  git(root,'add','.');git(root,'commit','-qm','fixture');await writeFile(join(artifact,'pnpm-lock.yaml'),'scope\n');
  const manifest=await readFile(join(root,'package.json'));
  return {root,artifact,receipt:{type:'NodeRuntimeWorkspaceSelectionInstallReceipt',version:1,status:'installed',sourceConfigurationUnchanged:true,workspace:root,commit:git(root,'rev-parse','HEAD'),artifact,scopedLockSha256:hash('scope\n'),importerIds:['.'],sourceMounts:[],sourceHashes:{'package.json':hash(manifest),'pnpm-lock.yaml':hash('lockfileVersion: 9.0\n')},manifestHashes:{'.':hash(manifest)}}};
}
async function program(f,body){const path=join(f.artifact,'pnpm-fixture');await writeFile(path,'#!'+process.execPath+'\n'+body+'\n');await chmod(path,0o755);f.receipt.executable=path;}
test('clean non-bin source remains admitted',async t=>{const f=await fixture(t);assert.equal(await verifyWorkspaceSelection(f.receipt),f.root);});
test('non-bin tracked body mutation cannot retain manifest-only acceptance',async t=>{const f=await fixture(t);await writeFile(join(f.root,'index.mjs'),'export const value=2;\n');await assert.rejects(verifyWorkspaceSelection(f.receipt),/selected source has tracked changes/);});
test('staged non-bin mutation is also unreceived source',async t=>{const f=await fixture(t);await writeFile(join(f.root,'index.mjs'),'export const value=2;\n');git(f.root,'add','index.mjs');await assert.rejects(verifyWorkspaceSelection(f.receipt),/selected source has tracked changes/);});
test('changed tracked generated output remains an explicit receiving obligation',async t=>{const f=await fixture(t);await writeFile(join(f.root,'src/generated/descriptors.mjs'),'export const generated=2;\n');await assert.rejects(verifyWorkspaceSelection(f.receipt),/selected source has tracked changes/);});
test('unchanged regeneration does not become a source discrepancy',async t=>{const f=await fixture(t);await writeFile(join(f.root,'src/generated/descriptors.mjs'),'export const generated=1;\n');assert.equal(await verifyWorkspaceSelection(f.receipt),f.root);});
test('untracked build output is not treated as received source evidence',async t=>{const f=await fixture(t);await mkdir(join(f.root,'dist'));await writeFile(join(f.root,'dist/derived.mjs'),'export const value=1;\n');assert.equal(await verifyWorkspaceSelection(f.receipt),f.root);assert.equal(f.receipt.generatedOutputs,undefined);});
test('genuine consumer refuses changed source before its command',async t=>{const f=await fixture(t),marker=join(f.artifact,'ran');await program(f,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran');`);await writeFile(join(f.root,'index.mjs'),'export const value=2;\n');await assert.rejects(runWorkspaceSelection({receipt:f.receipt,arguments:['fixture']}),/selected source has tracked changes/);await assert.rejects(access(marker),{code:'ENOENT'});});
test('genuine consumer refuses unattributed tracked mutation after its command',async t=>{const f=await fixture(t);await program(f,`require('node:fs').writeFileSync(${JSON.stringify(join(f.root,'index.mjs'))},'export const value=2;\\n');`);await assert.rejects(runWorkspaceSelection({receipt:f.receipt,arguments:['fixture']}),/selected source has tracked changes/);});
test('tracked-body observation leaves Git index bytes untouched',async t=>{const f=await fixture(t),index=join(f.root,'.git/index'),before=await readFile(index);await verifyWorkspaceSelection(f.receipt);assert.deepEqual(await readFile(index),before);await writeFile(join(f.root,'index.mjs'),'export const value=2;\n');await assert.rejects(verifyWorkspaceSelection(f.receipt),/selected source has tracked changes/);assert.deepEqual(await readFile(index),before);});
