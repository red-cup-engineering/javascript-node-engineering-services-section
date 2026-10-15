import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { createJavascriptNodeOperation, runJavascriptNodeOperation, runJavascriptNodeOperationCatalog, runJavascriptNodeOperationModule } from '../src/operation.mjs';
const definition = { name: 'double', description: 'Double a number.', inputSchema: {type:'number'}, outputSchema: {type:'number'}, operation: n => n * 2 };
function streams(chunks, args = []) {
  let text = '';
  return {arguments:args, standardInput:Readable.from(chunks), standardOutput:new Writable({write(chunk, _, done) {text += chunk;done();}}), text:()=>text};
}
test('shared types guard both boundaries before and after effects', async () => {
  let calls = 0;
  const operation = createJavascriptNodeOperation({...definition, operation: n => {calls++;return n;}});
  assert.equal((await operation.invoke('2')).refusal.reason,'InvalidInput');
  assert.equal(calls,0);
  assert.deepEqual(await operation.invoke(2),{ok:true,value:2});
  assert.equal(calls,1);
  const wrong = createJavascriptNodeOperation({...definition,operation:()=> '2'});
  assert.equal((await wrong.invoke(2)).refusal.reason,'InvalidOutput');
  assert.equal((await createJavascriptNodeOperation({...definition,inputSchema:false}).invoke(2)).ok,false);
});
test('NDJSON continues after refusals and handles fragmented UTF8 and final records', async () => {
  const bytes = Buffer.from('"🌲"\r\ninvalid\n"next"');
  const io=streams([bytes.subarray(0,3),bytes.subarray(3,6),bytes.subarray(6)]);
  const result=await runJavascriptNodeOperation({name:'echo',description:'Echo',inputSchema:{type:'string'},outputSchema:{type:'string'},operation:s=>s},io);
  assert.deepEqual(result,{exitCode:2,processed:3,refused:1});
  const rows=io.text().trim().split('\n').map(JSON.parse);
  assert.equal(rows[0],'🌲');assert.equal(rows[1].refusal.reason,'SyntaxError');assert.equal(rows[2],'next');
});
test('command refuses non-JSON outputs and reports handler errors', async () => {
  for (const [operation, reason] of [[()=>undefined,'InvalidJsonOutput'],[()=>{throw new RangeError('bad');},'RangeError']]) {
    const io=streams(['null\n']);
    assert.equal((await runJavascriptNodeOperation({name:'failure',description:'Failure',operation},io)).exitCode,2);
    assert.equal(JSON.parse(io.text()).refusal.reason,reason);
  }
});
test('catalog dispatch uses the same contracts and help consumes no input', async () => {
  const catalog={name:'math',description:'Math',operations:{double:createJavascriptNodeOperation(definition)}};
  const io=streams(['3\n"3"\n'],['double']);
  assert.deepEqual(await runJavascriptNodeOperationCatalog(catalog,io),{exitCode:2,processed:2,refused:1});
  assert.equal(JSON.parse(io.text().split('\n')[0]),6);
  const unknown=streams([],['toString']);
  assert.equal((await runJavascriptNodeOperationCatalog(catalog,unknown)).exitCode,2);
  const help=streams([],['--help']);
  help.standardInput={async *[Symbol.asyncIterator](){throw Error('must not read');}};
  assert.equal((await runJavascriptNodeOperationCatalog(catalog,help)).exitCode,0);
  assert.match(help.text(),/double/);
});
test('output failure propagates without attempting a second write', async () => {
  let writes=0;
  const io=streams(['2\n']);
  io.standardOutput=new Writable({write(_,__,done){writes++;done(new Error('closed'));}});
  io.standardOutput.on('error',()=>{});
  await assert.rejects(runJavascriptNodeOperation(definition,io),/closed/);
  assert.equal(writes,1);
});


test('one Code executor drives a Data declaration without rereading stdin', async () => {
  const module = await import('@red-cup-engineering/json-services-section/differentiate-data');
  const io = streams(['invalid\n' + JSON.stringify({ before: { name: 'old' }, after: { name: 'new' } }) + '\n']);
  await runJavascriptNodeOperationModule(module, io);
  const rows = io.text().trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ok, false);
  assert.deepEqual(rows[1], [{ path: 'name', kind: 'changed', before: 'old', after: 'new' }]);
});

test('a module declares exactly one runnable face', async () => {
  await assert.rejects(runJavascriptNodeOperationModule({}, streams([])), /exactly one of operation, catalog or command/);
  await assert.rejects(runJavascriptNodeOperationModule({ operation: definition, command: { run() {} } }, streams([])), /declares operation, command/);
});

test('a command declaration settles its exit status from its result or its error', async () => {
  let errors = '';
  const io = { ...streams([], ['a']), standardError: new Writable({ write(chunk, _, done) { errors += chunk; done(); } }) };
  assert.deepEqual(await runJavascriptNodeOperationModule({ command: { run: ({ argv }) => argv.length, formatResult: (n) => `${n}\n`, resultExitCode: (n) => n - 1 } }, io), { exitCode: 0 });
  assert.equal(io.text(), '1\n');
  assert.deepEqual(await runJavascriptNodeOperationModule({ command: { run() { throw new Error('nope'); }, exitCode: 64 } }, io), { exitCode: 64 });
  assert.equal(errors, 'nope\n');
});
