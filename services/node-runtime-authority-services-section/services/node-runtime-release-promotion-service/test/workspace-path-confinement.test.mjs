import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename,symlink,chmod,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyWorkspaceSelection,runWorkspaceSelection} from '../src/install-workspace-selection.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
async function fixture(t){
  const temp=await mkdtemp(join(tmpdir(),'workspace-path-confinement-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const root=join(temp,'source'),artifact=join(temp,'state'),packagePath='packages/nested/tool';await mkdir(join(root,packagePath),{recursive:true});await mkdir(artifact);
  git(root,'init','-q');await writeFile(join(root,'package.json'),'{}\n');await writeFile(join(root,packagePath,'package.json'),'{}\n');await writeFile(join(root,'pnpm-lock.yaml'),'lockfileVersion: 9.0\n');
  git(root,'add','.');git(root,'commit','-qm','fixture');await writeFile(join(artifact,'pnpm-lock.yaml'),'scope\n');
  return {temp,root,artifact,packagePath,receipt:{type:'NodeRuntimeWorkspaceSelectionInstallReceipt',version:1,status:'installed',sourceConfigurationUnchanged:true,workspace:root,commit:git(root,'rev-parse','HEAD'),artifact,scopedLockSha256:hash('scope\n'),importerIds:['.',packagePath],sourceMounts:[],sourceHashes:{'package.json':hash('{}\n'),'pnpm-lock.yaml':hash('lockfileVersion: 9.0\n')},manifestHashes:{'.':hash('{}\n'),[packagePath]:hash('{}\n')}}};
}
async function redirect(f,path){const target=join(f.temp,'retained');await rename(path,target);await symlink(target,path);return target;}
test('genuine verifier preserves normal nested importer receiving',async t=>{const f=await fixture(t);assert.equal(await verifyWorkspaceSelection(f.receipt),f.root);});
test('identical manifest behind redirected importer refuses',async t=>{const f=await fixture(t);await redirect(f,join(f.root,f.packagePath));await assert.rejects(verifyWorkspaceSelection(f.receipt),/redirected or not regular/);});
test('redirected intermediate source directory refuses',async t=>{const f=await fixture(t);await redirect(f,join(f.root,'packages'));await assert.rejects(verifyWorkspaceSelection(f.receipt),/redirected or not regular/);});
test('redirected manifest file refuses before hashing matching bytes',async t=>{const f=await fixture(t);await redirect(f,join(f.root,f.packagePath,'package.json'));await assert.rejects(verifyWorkspaceSelection(f.receipt),/redirected or not regular/);});
test('redirected source lock refuses before hashing matching bytes',async t=>{const f=await fixture(t);await redirect(f,join(f.root,'pnpm-lock.yaml'));await assert.rejects(verifyWorkspaceSelection(f.receipt),/redirected or not regular/);});
test('redirected external receipt lock refuses before hashing matching bytes',async t=>{const f=await fixture(t);await redirect(f,join(f.artifact,'pnpm-lock.yaml'));await assert.rejects(verifyWorkspaceSelection(f.receipt),/redirected or not regular/);});
test('redirected source root refuses',async t=>{const f=await fixture(t);await redirect(f,f.root);await assert.rejects(verifyWorkspaceSelection(f.receipt),/source root is redirected/);});
test('redirected artifact root refuses',async t=>{const f=await fixture(t);await redirect(f,f.artifact);await assert.rejects(verifyWorkspaceSelection(f.receipt),/receipt artifact is redirected/);});
test('redirected committed mount declaration refuses before reading its bytes',async t=>{
  const f=await fixture(t),path=join(f.root,'.gitmodules');await writeFile(path,'# no mounts\n');git(f.root,'add','.gitmodules');git(f.root,'commit','-qm','mount declaration');f.receipt.commit=git(f.root,'rev-parse','HEAD');await redirect(f,path);
  await assert.rejects(verifyWorkspaceSelection(f.receipt),/redirected or not regular/);
});
test('noncanonical importer refuses rather than traversing a parent path',async t=>{const f=await fixture(t);f.receipt.importerIds.push('../state');await assert.rejects(verifyWorkspaceSelection(f.receipt),/canonical relative path/);});
async function program(f,body){const path=join(f.artifact,'pnpm-fixture');await writeFile(path,'#!'+process.execPath+'\n'+body+'\n');await chmod(path,0o755);f.receipt.executable=path;}
test('redirected package refuses before genuine command consumer invocation',async t=>{
  const f=await fixture(t),marker=join(f.artifact,'ran');await program(f,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'yes')`);await redirect(f,join(f.root,f.packagePath));
  await assert.rejects(runWorkspaceSelection({receipt:f.receipt,arguments:['fixture']}),/redirected or not regular/);await assert.rejects(access(marker),{code:'ENOENT'});
});
test('genuine command consumer refuses package redirection after its command',async t=>{
  const f=await fixture(t),path=join(f.root,f.packagePath),outside=join(f.temp,'moved');
  await program(f,`const fs=require('node:fs');fs.renameSync(${JSON.stringify(path)},${JSON.stringify(outside)});fs.symlinkSync(${JSON.stringify(outside)},${JSON.stringify(path)});`);
  await assert.rejects(runWorkspaceSelection({receipt:f.receipt,arguments:['fixture']}),/redirected or not regular/);
});
