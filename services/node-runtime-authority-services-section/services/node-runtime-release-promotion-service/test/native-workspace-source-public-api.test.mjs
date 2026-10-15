import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  readNodeWorkspace,workspaceSourceReader
} from '@red-cup-engineering/node-runtime-release-promotion-service/read-workspace-source';

const git=(root,...args)=>execFileSync('git',['-C',root,...args],{
  encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}
}).trim();

test('the owning package publishes the existing original native source interface',()=>{
  assert.equal(typeof readNodeWorkspace,'function');
  assert.equal(typeof workspaceSourceReader,'function');
});

test('the public Git reader retains committed source identity and detects subsequent mutation',async t=>{
  const work=mkdtempSync(join(tmpdir(),'owned-native-reader-'));
  t.after(()=>rmSync(work,{recursive:true,force:true}));
  const root=join(work,'source');
  mkdirSync(root);
  git(root,'init','-q');
  const file=join(root,'package.json');
  const bytes=Buffer.from('{"name":"@fixture/native-source","version":"1.0.0"}\n');
  writeFileSync(file,bytes);
  git(root,'add','--','package.json');
  git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
    'commit','-qm','original source');
  const commit=git(root,'rev-parse','HEAD');
  const reader=await workspaceSourceReader({workspace:root,commit,importerIds:['.'],recursive:true});
  assert.deepEqual(reader.bytes(file),bytes);
  const original=reader.object(file);
  assert.equal(original.sourceRepository,'.');
  assert.equal(original.sourceCommit,commit);
  assert.equal(original.sourcePath,'package.json');
  assert.equal(original.identity,createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'));
  await reader.verify();
  writeFileSync(file,'{"name":"altered"}\n');
  assert.throws(()=>reader.bytes(file),/interface bytes differ from exact Git source/);
  await assert.rejects(reader.verify(),/interface bytes differ from exact Git source/);
});
