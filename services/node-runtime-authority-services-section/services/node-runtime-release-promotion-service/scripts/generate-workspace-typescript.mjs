import {readFile} from 'node:fs/promises';
import {generateWorkspaceTypeScript} from '../src/generate-workspace-typescript.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--selection')throw new Error('generate-workspace-typescript --selection RECEIPT');
const selection=JSON.parse(await readFile(args[1],'utf8'));
process.stdout.write(JSON.stringify(await generateWorkspaceTypeScript(selection))+'\n');
