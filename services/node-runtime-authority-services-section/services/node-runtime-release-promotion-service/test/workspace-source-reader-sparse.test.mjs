import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,relative} from 'node:path';
import {workspaceSourceReader} from '../src/read-workspace-source.mjs';

const environment={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1'};
const git=(root,...args)=>execFileSync('git',['-C',root,'-c','core.hooksPath=/dev/null',...args],{encoding:'utf8',env:environment,stdio:['ignore','pipe','pipe']}).trim();
const blob=body=>createHash('sha1').update('blob '+body.length+'\0').update(body).digest('hex');
const sha=body=>createHash('sha256').update(body).digest('hex');
function write(root,path,body){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body);}
function initialize(root,files){
  mkdirSync(root,{recursive:true});git(root,'init','-q');git(root,'config','user.name','Source reader fixture');git(root,'config','user.email','source-reader@example.invalid');
  for(const [path,body]of Object.entries(files))write(root,path,body);
  git(root,'add','.');git(root,'-c','commit.gpgsign=false','commit','-qm','Authentic source reader fixture');
  return git(root,'rev-parse','HEAD');
}
function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'workspace-source-reader-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const full=join(directory,'full'),sparse=join(directory,'sparse');
  const files={
    'package.json':'{"name":"reader-root","version":"1.0.0"}\n',
    'selected/package.json':'{"name":"selected","version":"1.0.0","exports":"./index.mjs"}\n',
    'selected/index.mjs':'export const value = 42;\n',
    'selected/nested/data.json':'{"selected":true}\n',
    'selected/literal[one]*? space\t.mjs':'export const literal = true;\n',
    'selected/literaloXX space\t.mjs':'export const neighbour = true;\n',
    'unrelated/deep/missing.mjs':'export const unrelated = true;\n',
    'unrelated/unused.txt':'No selected source reads this blob.\n',
  };
  const commit=initialize(full,files);
  cpSync(full,sparse,{recursive:true});
  git(sparse,'sparse-checkout','init','--cone','--sparse-index');git(sparse,'sparse-checkout','set','selected');
  const excludedTree=git(full,'rev-parse','HEAD:unrelated/deep'),excludedBlob=git(full,'rev-parse','HEAD:unrelated/unused.txt');
  const removeObject=(root,identity)=>rmSync(join(root,'.git','objects',identity.slice(0,2),identity.slice(2)));
  removeObject(sparse,excludedTree);removeObject(sparse,excludedBlob);
  assert.throws(()=>git(sparse,'cat-file','-e',excludedTree));
  assert.throws(()=>git(sparse,'ls-tree','-r','HEAD'));
  assert.equal(git(sparse,'rev-parse','HEAD'),commit);
  return {directory,full,sparse,files,commit,removeObject};
}
const read=(root,commit,importerIds=['.','selected'])=>workspaceSourceReader({workspace:root,commit,importerIds,environment});

test('full and sparse authentic source have identical object facts, bytes and provenance',async t=>{
  const f=fixture(t),full=await read(f.full,f.commit),sparse=await read(f.sparse,f.commit);
  for(const path of ['package.json','selected/package.json','selected/index.mjs','selected/nested/data.json','selected/literal[one]*? space\t.mjs']){
    const complete=full.object(join(f.full,path)),partial=sparse.object(join(f.sparse,path));
    assert.deepEqual(partial,complete);
    const bytes=Buffer.from(f.files[path]);
    assert.deepEqual(partial,{path,sourceRepository:'.',sourceCommit:f.commit,sourcePath:path,mode:'100644',kind:'blob',identity:blob(bytes)});
    assert.deepEqual(sparse.bytes(join(f.sparse,path)),full.bytes(join(f.full,path)));
    assert.equal(sparse.source(join(f.sparse,path)),f.files[path]);
  }
  assert.deepEqual([...sparse.sources.values()],[...full.sources.values()]);
  assert.deepEqual(sparse.sources.get(join(f.sparse,'selected/index.mjs')),{path:'selected/index.mjs',sourceRepository:'.',sourceCommit:f.commit,gitBlob:blob(Buffer.from(f.files['selected/index.mjs'])),sha256:sha(Buffer.from(f.files['selected/index.mjs']))});
  for(const path of ['','selected','selected/nested','selected/absent.mjs']){
    assert.equal(full.object(join(f.full,path)),null);assert.equal(sparse.object(join(f.sparse,path)),null);
  }
  assert.equal(relative(f.sparse,sparse.uncommittedOutput(join(f.sparse,'selected/generated/output.mjs'))),'selected/generated/output.mjs');
  assert.throws(()=>sparse.uncommittedOutput(join(f.sparse,'selected/index.mjs')),/overwrite a committed object/u);
  await full.verify();await sparse.verify();
});

test('literal source paths do not admit glob neighbours',async t=>{
  const f=fixture(t),reader=await read(f.sparse,f.commit),path='selected/literal[one]*? space\t.mjs';
  assert.equal(reader.object(join(f.sparse,path)).identity,blob(Buffer.from(f.files[path])));
  assert.notEqual(reader.object(join(f.sparse,path)).identity,reader.object(join(f.sparse,'selected/literaloXX space\t.mjs')).identity);
  assert.equal(reader.object(join(f.sparse,'selected/*.mjs')),null);
  assert.equal(reader.object(join(f.sparse,'selected/:(glob)*')),null);
});

test('a missing selected ancestor tree refuses rather than becoming an absent output',async t=>{
  const f=fixture(t),reader=await read(f.sparse,f.commit),selectedTree=git(f.full,'rev-parse','HEAD:selected/nested');f.removeObject(f.sparse,selectedTree);
  assert.throws(()=>reader.object(join(f.sparse,'selected/nested/data.json')));
  assert.throws(()=>reader.bytes(join(f.sparse,'selected/nested/data.json')));
  assert.throws(()=>reader.uncommittedOutput(join(f.sparse,'selected/nested/new.mjs')));
  await assert.rejects(read(f.sparse,f.commit));
});

test('missing or changed selected files are never certified by their tree identities',async t=>{
  const f=fixture(t),reader=await read(f.sparse,f.commit),file=join(f.sparse,'selected/index.mjs');
  reader.bytes(file);rmSync(file);
  assert.throws(()=>reader.bytes(file),{code:'ENOENT'});await assert.rejects(reader.verify(),{code:'ENOENT'});
  writeFileSync(file,'export const value = "changed";\n');
  assert.throws(()=>reader.bytes(file),/bytes differ from exact Git source/u);await assert.rejects(reader.verify(),/bytes differ from exact Git source/u);
  assert.throws(()=>reader.bytes(join(f.sparse,'selected/not-recorded.mjs')),/not a committed regular source/u);
});

test('source reading preserves filesystem confinement and rejects replaced source links',async t=>{
  const f=fixture(t),reader=await read(f.sparse,f.commit),file=join(f.sparse,'selected/index.mjs');
  assert.throws(()=>reader.object(join(f.directory,'outside.mjs')),/escapes source workspace/u);
  reader.bytes(file);rmSync(file);symlinkSync(join(f.full,'selected/index.mjs'),file);
  assert.throws(()=>reader.object(file),/follows a link/u);assert.throws(()=>reader.bytes(file),/follows a link/u);await assert.rejects(reader.verify(),/follows a link/u);
});

test('verification still rejects a changed root revision',async t=>{
  const f=fixture(t),reader=await read(f.full,f.commit);
  reader.bytes(join(f.full,'selected/index.mjs'));
  git(f.full,'-c','commit.gpgsign=false','commit','--allow-empty','-qm','Changed root revision');
  await assert.rejects(reader.verify(),{code:'ERR_ASSERTION'});
});

function mountFixture(t){
  const directory=mkdtempSync(join(tmpdir(),'workspace-source-mount-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const provider=join(directory,'provider'),root=join(directory,'root');
  const providerCommit=initialize(provider,{'selected/package.json':'{"name":"provider","version":"1.0.0"}\n','selected/index.mjs':'export const owned = true;\n'});
  initialize(root,{'package.json':'{"name":"root","version":"1.0.0"}\n'});
  git(root,'-c','protocol.file.allow=always','submodule','add','-q','--name','source-owner',provider,'vendor/owner');
  writeFileSync(join(root,'.gitmodules'),readFileSync(join(root,'.gitmodules'),'utf8')+'\n[submodule "unselected-owner"]\n path = vendor/unselected\n url = https://example.invalid/unreceived.git\n');
  git(root,'add','.gitmodules');git(root,'update-index','--add','--cacheinfo','160000,'+providerCommit+',vendor/unselected');
  git(root,'-c','commit.gpgsign=false','commit','-qm','Recorded selected owner');
  return {directory,root,mount:join(root,'vendor/owner'),commit:git(root,'rev-parse','HEAD'),providerCommit};
}

test('selected mount provenance and unselected Gitlink object facts remain exact',async t=>{
  const f=mountFixture(t),reader=await read(f.root,f.commit,['.','vendor/owner/selected']),path='vendor/owner/selected/index.mjs';
  const fact=reader.object(join(f.root,path));
  assert.deepEqual(fact,{path,sourceRepository:'vendor/owner',sourceCommit:f.providerCommit,sourcePath:'selected/index.mjs',mode:'100644',kind:'blob',identity:blob(Buffer.from('export const owned = true;\n'))});
  assert.equal(reader.source(join(f.root,path)),'export const owned = true;\n');
  assert.equal(reader.object(f.mount),null);
  const unselected=reader.object(join(f.root,'vendor/unselected'));
  assert.deepEqual(unselected,{path:'vendor/unselected',sourceRepository:'.',sourceCommit:f.commit,sourcePath:'vendor/unselected',mode:'160000',kind:'commit',identity:f.providerCommit});
  assert.throws(()=>reader.bytes(join(f.root,'vendor/unselected')),/not a committed regular source/u);
  assert.throws(()=>reader.uncommittedOutput(join(f.root,'vendor/unselected')),/overwrite a committed object/u);
  assert.equal(existsSync(join(f.root,'vendor/unselected/.git')),false);
  await reader.verify();
});

test('verification rejects changed selected mount HEAD and changed mount declarations',async t=>{
  const f=mountFixture(t),reader=await read(f.root,f.commit,['.','vendor/owner/selected']);
  git(f.mount,'config','user.name','Source reader fixture');git(f.mount,'config','user.email','source-reader@example.invalid');
  git(f.mount,'-c','commit.gpgsign=false','commit','--allow-empty','-qm','Changed selected owner');
  await assert.rejects(reader.verify(),/differs from recorded source/u);
  git(f.mount,'checkout','-q','--detach',f.providerCommit);
  writeFileSync(join(f.root,'.gitmodules'),readFileSync(join(f.root,'.gitmodules'),'utf8')+'\n# changed source mount declarations\n');
  await assert.rejects(reader.verify(),/mount configuration differs from recorded source/u);
});

test('selected mount index identity remains mandatory even when its HEAD is unchanged',async t=>{
  const f=mountFixture(t),reader=await read(f.root,f.commit,['.','vendor/owner/selected']);
  git(f.root,'update-index','--cacheinfo','160000,'+f.commit+',vendor/owner');
  await assert.rejects(reader.verify(),/selected mount index differs from recorded source/u);
});
