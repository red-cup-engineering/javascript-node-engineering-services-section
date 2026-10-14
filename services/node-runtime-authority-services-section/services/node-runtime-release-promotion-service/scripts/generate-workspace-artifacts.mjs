#!/usr/bin/env node
import {generateWorkspaceArtifacts} from '../src/generate-workspace-artifacts.mjs';
const options={},args=process.argv.slice(2);
for(let index=0;index<args.length;index+=2){
  if(args[index]==='--plan'){options.planOnly=true;index-=1;continue;}
  if(!['--workspace','--pnpm'].includes(args[index])||!args[index+1])throw new TypeError('usage: generate-workspace-artifacts --workspace <source root> [--pnpm <executable>] [--plan]');
  options[args[index].slice(2)]=args[index+1];
}
if(!options.workspace)throw new TypeError('workspace root is required');
process.stdout.write(JSON.stringify(await generateWorkspaceArtifacts(options))+'\n');
