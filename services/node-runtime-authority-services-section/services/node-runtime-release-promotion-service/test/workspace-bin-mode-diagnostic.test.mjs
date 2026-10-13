import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runWorkspaceSelection} from '../src/install-workspace-selection.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(root,...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}).trim();
async function fixture(t,before,after){
 const temp=await mkdtemp(join(tmpdir(),'source-bin-mode-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=join(temp,'source'),artifact=join(temp,'state');await mkdir(root);await mkdir(artifact);git(root,'init','-q');
 const manifest=Buffer.from(JSON.stringify({name:'fixture',version:'1.0.0',bin:{fixture:'bin.mjs'}})),lock=Buffer.from('lockfileVersion: 9.0\n'),body=Buffer.from('// genuine command fixture does not execute this bin\n');
 await writeFile(join(root,'package.json'),manifest);await writeFile(join(root,'pnpm-lock.yaml'),lock);await writeFile(join(root,'bin.mjs'),body);await chmod(join(root,'bin.mjs'),before);git(root,'add','.');git(root,'commit','-qm','fixture');
 await writeFile(join(artifact,'pnpm-lock.yaml'),lock);const executable=join(artifact,'pnpm-fixture');await writeFile(executable,'#!'+process.execPath+'\n'+`require('node:fs').chmodSync(${JSON.stringify(join(root,'bin.mjs'))},${after});\n`);await chmod(executable,0o755);
 const receipt={type:'NodeRuntimeWorkspaceSelectionInstallReceipt',version:1,status:'installed',sourceConfigurationUnchanged:true,workspace:root,commit:git(root,'rev-parse','HEAD'),artifact,executable,scopedLockSha256:hash(lock),importerIds:['.'],sourceMounts:[],sourceHashes:{'package.json':hash(manifest),'pnpm-lock.yaml':hash(lock)},manifestHashes:{'.':hash(manifest)}};return{root,body,receipt};
}
test('non-executable mode change retains exact before and after evidence without accepting it',async t=>{const f=await fixture(t,0o664,0o755);await assert.rejects(runWorkspaceSelection({receipt:f.receipt,arguments:['fixture']}),/source bin permissions changed beyond executable bits: .*\(before 0664, after 0755\)/);assert.equal((await stat(join(f.root,'bin.mjs'))).mode&0o777,0o755);assert.deepEqual(await readFile(join(f.root,'bin.mjs')),f.body);});
test('existing execute-bit-only restoration remains unchanged',async t=>{const f=await fixture(t,0o644,0o755);await runWorkspaceSelection({receipt:f.receipt,arguments:['fixture']});assert.equal((await stat(join(f.root,'bin.mjs'))).mode&0o777,0o644);});
