import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
// The override is only a developer regression harness: the identical assertions
// run against untouched main and the extracted compiler, with genuine suppliers.
const {compileNodeRuntime}=await import(process.env.NODE_RUNTIME_COMPILER_MODULE?pathToFileURL(process.env.NODE_RUNTIME_COMPILER_MODULE).href:new URL('../src/compile-node-runtime.mjs',import.meta.url).href);

function fixture(t,{star=false}={}){
  const base=mkdtempSync(join(tmpdir(),'compile-packed-workspace-')),workspace=join(base,'source'),runtime=join(base,'packed'),effect=join(base,'executed');
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const write=(file,text)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
  const json=(file,value)=>write(file,JSON.stringify(value,null,2)+'\n');
  const root={name:'compiler-consumer',version:'1.0.0',type:'module',packageManager:'pnpm@10.0.0',exports:'./src/index.mjs',files:['src','test'],receivingPackages:['@fixture/owner']};
  json(join(workspace,'package.json'),root);write(join(workspace,'pnpm-workspace.yaml'),"packages:\n  - 'packages/*'\n");write(join(workspace,'pnpm-lock.yaml'),"lockfileVersion: '9.0'\n");
  const body=`import {answer} from '@fixture/owner';import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(effect)},'application ran');export {answer};`;
  write(join(workspace,'src/index.mjs'),body);write(join(workspace,'test/check.mjs'),`throw new Error('receiving tests must never run during static compile');`);
  const owner={name:'@fixture/owner',version:'1.0.0',type:'module',exports:'./src/index.mjs',files:['src','test'],receivingTests:['test/check.mjs'],scripts:{test:'throw-if-executed'}};
  json(join(workspace,'packages/owner/package.json'),owner);
  write(join(workspace,'packages/owner/src/index.mjs'),star?"export * from 'fixture-vendor';":"import {answer} from 'fixture-vendor';export {answer};");
  write(join(workspace,'packages/owner/test/check.mjs'),"throw new Error('receiving test executed');");
  json(join(workspace,'packages/absent/package.json'),{name:'@fixture/not-packed',version:'1.0.0',type:'module',exports:'./index.mjs'});
  write(join(workspace,'packages/absent/index.mjs'),"throw new Error('unpacked owner executed');");
  json(join(runtime,'package.json'),root);cpSync(join(workspace,'src'),join(runtime,'src'),{recursive:true});cpSync(join(workspace,'test'),join(runtime,'test'),{recursive:true});
  const packedOwner=join(runtime,'node_modules/.pnpm/@fixture+owner@1.0.0/node_modules/@fixture/owner');cpSync(join(workspace,'packages/owner'),packedOwner,{recursive:true});
  const alias=join(runtime,'node_modules/@fixture/owner');mkdirSync(dirname(alias),{recursive:true});symlinkSync(relative(dirname(alias),packedOwner),alias);
  const vendor=join(runtime,'node_modules/fixture-vendor');json(join(vendor,'package.json'),{name:'fixture-vendor',version:'1.0.0',type:'module',exports:'./index.mjs'});write(join(vendor,'index.mjs'),"export const answer=42;throw new Error('vendor must not execute');");
  const pnpm=join(base,'pnpm');write(pnpm,`#!${process.execPath}\nif(process.argv[2]==='--version')console.log('10.0.0');else console.log(JSON.stringify(['.','packages/owner','packages/absent'].map(p=>({path:require('node:path').resolve(process.cwd(),p)}))));\n`);chmodSync(pnpm,0o755);
  const git=(...args)=>execFileSync('git',['-C',workspace,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-qm','compiler fixture');
  return {workspace,runtime,pnpm,packedOwner,vendor,effect,write,json,options:{workspace,runtime,pnpm}};
}

test('actual compiler follows native packed root/scoped aliases once without executing tests or application',async t=>{
  const f=fixture(t),r=await compileNodeRuntime(f.options);
  assert.equal(r.status,'compiled');assert.equal(r.scope,'packed-workspace-packages');assert.equal(r.applicationExecuted,false);assert.equal(r.nativeBindingsExecuted,false);
  assert.deepEqual(r.inspectedPackages.map(p=>p.name),['compiler-consumer','@fixture/owner']);
  assert.equal(r.inspectedPackages.filter(p=>p.name==='@fixture/owner').length,1);
  assert.deepEqual(r.workspacePackagesNotObserved,['@fixture/not-packed']);assert.equal(existsSync(f.effect),false);
  assert.equal(r.externalModules.includes('fixture-vendor'),true);assert.equal(r.inspectedModules.some(p=>p.startsWith(f.vendor)),false);
});
test('actual compiler follows vendor star declarations statically and never executes them',async t=>{
  const f=fixture(t,{star:true}),r=await compileNodeRuntime(f.options);
  assert.equal(r.status,'compiled');assert.equal(r.vendorReexports.some(v=>v.specifier==='fixture-vendor'),true);
  assert.equal(r.inspectedModules.includes(join(f.vendor,'index.mjs')),true);assert.equal(existsSync(f.effect),false);
});
test('nested transitive physical owner is compiled without a top-level alias',async t=>{
  const f=fixture(t);rmSync(join(f.runtime,'node_modules/@fixture/owner'));
  // Root imports the real native nested carrier explicitly in this layout case.
  f.write(join(f.runtime,'src/index.mjs'),"export const root=1;");
  const r=await compileNodeRuntime(f.options);assert.equal(r.inspectedPackages.some(p=>p.directory===f.packedOwner),true);assert.equal(r.status,'compiled');
});
test('packed declaration mismatch refuses before static compilation',async t=>{
  const f=fixture(t),file=join(f.packedOwner,'package.json'),m=JSON.parse(readFileSync(file));m.exports='./another.mjs';f.json(file,m);
  await assert.rejects(compileNodeRuntime(f.options),/packed declaration differs/);assert.equal(existsSync(f.effect),false);
});
test('missing owned carrier is a static refusal rather than test execution',async t=>{
  const f=fixture(t);rmSync(join(f.packedOwner,'src/index.mjs'));
  await assert.rejects(compileNodeRuntime(f.options),/Incomplete package carriers/);assert.equal(existsSync(f.effect),false);
});
test('actual esbuild binding failure retains static diagnostics and never executes application',async t=>{
  const f=fixture(t,{star:true});f.write(join(f.runtime,'src/index.mjs'),"import {missing} from '@fixture/owner';export {missing};");
  await assert.rejects(compileNodeRuntime(f.options),error=>{assert.equal(error.receipt.status,'refused');assert.equal(error.receipt.applicationExecuted,false);assert.ok(error.receipt.diagnostics.length);return true;});assert.equal(existsSync(f.effect),false);
});
