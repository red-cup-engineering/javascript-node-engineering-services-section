import { createJavascriptNodeOperation } from '../src/operation.mjs';
const length = createJavascriptNodeOperation({name:'length',description:'Count characters',inputSchema:{type:'string'},outputSchema:{type:'number'},operation: text => {
  const input: string = text;
  // @ts-expect-error the schema's domain excludes numbers
  const invalid: number = text;
  return input.length;
}});
const result = await length.invoke('tree');
if (result.ok) {
  const output: number = result.value;
  // @ts-expect-error the schema's codomain excludes strings
  const invalid: string = result.value;
}
