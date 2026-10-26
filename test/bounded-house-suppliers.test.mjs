import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,mkdirSync,writeFileSync,realpathSync,rmSync } from "node:fs";
import { execFileSync,spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialize,resolve } from "../src/resolve-house-package.mjs";

test("bounded exact suppliers admit named manifests without discovering the source tree",async t=>{
 const directory=mkdtempSync(join(tmpdir(),"source-supplier-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const name="@red-cup-engineering/synthetic-source-supplier";
 writeFileSync(join(directory,"package.json"),JSON.stringify({name,version:"1.0.0",type:"module",exports:{"./admitted":"./admitted.mjs"}}));
 const entry={name,version:"1.0.0",directory},bindings={type:"HousePackageBindings",version:1,packages:[entry]};
 initialize({bindings});
 const admitted=await resolve(name+"/admitted",{},()=>{throw Error("unexpected fallback");});
 assert.equal(admitted.url,new URL("file://"+join(directory,"admitted.mjs")).href);
 assert.equal(admitted.shortCircuit,true);
 await assert.rejects(resolve(name+"/private",{},()=>{}),{code:"ERR_PACKAGE_PATH_NOT_EXPORTED"});
 assert.equal(await resolve("node:fs",{},()=> "ordinary"),"ordinary");
 for(const invalid of [Object.assign([],bindings),Object.assign(()=>{},bindings),{...bindings,packages:[Object.assign([],entry)]},{...bindings,extra:true},{...bindings,packages:[entry,entry]},
  {...bindings,packages:[{...entry,version:"2.0.0"}]},{...bindings,packages:[{...entry,directory:"relative"}]}])
  assert.throws(()=>initialize({bindings:invalid}),TypeError);
 const again=await resolve(name+"/admitted",{},()=>{throw Error("invalid reinitialization changed prior binding");});
 assert.equal(again.url,admitted.url);
});

const registration = new URL("../scripts/register-house-resolver.mjs",import.meta.url).href;

for (const relative of [true,false]) test(`supplier binding identity survives a child cwd change (${relative?"relative":"absolute"} input)`,t=>{
 const directory=mkdtempSync(join(tmpdir(),"house-binding-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const supplier=join(directory,"supplier"),child=join(directory,"child");mkdirSync(supplier);mkdirSync(child);
 const name="@red-cup-engineering/synthetic-source-supplier";
 writeFileSync(join(supplier,"package.json"),JSON.stringify({name,version:"1.0.0",type:"module",exports:"./entry.mjs"}));
 writeFileSync(join(supplier,"entry.mjs"),'export const value="selected supplier";');
 const file=join(directory,"bindings with spaces.json");
 writeFileSync(file,JSON.stringify({type:"HousePackageBindings",version:1,packages:[{name,version:"1.0.0",directory:supplier}]}));
 const childCode=`import {value} from ${JSON.stringify(name)};process.stdout.write(value);`;
 const parentCode=`import {execFileSync} from "node:child_process";const child=execFileSync(process.execPath,["--import",${JSON.stringify(registration)},"--input-type=module","-e",${JSON.stringify(childCode)}],{cwd:${JSON.stringify(child)},env:process.env,encoding:"utf8"});console.log(JSON.stringify({binding:process.env.HOUSE_PACKAGE_BINDINGS,child}));`;
 const env={...process.env,HOUSE_PACKAGE_BINDINGS:relative?"./bindings with spaces.json":file};delete env.NODE_OPTIONS;delete env.HOUSE_ROOT;
 const result=JSON.parse(execFileSync(process.execPath,["--import",registration,"--input-type=module","-e",parentCode],{cwd:directory,env,encoding:"utf8"}));
 assert.equal(result.binding,realpathSync(file));assert.equal(result.child,"selected supplier");
});

test("missing explicit bindings refuse before the application starts",t=>{
 const directory=mkdtempSync(join(tmpdir(),"house-binding-missing-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const env={...process.env,HOUSE_PACKAGE_BINDINGS:"./missing.json"};delete env.NODE_OPTIONS;delete env.HOUSE_ROOT;
 const result=spawnSync(process.execPath,["--import",registration,"--input-type=module","-e",'process.stdout.write("application started")'],{cwd:directory,env,encoding:"utf8"});
 assert.notEqual(result.status,0);assert.equal(result.stdout,"");assert.match(result.stderr,/ENOENT/);
});
