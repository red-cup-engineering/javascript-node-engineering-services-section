import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareSourceDeliverySync } from '../src/source-delivery.mjs';
import { gitSync, gitTextSync } from '../src/git-objects.mjs';
import { pendingCandidates, composeCandidates } from '../src/integrate.mjs';
const sha = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const identity = 'ni:///sha-256;' + createHash('sha256').update('controlled development proposal').digest('base64url');
const change = (path, before, after) => ({path,beforeExisted:before!==null,beforeDigest:sha(before??''),afterDigest:sha(after??''),
  afterBytesBase64:Buffer.from(after??'').toString('base64'),...(after===null?{afterExisted:false}:{})});
function fixture() {
  const repository=mkdtempSync(join(tmpdir(),'development-delivery-'));
  gitSync(repository,['init','--quiet']);gitSync(repository,['config','user.name','Controlled producer']);gitSync(repository,['config','user.email','producer@example.invalid']);
  mkdirSync(join(repository,'consumer'));writeFileSync(join(repository,'consumer','app.mjs'),'export const value=1;\n');
  writeFileSync(join(repository,'retired.mjs'),'retire this\n');symlinkSync('consumer/app.mjs',join(repository,'link'));
  gitSync(repository,['add','.']);gitSync(repository,['commit','--quiet','-m','Original source']);
  return {repository,sourceBase:gitTextSync(repository,['rev-parse','HEAD'])};
}
test('accepted development activates scoped immutable receiving without publishing unrelated checkout changes',async()=>{
  const f=fixture();
  try {
    writeFileSync(join(f.repository,'unrelated.txt'),'another writer\n');gitSync(f.repository,['add','unrelated.txt']);
    const index=gitSync(f.repository,['ls-files','--stage']);
    const proposal={type:'SoftwareMissionChangeProposal',changes:[change('consumer/app.mjs','export const value=1;\n','export const value=42;\n'),change('retired.mjs','retire this\n',null)]};
    const delivery=prepareSourceDeliverySync({...f,proposal,proposalId:identity});
    assert.equal((await pendingCandidates({...f,queueRoot:join(f.repository,'queue')})).length,0);
    // Preparing and activating consume proposal bytes, even if the live checkout later changes.
    writeFileSync(join(f.repository,'consumer','app.mjs'),'export const value=99;\n');
    const candidate=delivery.activate();
    assert.equal(gitTextSync(f.repository,['rev-parse','HEAD']),f.sourceBase);
    assert.deepEqual(gitSync(f.repository,['ls-files','--stage']),index);
    assert.equal(gitTextSync(f.repository,['show',candidate.commit+':consumer/app.mjs']),'export const value=42;');
    assert.equal(gitTextSync(f.repository,['ls-tree',candidate.commit,'unrelated.txt','retired.mjs']),'');
    const receiving=gitTextSync(f.repository,['write-tree']);
    const receivingCommit=gitTextSync(f.repository,['commit-tree',receiving,'-p',f.sourceBase],{input:'Independent receiving state\n'});
    const result=await composeCandidates({repository:f.repository,base:receivingCommit,candidates:await pendingCandidates({...f,queueRoot:join(f.repository,'queue')})});
    assert.equal(result.conflicts.length,0);
    assert.equal(gitTextSync(f.repository,['show',result.head+':unrelated.txt']),'another writer');
    assert.equal(gitTextSync(f.repository,['show',result.head+':consumer/app.mjs']),'export const value=42;');
    assert.equal(gitTextSync(f.repository,['ls-tree',result.head,'retired.mjs']),'');
    assert.equal(gitTextSync(f.repository,['show','-s','--format=%P',result.head]),receivingCommit);
    assert.equal(prepareSourceDeliverySync({...f,proposal,proposalId:identity}).summary.commit,delivery.summary.commit);
    assert.equal(delivery.activate().commit,candidate.commit);
  } finally {rmSync(f.repository,{recursive:true,force:true});}
});
test('substituted source, bytes, path and carrier never enter the receiving queue',async()=>{
 const f=fixture();
 try {
  const valid=change('consumer/app.mjs','export const value=1;\n','export const value=42;\n');
  for(const changes of [[{...valid,beforeDigest:sha('foreign source')}],[{...valid,afterBytesBase64:'***'}],
   [{...valid,path:'../outside'}],[{...valid,path:'consumer/../app.mjs'}],[{...valid,path:'.git/config'}],
   [change('link','consumer/app.mjs','replacement')],[change('consumer/app.mjs/nested',null,'replacement')],
   [valid,change('consumer/app.mjs/nested',null,'replacement')]]) {
   assert.throws(()=>prepareSourceDeliverySync({...f,proposal:{type:'SoftwareMissionChangeProposal',changes},proposalId:identity}));
   assert.equal((await pendingCandidates({...f,queueRoot:join(f.repository,'queue')})).length,0);
  }
  assert.equal(readFileSync(join(f.repository,'consumer','app.mjs'),'utf8'),'export const value=1;\n');
  assert.throws(()=>prepareSourceDeliverySync({...f,sourceBase:undefined,proposal:{type:'SoftwareMissionChangeProposal',changes:[valid]},proposalId:identity}),/original immutable sourceBase/);
 } finally {rmSync(f.repository,{recursive:true,force:true});}
});
