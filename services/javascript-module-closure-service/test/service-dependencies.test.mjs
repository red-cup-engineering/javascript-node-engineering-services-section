import { sha256 } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/hash";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
import assert from 'node:assert/strict';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { admitModuleClosure, captureModuleClosure, executeJavascriptProgram, javascriptProgram,
  moduleClosureBytes, moduleClosureDigest, readModuleParameterizations } from '../src/module-closure.mjs';

function project(t) {
  const dir = mkdtempSync(join(tmpdir(), 'closure-service-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sample-game', type: 'module' }));
  return dir;
}

test('a captured score rule retains its bytes when the source and cache key change', async t => {
  const dir = project(t), entry = join(dir, 'game.mjs'), rule = join(dir, 'score.mjs');
  writeFileSync(entry, "export { score } from './score.mjs';\n");
  writeFileSync(rule, 'export const score = value => value + 1;\n');
  const captured = captureModuleClosure(entry);
  const { digest, modules } = moduleClosureDigest([entry]);
  assert.equal(modules, 2);
  const hash = sha256(moduleClosureBytes(captured.id)).toString("base64url");
  assert.equal(captured.id, 'ni:///sha-256;' + hash);
  assert.equal(admitModuleClosure(captured.id, captured.body), captured.id);
  const programme = javascriptProgram(entry, 'score');
  writeFileSync(rule, 'export const score = value => value + 3;\n');
  assert.notEqual(moduleClosureDigest([entry]).digest, digest);
  assert.notEqual(captureModuleClosure(entry).id, captured.id);
  assert.equal(await executeJavascriptProgram(programme, 2), 3);
  assert.equal(await executeJavascriptProgram(javascriptProgram(entry, 'score'), 2), 5);
});

test('bound configuration reads verified JSON, resolves pointers and checks parameter types', async t => {
  const dir = project(t);
  const name = '@red-cup-engineering/fixture-parameters';
  const pack = join(dir, 'node_modules', name);
  mkdirSync(pack, {recursive: true});
  // Scope the two fixture exports to this test, including when the host resolves
  // package names through a checkout catalog. Both references read actual files.
  const exports = new Map(['data', 'model'].map(key => [name + '/' + key, join(pack, key + '.json')]));
  const hook = registerHooks({ resolve(specifier, context, next) {
    return next(exports.get(specifier) ?? specifier, context);
  } });
  t.after(() => hook.deregister());
  function reference(file, record) {
    const bytes = JSON.stringify(record);
    writeFileSync(join(pack, file + '.json'), bytes);
    return {module: name + '/' + file, record: record.id, sha256: sha256Hex(bytes)};
  }
  const model = reference('model', {id: 'difficulty-model', schema: {type: 'integer', minimum: 1}});
  const descriptor = {
    type: 'ModuleParameterization', version: 1, module: name, export: 'game', parameters: ['level'],
    configuration: {difficulty: {$parameter:'level'}}, parameterSchemas: {level: {...model, pointer:'/schema'}},
  };
  const ref = reference('data', {id: 'settings', descriptor});
  const declaration = {dataRef: {...ref, pointer:'/descriptor'}, parameters: {level: {instancePointer:'/saved/level'}}};
  function read(source, level) {
    return readModuleParameterizations([source], {moduleBasePath: join(dir, 'package.json'), sourceDocument: {saved:{level}}});
  }
  assert.deepEqual(await read(declaration, 2), [{module:name, export:'game', configuration:{difficulty:2}}]);
  await assert.rejects(read(declaration, 0), /outside its declared Data model/);
  await assert.rejects(read({...declaration, dataRef:{...declaration.dataRef, sha256:'0'.repeat(64)}}, 2), /digest differs/);
  await assert.rejects(read({...declaration, unexpected:true}, 2), /Invalid module parameterization source/);
});
