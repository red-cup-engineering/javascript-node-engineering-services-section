// Source-derived from Guix packageReceivingEnvironment and runTests. See the
// extraction record. This internal module is not a package command interface.
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {delimiter,dirname} from 'node:path';
import {receivingProcessGroup} from './node-test-process-group.mjs';

export const TEST_TIMEOUT_MS=180000;
export const TEST_OUTPUT_BYTES=64*1024*1024;
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function packageReceivingEnvironment(node,parent=process.env){
  const environment={PATH:dirname(node)+delimiter+(parent.PATH??''),NODE_OPTIONS:'--max-old-space-size=384'};
  for(const key of ['TMPDIR','TMP','TEMP','LANG','LC_ALL','TZ'])
    if(parent[key]!==undefined)environment[key]=parent[key];
  return environment;
}

export function currentReceivingNode(){
  const executable=realpathSync(process.execPath);
  if(!lstatSync(executable).isFile())throw new TypeError('current Node executable is not a regular file');
  const result=spawnSync(executable,['--version'],{encoding:'utf8',env:packageReceivingEnvironment(executable),timeout:10000,maxBuffer:1024*1024,killSignal:'SIGKILL'});
  if(result.error||result.status!==0||result.signal||result.stdout.trim()!==process.version)
    throw new Error('current Node executable version differs from invoking runtime');
  return {executable,version:process.version,sha256:sha256(readFileSync(executable))};
}

export function summarizeNodeTap(stdout,file){
  const counters={};
  for(const field of ['tests','suites','pass','fail','cancelled','skipped','todo']){
    const matches=[...stdout.matchAll(new RegExp('^# '+field+' (\\d+)\\r?$','gm'))];
    if(matches.length!==1)return {valid:false,reason:'missing or ambiguous Node TAP summary'};
    counters[field]=Number(matches[0][1]);
  }
  if(!/^TAP version 13\r?$/m.test(stdout)||!/^1\.\.\d+\r?$/m.test(stdout)||/^Bail out!/m.test(stdout)||
      counters.tests!==counters.pass+counters.fail+counters.cancelled+counters.skipped+counters.todo)
    return {valid:false,reason:'inconsistent Node TAP summary',...counters};
  const subtests=[...stdout.matchAll(/^# Subtest: (.*)\r?$/gm)].map(match=>match[1]);
  // Node represents an empty file as a passing file-named test. It is not an
  // authored case. An identically named lone authored case is conservatively
  // unsatisfied too; use a meaningful case name in reviewed receiving suites.
  const filePlaceholder=counters.tests===1&&counters.suites===0&&subtests.length===1&&subtests[0]===file;
  return {valid:true,...counters,executed:filePlaceholder?0:counters.tests-counters.skipped-counters.todo,filePlaceholder};
}

export function classifyNodeTest(result,file){
  const stdout=result.stdout??'',stderr=result.stderr??'',error=result.error?{name:result.error.name,code:result.error.code??null,message:result.error.message}:null;
  const tap=summarizeNodeTap(stdout,file);
  let status='passed';
  if(result.cancelled)status='cancelled';
  else if(error?.code==='ETIMEDOUT')status='timeout';
  else if(error?.code==='ENOBUFS')status='output-limit';
  else if(error?.code==='ECLEANUP')status='cleanup-error';
  else if(error)status='spawn-error';
  else if(result.signal)status='signalled';
  else if(result.status!==0||!tap.valid||tap.fail||tap.cancelled||/^not ok\b/m.test(stdout))status='failed';
  else if(!tap.executed)status='unsatisfied';
  return {status,executed:result.pid>0,exitCode:result.status??null,signal:result.signal??null,timedOut:status==='timeout',cancelled:Boolean(result.cancelled),error,stdout,stderr,tap};
}

// Every test has its own Linux process group. Killing only the leader can leave
// CLI children/listeners alive. Group termination also runs on normal leader exit
// to remove unref'd children before collecting close. Reviewed tests must not
// escape their group; this lifecycle contract is not adversarial sandboxing.
// The second argument is an internal resource/lifecycle test seam, not exposed
// by receivePackedPackages or its CLI.
export async function runReceivingTest({file,directory,node,environment},{timeoutMs=TEST_TIMEOUT_MS,maxOutputBytes=TEST_OUTPUT_BYTES,signal,observeGroup=receivingProcessGroup}={}){
  if(process.platform!=='linux')throw new Error('packed receiving requires observable Linux process-group cleanup');
  return new Promise(resolve=>{
    let child,group,closure,timer,closeTimer,error,cancelled=false,bytes=0,spawned=false,cleanupError,finished=false;
    const stdout=[],stderr=[];
    const cleanupFault=cause=>Object.assign(cause,{code:'ECLEANUP'});
    const kill=()=>{
      if(!spawned||!Number.isSafeInteger(child.pid)||child.pid<=0)return;
      try{
        if(group){
          group.terminate();
          // Start before pipe close: a surviving descendant may still hold a
          // capture pipe while forking. Bounded closure reterminates live owners.
          closure??=group.receiveClosure().catch(cause=>{cleanupError=cleanupFault(cause);});
        }
        // If group identity admission failed, only the subprocess handle still
        // held by this caller may be terminated. No unbound group is signalled.
        else child.kill('SIGKILL');
      }catch(cause){cleanupError=cleanupFault(cause);}
      closeTimer??=setTimeout(()=>{
        cleanupError??=cleanupFault(new Error('test leader/pipe closure was not established'));
        child.stdout.destroy();child.stderr.destroy();child.unref();
        void finish(child.exitCode,child.signalCode);
      },5000);
    };
    const stop=(code,message)=>{error??=Object.assign(new Error(message),{code});kill();};
    const cancel=()=>{cancelled=true;stop('ECANCELED','receiving test cancelled');};
    const collect=chunks=>chunk=>{
      const remaining=Math.max(0,maxOutputBytes-bytes);
      if(remaining)chunks.push(chunk.subarray(0,remaining));
      bytes+=chunk.length;
      if(bytes>maxOutputBytes)stop('ENOBUFS','receiving test exceeded output bound');
    };
    try{child=spawn(node,['--test','--test-reporter=tap',file],{cwd:directory,env:environment,detached:true,stdio:['ignore','pipe','pipe']});}
    catch(cause){resolve(classifyNodeTest({error:cause},file));return;}
    process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
    signal?.addEventListener('abort',cancel,{once:true});
    child.once('spawn',()=>{
      spawned=true;
      try{group=observeGroup(child.pid);}
      catch(cause){cleanupError=cleanupFault(cause);kill();return;}
      if(cancelled||signal?.aborted){cancel();return;}
      timer=setTimeout(()=>stop('ETIMEDOUT','receiving test exceeded '+timeoutMs+'ms'),timeoutMs);
    });
    child.stdout.on('data',collect(stdout));child.stderr.on('data',collect(stderr));
    child.once('error',cause=>{error??=cause;kill();});
    child.once('exit',kill);
    async function finish(status,exitSignal){
      if(finished)return;finished=true;
      clearTimeout(timer);kill();clearTimeout(closeTimer);
      let cleanup;
      if(closure)cleanup=await closure;
      if(cleanupError)cleanup={status:'unknown',message:cleanupError.message};
      process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
      signal?.removeEventListener('abort',cancel);
      resolve({...classifyNodeTest({pid:spawned?child.pid:undefined,status,signal:exitSignal,error:cleanupError??error,cancelled,
        stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')},file),cleanup});
    }
    child.once('close',(status,exitSignal)=>{void finish(status,exitSignal);});
  });
}
