import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,chmod,rm,symlink,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runWorkspaceSelection} from '../src/install-workspace-selection.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,extra=''){
 const root=await mkdtemp(join(tmpdir(),'selected-deploy-receipt-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const workspace=join(root,'source'),artifact=join(root,'state'),output=join(root,'output');await mkdir(workspace);await mkdir(artifact);
 const git=(...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-C',workspace,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}).trim();
 git('init','-q');const manifest='{ "name": "fixture", "version": "1.0.0" }\n';await writeFile(join(workspace,'package.json'),manifest);await writeFile(join(workspace,'pnpm-lock.yaml'),'source lock\n');git('add','.');git('commit','-qm','source');await writeFile(join(artifact,'pnpm-lock.yaml'),'selected lock\n');
 const executable=join(artifact,'pnpm-fixture'),marker=join(artifact,'ran');
 await writeFile(executable,'#!'+process.execPath+'\n'+`const fs=require('node:fs'),p=${JSON.stringify(output)};fs.writeFileSync(${JSON.stringify(marker)},'ran');fs.mkdirSync(p);fs.writeFileSync(p+'/package.json','{"name":"fixture","version":"1.0.0","dependencies":{}}\\n');fs.writeFileSync(p+'/pnpm-lock.yaml','portable lock\\n');${extra}\n`);await chmod(executable,0o755);
 const receipt={type:'NodeRuntimeWorkspaceSelectionInstallReceipt',version:1,status:'installed',sourceConfigurationUnchanged:true,workspace,commit:git('rev-parse','HEAD'),artifact,executable,sourceMounts:[],importerIds:['.'],manifestHashes:{'.':hash(manifest)},sourceHashes:{'package.json':hash(manifest),'pnpm-lock.yaml':hash('source lock\n')},scopedLockSha256:hash('selected lock\n')};
 const args=['--filter','fixture','--config.ignore-scripts=true','--config.inject-workspace-packages=true','deploy','--prod',output];return{root,workspace,artifact,output,marker,receipt,args};
}
const run=f=>runWorkspaceSelection({receipt:f.receipt,arguments:f.args,deployOutput:f.output});
test('exact deploy command receives observed regular root products and optional absence',async t=>{const f=await fixture(t);const r=await run(f);assert.equal(r.produced.directory,f.output);assert.deepEqual(r.produced.files,[{path:'package.json',sha256:hash(await readFile(join(f.output,'package.json')))},{path:'pnpm-lock.yaml',sha256:hash('portable lock\n')},{path:'pnpm-workspace.yaml',sha256:null}]);assert.equal(r.commit,f.receipt.commit);});
test('present PNPM workspace policy has its own observed bytes',async t=>{const f=await fixture(t,"fs.writeFileSync(p+'/pnpm-workspace.yaml','allowBuilds: {}\\n');");assert.equal((await run(f)).produced.files[2].sha256,hash('allowBuilds: {}\n'));});
test('generic command receipt remains byte-shape compatible without deploy observation',async t=>{const f=await fixture(t);const r=await runWorkspaceSelection({receipt:f.receipt,arguments:['inert-command']});assert.equal(r.produced,undefined);assert.deepEqual(Object.keys(r).sort(),['arguments','commit','executable','sourceConfigurationUnchanged','type','version'].sort());});
test('different invocation refuses before running the producer',async t=>{const f=await fixture(t);f.args[1]='another-root';await assert.rejects(run(f),/exact selected deploy invocation/);await assert.rejects(access(f.marker),{code:'ENOENT'});});
test('existing output refuses before invocation and is retained',async t=>{const f=await fixture(t);await mkdir(f.output);await writeFile(join(f.output,'retained'),'retain');await assert.rejects(run(f),/already exists/);assert.equal(await readFile(join(f.output,'retained'),'utf8'),'retain');await assert.rejects(access(f.marker),{code:'ENOENT'});});
test('redirected output parent refuses before invocation',async t=>{const f=await fixture(t);const parent=join(f.root,'redirect');await symlink(f.artifact,parent);f.output=join(parent,'output');f.args[f.args.length-1]=f.output;await assert.rejects(run(f),/canonical parent/);await assert.rejects(access(f.marker),{code:'ENOENT'});});
test('metadata symlink is refused instead of following matching bytes',async t=>{const f=await fixture(t,"fs.renameSync(p+'/package.json',p+'/held');fs.symlinkSync('held',p+'/package.json');");await assert.rejects(run(f),/regular nonredirected/);});
test('missing mandatory lock cannot earn produced metadata',async t=>{const f=await fixture(t,"fs.unlinkSync(p+'/pnpm-lock.yaml');");await assert.rejects(run(f),{code:'ENOENT'});});
test('source changes during deployment still refuse after output observation',async t=>{const f=await fixture(t);const script=await readFile(f.receipt.executable,'utf8');await writeFile(f.receipt.executable,script+`fs.writeFileSync(${JSON.stringify(join(f.workspace,'package.json'))},'{}');\n`);await assert.rejects(run(f),/source configuration changed/);});

test('nonzero producer exit cannot earn a receipt even when metadata was written',async t=>{const f=await fixture(t,'process.exit(7);');await assert.rejects(run(f),error=>error.exitCode===7);assert.equal(await readFile(join(f.output,'pnpm-lock.yaml'),'utf8'),'portable lock\n');});
