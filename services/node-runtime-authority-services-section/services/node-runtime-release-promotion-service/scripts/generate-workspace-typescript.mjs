#!/usr/bin/env node
import {generateWorkspaceTypeScript} from '../src/generate-workspace-typescript.mjs';
const options={},args=process.argv.slice(2);
for(let index=0;index<args.length;index+=2){
  if(!['--workspace','--pnpm','--filter'].includes(args[index])||!args[index+1])throw new TypeError('usage: generate-workspace-typescript --workspace <source root> [--pnpm <executable>] [--filter <native-selector>]');
  options[args[index].slice(2)]=args[index+1];
}
if(!options.workspace)throw new TypeError('workspace root is required');
process.stdout.write(JSON.stringify(await generateWorkspaceTypeScript(options))+'\n');
