import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJavaScript } from '@red-cup-engineering/javascript-parser-service';
import { readJavaScriptModuleExportNames } from '@red-cup-engineering/javascript-parser-service/module-export-names';

test('projects exact exported bindings, not local names or comment prose', () => {
  const source = `// export const imaginary = 0;
const local = 1;
export {local as 'with space'};
export default function named() {}
export const { a: alias, nested: {b}, ...rest } = input, [first,,...tail] = values;
export class Example {}
export function callable() {}
export * as remote from './remote.mjs';`;
  const result = readJavaScriptModuleExportNames(parseJavaScript(source));
  assert.deepEqual(result.names, ['with space','default','alias','b','rest','first','tail','Example','callable','remote']);
  assert.equal(result.hasStarExport, false);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.names));
});

test('unresolved star export is evidence, not a fabricated name or executed dependency', () => {
  const result=readJavaScriptModuleExportNames(parseJavaScript("export * from './absent.mjs'; export {x as y} from './also-absent.mjs';"));
  assert.deepEqual(result.names,['y']);assert.equal(result.hasStarExport,true);
});

test('default expressions and empty modules retain their actual surface', () => {
  assert.deepEqual(readJavaScriptModuleExportNames(parseJavaScript('export default 3;')).names,['default']);
  assert.deepEqual(readJavaScriptModuleExportNames(parseJavaScript('const hidden = 1;')),{names:[],hasStarExport:false});
});
