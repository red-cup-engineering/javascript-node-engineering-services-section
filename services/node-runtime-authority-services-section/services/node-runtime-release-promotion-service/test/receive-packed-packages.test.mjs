import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {receivePackedPackages} from '../src/receive-packed-packages.mjs';
import {readPackedWorkspacePackages} from '../src/packed-workspace-packages.mjs';
import {classifyNodeTest,packageReceivingEnvironment,runReceivingTest,summarizeNodeTap,TEST_TIMEOUT_MS,TEST_OUTPUT_BYTES} from '../src/bounded-node-test.mjs';

const pass="import {test} from 'node:test'; test('authored case',()=>{});\n";
function write(path,body){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);}
function json(path,value){write(path,JSON.stringify(value,null,2)+'\n');}
function fixture(t,{selection=['one','two'],tests=[pass,pass],fixtures=['fixture.json'],nested=false}={}){
  const base=mkdtempSync(join(tmpdir(),'packed-receiving-')),workspace=join(base,'source'),runtime=join(base,'packed'),marker=join(base,'effects');
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const root={name:'consumer',version:'1.0.0',type:'module',packageManager:'pnpm@10.0.0',...(selection===undefined?{}:{receivingPackages:selection})};
  json(join(workspace,'package.json'),root);write(join(workspace,'pnpm-workspace.yaml'),"packages:\n  - 'packages/*'\n");write(join(workspace,'pnpm-lock.yaml'),"lockfileVersion: '9.0'\n");
  const directories={};
  for(const [i,name] of ['one','two','unused'].entries()){
    const source=join(workspace,'packages',name),directory=nested?join(runtime,'node_modules/.pnpm',name+'@1.0.0/node_modules',name):join(runtime,'node_modules',name);
    directories[name]=directory;
    json(join(source,'package.json'),{name,version:'1.0.0',type:'module',receivingTests:['test/check.mjs'],receivingFixtures:fixtures,
      scripts:{test:'node should-never-run.mjs'}});
    write(join(source,'test/check.mjs'),name==='unused'?"throw new Error('unselected code executed');":tests[i]);
    write(join(source,'should-never-run.mjs'),"throw new Error('npm hook executed');");
    for(const file of fixtures)write(join(source,file),'{}\n');
    cpSync(source,directory,{recursive:true});
    if(nested){const alias=join(runtime,'node_modules',name);symlinkSync(relative(dirname(alias),directory),alias);}
  }
  json(join(runtime,'package.json'),root);
  const pnpm=join(base,'pnpm');write(pnpm,`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]==='--version')console.log('10.0.0');else console.log(JSON.stringify(['.','packages/one','packages/two','packages/unused'].map(p=>({path:require('node:path').resolve(process.cwd(),p)}))));\n`);chmodSync(pnpm,0o755);
  const git=(...args)=>execFileSync('git',['-C',workspace,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
  const commit=()=>{git('add','.');git('commit','-qm','fixture');};commit();
  return {base,workspace,runtime,pnpm,directories,marker,git,commit,options:{workspace,runtime,pnpm}};
}
async function refused(f,pattern){
  await assert.rejects(receivePackedPackages(f.options),error=>{
    assert.match(error.message,pattern);assert.equal(error.result.status,'refused');assert.equal(error.result.satisfied,false);return true;
  });
}

// PR-01..05, PR-12: real source admission and explicit native placement.
test('only selected owned tests execute in order; hooks and unrelated tests never execute',async t=>{
  const f=fixture(t,{nested:true}),r=await receivePackedPackages(f.options);
  assert.equal(r.status,'received');assert.equal(r.satisfied,true);assert.equal(r.enrolled,2);assert.equal(r.executedFiles,2);assert.equal(r.executedCases,2);
  assert.deepEqual(r.packages.map(p=>p.name),['one','two']);assert.equal(r.packages[0].tests[0].status,'passed');
  assert.equal(r.node.executable,execFileSync('realpath',[process.execPath],{encoding:'utf8'}).trim());assert.equal(r.node.version,process.version);
  assert.equal(readPackedWorkspacePackages(f.runtime).packages.filter(p=>p.manifest.name==='one').length,1);
});
for(const selection of [[],undefined])test('empty/missing selection stays explicitly unenrolled '+String(selection),async t=>{
  const f=fixture(t,{selection:[]});if(selection===undefined){for(const root of [f.workspace,f.runtime]){const p=join(root,'package.json'),m=JSON.parse(readFileSync(p));delete m.receivingPackages;json(p,m);}f.commit();}
  const r=await receivePackedPackages(f.options);assert.equal(r.status,'not-enrolled');assert.equal(r.satisfied,false);assert.equal(r.enrolled,0);assert.equal(r.executedFiles,0);
});
for(const selection of [null,'one',['one','one'],['unknown'],['../one']])test('selection refuses before execution '+JSON.stringify(selection),async t=>{
  const f=fixture(t,{selection});await refused(f,/receivingPackages|source owner/);
});
test('packed root cannot edit selection',async t=>{
  const f=fixture(t),file=join(f.runtime,'package.json'),m=JSON.parse(readFileSync(file));m.receivingPackages=['unused'];json(file,m);await refused(f,/receivingPackages/);
});
for(const fault of ['manifest','test','fixture','missing-fixture','null-tests','source-dirty','symlink-test','symlink-fixture','source-symlink','source-duplicate','packed-duplicate','escape'])test('complete preflight refuses '+fault+' before first effect',async t=>{
  const f=fixture(t);const first=`import {test} from 'node:test'; import {writeFileSync} from 'node:fs'; test('first effect',()=>writeFileSync(${JSON.stringify(f.marker)},'bad'));`;
  for(const root of [join(f.workspace,'packages/one'),f.directories.one])write(join(root,'test/check.mjs'),first);
  f.commit();
  const source=join(f.workspace,'packages/two'),packed=f.directories.two;
  if(fault==='manifest'){const file=join(packed,'package.json'),m=JSON.parse(readFileSync(file));m.version='2.0.0';json(file,m);}
  if(fault==='test')write(join(packed,'test/check.mjs'),pass+'// changed');
  if(fault==='fixture')write(join(packed,'fixture.json'),'different');
  if(fault==='missing-fixture')rmSync(join(packed,'fixture.json'));
  if(fault==='null-tests'){for(const root of [source,packed]){const p=join(root,'package.json'),m=JSON.parse(readFileSync(p));m.receivingTests=null;json(p,m);}f.commit();}
  if(fault==='source-dirty')write(join(source,'test/check.mjs'),pass+'// dirty');
  if(fault==='symlink-test'){rmSync(join(packed,'test/check.mjs'));symlinkSync('../../one/test/check.mjs',join(packed,'test/check.mjs'));}
  if(fault==='symlink-fixture'){rmSync(join(packed,'fixture.json'));symlinkSync('../one/fixture.json',join(packed,'fixture.json'));}
  if(fault==='source-symlink'){rmSync(join(source,'fixture.json'));symlinkSync('../one/fixture.json',join(source,'fixture.json'));f.commit();}
  if(fault==='source-duplicate'){const file=join(f.workspace,'packages/unused/package.json'),m=JSON.parse(readFileSync(file));m.name='two';json(file,m);f.commit();}
  if(fault==='packed-duplicate')cpSync(packed,join(f.runtime,'node_modules/duplicate'),{recursive:true});
  if(fault==='escape'){rmSync(packed,{recursive:true});symlinkSync(source,packed);}
  await assert.rejects(receivePackedPackages(f.options),error=>{assert.equal(error.result.executedFiles,0);return true;});assert.equal(existsSync(f.marker),false);
});

// PR-08..10: case satisfaction is separate from process success; failures stop.
for(const [label,body,status] of [
  ['failure',"import {test} from 'node:test';test('fails',()=>{throw new Error('expected');});",'failed'],
  ['skip',"import {test} from 'node:test';test('skipped',{skip:true},()=>{});",'unsatisfied'],
  ['todo',"import {test} from 'node:test';test('todo',{todo:true},()=>{});",'unsatisfied'],
  ['empty','', 'unsatisfied']])test(label+' cannot satisfy obligation; later files stay unexecuted',async t=>{
  const f=fixture(t,{tests:[body,pass]});await assert.rejects(receivePackedPackages(f.options),error=>{
    assert.equal(error.result.packages[0].tests[0].status,status);assert.equal(error.result.packages[1].tests[0].status,'unexecuted');assert.equal(error.result.executedFiles,1);return true;
  });
});
test('partial skips are explicit and executed cases satisfy',async t=>{
  const body="import {test} from 'node:test';test('pass',()=>{});test('skip',{skip:true},()=>{});";
  const r=await receivePackedPackages(fixture(t,{tests:[body,pass]}).options);assert.equal(r.satisfied,true);assert.equal(r.skippedCases,1);assert.equal(r.executedCases,2);
});
for(const target of ['source','packed','packed-manifest','packed-fixture'])test('post-run '+target+' mutation refuses and stops later tests',async t=>{
  const f=fixture(t);const file=target==='source'?join(f.workspace,'packages/two/fixture.json'):target==='packed'?join(f.directories.two,'should-never-run.mjs'):target==='packed-manifest'?join(f.runtime,'package.json'):join(f.directories.two,'fixture.json');
  const body=`import {test} from 'node:test';import {appendFileSync} from 'node:fs';test('mutates selected identity',()=>appendFileSync(${JSON.stringify(file)},' '));`;
  for(const root of [join(f.workspace,'packages/one'),f.directories.one])write(join(root,'test/check.mjs'),body);f.commit();
  await assert.rejects(receivePackedPackages(f.options),error=>{assert.equal(error.result.refusal.phase,'identity');assert.equal(error.result.packages[1].tests[0].status,'unexecuted');return true;});
});

// PR-06: inherited controls/secrets do not survive into real test processes.
test('sanitized environment admits only prior bounded execution keys',()=>{
  assert.deepEqual(packageReceivingEnvironment('/pinned/node',{PATH:'/bin',HOME:'/secret',TOKEN:'secret',NODE_OPTIONS:'--import evil',NODE_PATH:'/evil',NODE_TEST_CONTEXT:'bad',LANG:'C',TZ:'UTC',TMPDIR:'/tmp'}),
    {PATH:'/pinned:/bin',NODE_OPTIONS:'--max-old-space-size=384',LANG:'C',TZ:'UTC',TMPDIR:'/tmp'});
});
test('real child sees no inherited credentials or Node controls',async t=>{
  const body="import {test} from 'node:test';import assert from 'node:assert/strict';test('environment',()=>{for(const key of ['RECEIVING_SECRET','NODE_PATH','HOME'])assert.equal(process.env[key],undefined);assert.equal(process.env.NODE_OPTIONS,'--max-old-space-size=384');});";
  const f=fixture(t,{tests:[body,pass]}),old=process.env.RECEIVING_SECRET;process.env.RECEIVING_SECRET='do-not-transmit';
  try{assert.equal((await receivePackedPackages(f.options)).status,'received');}finally{if(old===undefined)delete process.env.RECEIVING_SECRET;else process.env.RECEIVING_SECRET=old;}
});

// PR-07: independently derived interrupted outcomes and fixed public bounds.
test('runner distinguishes timeout, signal, spawn/output errors and invalid TAP',()=>{
  assert.equal(TEST_TIMEOUT_MS,180000);assert.equal(TEST_OUTPUT_BYTES,64*1024*1024);
  for(const [result,status] of [[{error:{code:'ETIMEDOUT',message:'timeout'}},'timeout'],[{signal:'SIGKILL'},'signalled'],[{error:{code:'ENOENT',message:'missing'}},'spawn-error'],[{error:{code:'ENOBUFS',message:'large'}},'output-limit'],[{status:0,stdout:''},'failed']])assert.equal(classifyNodeTest(result,'file').status,status);
  assert.equal(summarizeNodeTap('# tests 1\n','file').valid,false);
});
test('real absent executable returns spawn error',async()=>{
  const r=await runReceivingTest({file:'/absent.mjs',directory:tmpdir(),node:'/no-such-receiving-node',environment:{}});assert.equal(r.status,'spawn-error');assert.equal(r.executed,false);assert.equal(r.error.code,'ENOENT');
});
test('public operation and CLI do not accept command/environment overrides',async t=>{
  const f=fixture(t);await assert.rejects(receivePackedPackages({...f.options,command:'npm test'}),/only workspace/);
  const script=new URL('../scripts/receive-packed-packages.mjs',import.meta.url);
  assert.throws(()=>execFileSync(process.execPath,[fileURLToPath(script),'--command','npm test'],{encoding:'utf8'}),error=>{assert.equal(JSON.parse(error.stdout).status,'refused');return true;});
});
