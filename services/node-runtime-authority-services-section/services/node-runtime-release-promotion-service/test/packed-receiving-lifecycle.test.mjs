import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {packageReceivingEnvironment,runReceivingTest} from '../src/bounded-node-test.mjs';
import {receivingProcessGroup,terminalGroupMember} from '../src/node-test-process-group.mjs';

function live(pid){
  try{
    process.kill(pid,0);
    // A dead, adopted zombie cannot run or own a listening socket. The OS's
    // parent reaper, not a non-parent Node process, owns waitpid for that state.
    if(process.platform==='linux'&&/^\d+ \(.*\) Z /.test(readFileSync('/proc/'+pid+'/stat','utf8')))return false;
    return true;
  }catch(error){if(error.code==='ESRCH'||error.code==='ENOENT')return false;throw error;}
}
async function noListener(port){
  await new Promise((resolve,reject)=>{
    const socket=connect({host:'127.0.0.1',port});
    socket.once('connect',()=>{socket.destroy();reject(new Error('owned listener survived receiving'));});
    socket.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));
  });
}
function setup(t,{hang=true,overflow=false}={}){
  const directory=mkdtempSync(join(tmpdir(),'receiving-lifecycle-')),pidfile=join(directory,'child.json'),file=join(directory,'check.mjs');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const childSource=`import {createServer} from 'node:net';import {writeFileSync} from 'node:fs';const server=createServer();server.listen(0,'127.0.0.1',()=>writeFileSync(${JSON.stringify(pidfile)},JSON.stringify({pid:process.pid,port:server.address().port})));`;
  const body=`import {test} from 'node:test';import {spawn} from 'node:child_process';import {existsSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';test('offline child lifecycle',async()=>{const child=spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(childSource)}],{stdio:'ignore'});child.unref();while(!existsSync(${JSON.stringify(pidfile)}))await delay(10);${overflow?"setInterval(()=>console.log('x'.repeat(10000)),10);":''}${hang?'await new Promise(()=>setInterval(()=>{},100));':''}});`;
  writeFileSync(file,body);
  t.after(()=>{if(existsSync(pidfile)){const {pid}=JSON.parse(readFileSync(pidfile));if(live(pid))process.kill(pid,'SIGKILL');}});
  return {directory,file,pidfile,node:process.execPath,environment:packageReceivingEnvironment(process.execPath)};
}
async function assertClean(f){
  assert.equal(existsSync(f.pidfile),true,'fixture reached child listener before interruption');
  const child=JSON.parse(readFileSync(f.pidfile));
  for(let i=0;i<100&&live(child.pid);i++)await delay(10);
  assert.equal(live(child.pid),false,'no live owned child remains');await noListener(child.port);
}

test('timeout kills only the test group including its live child listener',async t=>{
  const f=setup(t),sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  t.after(()=>sentinel.kill('SIGKILL'));
  const r=await runReceivingTest(f,{timeoutMs:1500});assert.equal(r.status,'timeout');assert.equal(r.timedOut,true);assert.equal(r.signal,'SIGKILL');
  await assertClean(f);assert.equal(live(sentinel.pid),true,'unrelated sibling process is untouched');
});
test('cancellation kills the owned group and returns collected status',async t=>{
  const f=setup(t),controller=new AbortController(),pending=runReceivingTest(f,{timeoutMs:5000,signal:controller.signal});
  for(let i=0;i<200&&!existsSync(f.pidfile);i++)await delay(10);
  assert.equal(existsSync(f.pidfile),true);controller.abort();
  const r=await pending;assert.equal(r.status,'cancelled');assert.equal(r.cancelled,true);assert.equal(r.signal,'SIGKILL');await assertClean(f);
});
test('successful file exit also removes unref child listeners',async t=>{
  const f=setup(t,{hang:false}),r=await runReceivingTest(f,{timeoutMs:5000});
  assert.equal(r.status,'passed',JSON.stringify(r));await assertClean(f);
});
test('bounded output failure removes all owned children',async t=>{
  const f=setup(t,{overflow:true}),r=await runReceivingTest(f,{timeoutMs:5000,maxOutputBytes:4096});
  assert.equal(r.status,'output-limit');assert.ok(Buffer.byteLength(r.stdout)+Buffer.byteLength(r.stderr)<=4096);await assertClean(f);
});
test('SIGTERM cancellation is handled without leaving test children',async t=>{
  const f=setup(t),wrapper=join(f.directory,'runner.mjs');
  writeFileSync(wrapper,`import {runReceivingTest} from ${JSON.stringify(new URL('../src/bounded-node-test.mjs',import.meta.url).href)};const result=await runReceivingTest(${JSON.stringify(f)});process.stdout.write(JSON.stringify(result));`);
  const runner=spawn(process.execPath,[wrapper],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(live(runner.pid))runner.kill('SIGKILL');});
  let stdout='',stderr='';runner.stdout.on('data',chunk=>{stdout+=chunk;});runner.stderr.on('data',chunk=>{stderr+=chunk;});
  const closed=new Promise(resolve=>runner.once('close',(code,signal)=>resolve({code,signal})));
  for(let i=0;i<200&&!existsSync(f.pidfile);i++)await delay(10);
  assert.equal(existsSync(f.pidfile),true);runner.kill('SIGTERM');
  const exit=await closed;assert.equal(exit.code,0,stderr);assert.equal(JSON.parse(stdout).status,'cancelled');await assertClean(f);
});

test('mixed zombie leader/live sibling observation is not terminal',()=>{
  // Exact reproduced shape: leader Z, num_threads=2, sibling R. The kernel has
  // not yet released the shared descriptor table. A lone retained zombie is safe.
  assert.equal(terminalGroupMember({state:'Z',threads:2}),false);
  assert.equal(terminalGroupMember({state:'R',threads:1}),false);
  assert.equal(terminalGroupMember({state:'Z',threads:1}),true);
  assert.equal(terminalGroupMember({state:'X',threads:1}),true);
  assert.equal(terminalGroupMember({state:'Z',threads:undefined}),false);
});
test('repeated successful exits receive every thread before returning',async t=>{
  for(let index=0;index<30;index++){
    const f=setup(t,{hang:false}),r=await runReceivingTest(f,{timeoutMs:5000});
    assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.cleanup.status,'terminated');assert.equal(r.cleanup.liveTasks,0);
    await assertClean(f);
  }
});

test('concurrent receiving groups terminate only their own children',async t=>{
  for(let round=0;round<5;round++)await Promise.all(Array.from({length:4},async()=>{
    const f=setup(t,{hang:false}),r=await runReceivingTest(f,{timeoutMs:5000});
    assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.cleanup.liveTasks,0);await assertClean(f);
  }));
});

test('unavailable group admission becomes cleanup-unknown without escaping callback',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'receiving-group-unknown-')),file=join(directory,'check.mjs');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));writeFileSync(file,"import {test} from 'node:test';test('case',()=>{});");
  const r=await runReceivingTest({directory,file,node:process.execPath,environment:packageReceivingEnvironment(process.execPath)},
    {observeGroup(){throw Object.assign(new Error('simulated unreadable lifecycle identity'),{code:'EACCES'});}});
  assert.equal(r.status,'cleanup-error');assert.equal(r.cleanup.status,'unknown');assert.equal(r.error.code,'ECLEANUP');
});

test('cleanup reterminates a descendant forked after incomplete initial delivery, before pipe close',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'receiving-fork-cleanup-')),file=join(directory,'check.mjs'),
    ready=join(directory,'ready'),trigger=join(directory,'cleanup-started'),pidfile=join(directory,'late-child.json');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const listener=`import {createServer} from 'node:net';import {writeFileSync} from 'node:fs';const server=createServer();server.listen(0,'127.0.0.1',()=>writeFileSync(${JSON.stringify(pidfile)},JSON.stringify({pid:process.pid,port:server.address().port})));`;
  const forker=`import {spawn} from 'node:child_process';import {existsSync,writeFileSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';writeFileSync(${JSON.stringify(ready)},'ready');while(!existsSync(${JSON.stringify(trigger)}))await delay(5);spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(listener)}],{stdio:'inherit'});`;
  writeFileSync(file,`import {test} from 'node:test';import {spawn} from 'node:child_process';test('fork during cleanup',async()=>{spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(forker)}],{stdio:'inherit'});await new Promise(()=>{});});`);
  const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  t.after(()=>sentinel.kill('SIGKILL'));
  let calls=0,group;
  t.after(()=>{if(group)try{process.kill(-group,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}});
  const controller=new AbortController(),pending=runReceivingTest({directory,file,node:process.execPath,environment:packageReceivingEnvironment(process.execPath)},
    {signal:controller.signal,timeoutMs:5000,observeGroup(pid){
      group=pid;
      return receivingProcessGroup(pid,{signalGroup(target,signal){
        calls++;assert.equal(target,-pid);assert.equal(signal,'SIGKILL');
        // Deliberately emulate incomplete first group delivery, then permit a
        // real owned descendant to fork while cleanup is active and pipes open.
        if(calls===1){process.kill(pid,signal);writeFileSync(trigger,'cleanup');return;}
        if(existsSync(pidfile))process.kill(target,signal);
      }});
    }});
  for(let i=0;i<200&&!existsSync(ready);i++)await delay(10);
  assert.equal(existsSync(ready),true);controller.abort();
  const r=await pending;
  assert.ok(calls>1,'live owned membership is signalled again');assert.equal(r.status,'cancelled',JSON.stringify(r));
  assert.equal(r.cleanup.status,'terminated',JSON.stringify(r));assert.equal(r.cleanup.liveTasks,0);
  await assertClean({pidfile});assert.equal(live(sentinel.pid),true,'unrelated sibling survives');
});
