import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,stat,rm,symlink,rename,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runWorkspaceSelection} from '../src/install-workspace-selection.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,{before=0o700,after=0o755,initialRedirect,postRedirect,changedBytes=false,exitCode=0}={}){
 const temp=await mkdtemp(join(tmpdir(),'source-bin-normalization-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=join(temp,'source'),artifact=join(temp,'state'),outside=join(temp,'outside');for(const p of[root,artifact,outside,join(root,'bin')])await mkdir(p);
 const git=(...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}).trim();git('init','-q');
 const manifest=Buffer.from(JSON.stringify({name:'fixture',version:'1.0.0',bin:{fixture:'bin/tool.mjs'}})),lock=Buffer.from('lockfileVersion: 9.0\n'),body=Buffer.from('// source bin must not execute\n'),bin=join(root,'bin/tool.mjs'),held=join(outside,'tool.mjs');
 await writeFile(join(root,'package.json'),manifest);await writeFile(join(root,'pnpm-lock.yaml'),lock);await writeFile(bin,body);await chmod(bin,before);await writeFile(held,body);await chmod(held,0o755);
 if(initialRedirect==='file'){await rm(bin);await symlink(held,bin);}
 if(initialRedirect==='ancestor'){await rm(join(root,'bin'),{recursive:true});await symlink(outside,join(root,'bin'));}
 git('add','.');git('commit','-qm','fixture');await writeFile(join(artifact,'pnpm-lock.yaml'),lock);const marker=join(artifact,'ran'),executable=join(artifact,'pnpm-fixture');
 const effect=postRedirect==='file'?`fs.unlinkSync(${JSON.stringify(bin)});fs.symlinkSync(${JSON.stringify(held)},${JSON.stringify(bin)});`:postRedirect==='ancestor'?`fs.renameSync(${JSON.stringify(join(root,'bin'))},${JSON.stringify(join(root,'retained-bin'))});fs.symlinkSync(${JSON.stringify(outside)},${JSON.stringify(join(root,'bin'))});`:`fs.chmodSync(${JSON.stringify(bin)},${after});${changedBytes?`fs.writeFileSync(${JSON.stringify(bin)},'changed source');`:''}`;
 await writeFile(executable,'#!'+process.execPath+'\n'+`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},'ran');${effect}process.exit(${exitCode});\n`);await chmod(executable,0o755);
 const receipt={type:'NodeRuntimeWorkspaceSelectionInstallReceipt',version:1,status:'installed',sourceConfigurationUnchanged:true,workspace:root,commit:git('rev-parse','HEAD'),artifact,executable,scopedLockSha256:hash(lock),importerIds:['.'],sourceMounts:[],sourceHashes:{'package.json':hash(manifest),'pnpm-lock.yaml':hash(lock)},manifestHashes:{'.':hash(manifest)}};
 return{root,bin,held,body,marker,receipt};
}
const run=f=>runWorkspaceSelection({receipt:f.receipt,arguments:['fixture']});
const mode=async p=>(await stat(p)).mode&0o777;
test('observed PNPM0700 to0755 normalization restores exact restrictive source mode',async t=>{const f=await fixture(t);await run(f);assert.equal(await mode(f.bin),0o700);assert.deepEqual(await readFile(f.bin),f.body);});
test('PNPM0755 normalization restores non-executable original mode too',async t=>{const f=await fixture(t,{before:0o600});await run(f);assert.equal(await mode(f.bin),0o600);});
test('unexpected non-execute changes retain numeric refusal without chmod',async t=>{const f=await fixture(t,{after:0o777});await assert.rejects(run(f),/before 0700, after 0777/);assert.equal(await mode(f.bin),0o777);});
test('changed source bytes cannot earn normalization or restoration',async t=>{const f=await fixture(t,{changedBytes:true});await assert.rejects(run(f),/source bin changed during installation/);assert.equal(await readFile(f.bin,'utf8'),'changed source');assert.equal(await mode(f.bin),0o755);});
for(const redirect of ['file','ancestor']){
 test('initial '+redirect+' redirection refuses before producer invocation',async t=>{const f=await fixture(t,{initialRedirect:redirect});await assert.rejects(run(f),/source carrier is redirected or not regular/);await assert.rejects(access(f.marker),{code:'ENOENT'});assert.equal(await mode(f.held),0o755);assert.deepEqual(await readFile(f.held),f.body);});
 test('post-command '+redirect+' redirection refuses before restoring outside modes',async t=>{const f=await fixture(t,{postRedirect:redirect});await assert.rejects(run(f),/source carrier is redirected or not regular/);assert.equal(await mode(f.held),0o755);assert.deepEqual(await readFile(f.held),f.body);});
}
test('failed producer still restores exact source mode while retaining its exit failure',async t=>{const f=await fixture(t,{exitCode:7});await assert.rejects(run(f),e=>e.exitCode===7);assert.equal(await mode(f.bin),0o700);});
