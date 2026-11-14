import test from "node:test";
import assert from "node:assert/strict";
import { parseJavaScript } from "@red-cup-engineering/javascript-parser-service";
import { readJavaScriptModuleRequestSites as read } from "@red-cup-engineering/javascript-parser-service/module-reference-sites";

const sites = text => read(parseJavaScript(text));
test("request sites retain AST identity and exact UTF-16 literal positions", () => {
  const text = `// 😀\r\nimport x from './a.mjs'; export * from "./b.mjs"; const f=()=>import('./c.mjs'); require('./d.cjs'); import(name);`;
  const program = parseJavaScript(text), result = read(program);
  assert.deepEqual(result.map(site => [site.kind,site.specifier]), [["import","./a.mjs"],["import","./b.mjs"],["dynamic-import","./c.mjs"],["require","./d.cjs"],["dynamic-import",null]]);
  assert.equal(result[0].node, program.body[0]);
  assert.deepEqual(result.slice(0,4).map(site => text.slice(site.start,site.end)), ["'./a.mjs'",'"./b.mjs"',"'./c.mjs'","'./d.cjs'"]);
  assert.equal(result.at(-1).start,null); assert.equal(result.at(-1).end,null);
  assert.ok(Object.isFrozen(result) && result.every(Object.isFrozen));
});
test("named factory and const same-source loader aliases use lexical identity", () => {
  const text = `import {createRequire as factory} from 'node:module'; const load=factory(import.meta.url); load('./live.cjs'); function nested(load){return load('./shadow.cjs')} const ordinary=x=>x; ordinary('./data');`;
  assert.deepEqual(sites(text).filter(x=>x.kind==='require').map(x=>x.specifier), ['./live.cjs']);
  assert.deepEqual(sites(`function f(require){return require('./local.cjs')} const require=x=>x; require('./not-module');`).filter(x=>x.kind==='require'), []);
});
test("unsupported mutable methods and different-origin loaders are not inferred", () => {
  const text = `import mod,{createRequire} from 'node:module'; const load=createRequire(import.meta.url); load.resolve=x=>x; load.resolve('./not-module'); const other=createRequire('/other/base.mjs'); other('./elsewhere'); const made=mod.createRequire(import.meta.url); made('./unknown');`;
  assert.deepEqual(sites(text).filter(x=>x.kind==='require'), []);
});
test("request evidence has no guard or dependency-admission policy", () => {
  const result = sites(`try { require('./optional.cjs'); const later=()=>require('./later.cjs'); } catch {}`);
  assert.deepEqual(result.map(x=>x.specifier), ['./optional.cjs','./later.cjs']);
  assert.ok(result.every(x=>!Object.hasOwn(x,'guarded')));
});
