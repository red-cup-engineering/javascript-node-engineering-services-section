#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {generateWorkspaceArtifacts} from '../src/generate-workspace-artifacts.mjs';
const [receipt,...rest]=process.argv.slice(2);
if(!receipt||rest.length)throw new TypeError('usage: generate-workspace-artifacts <installed selection receipt>');
process.stdout.write(JSON.stringify(await generateWorkspaceArtifacts(JSON.parse(await readFile(receipt,'utf8'))))+'\n');
