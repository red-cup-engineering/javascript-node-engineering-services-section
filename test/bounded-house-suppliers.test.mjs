import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,writeFileSync,rmSync } from "node:fs";
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
