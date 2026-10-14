import assert from 'node:assert/strict';
import {readFile,realpath,lstat,writeFile,mkdir,chmod} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {verifyWorkspaceSelection} from './install-workspace-selection.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(root,file)=>{const offset=relative(root,file);return !isAbsolute(offset)&&offset!=='..'&&!offset.startsWith('../');};

/** Read the configured TypeScript output mapping without emitting a product.
 * The source reader is supplied by custody admission for source assessment;
 * ordinary generation uses the exact installed compiler's normal reader.
 */
export function workspaceTypeScriptOutputContract({root,manifest,compiler:ts,readSource=ts.sys.readFile}) {
  const recipe=/^tsc -p (tsconfig(?:\.build)?\.json)$/u.exec(manifest.scripts?.['build:node']??manifest.scripts?.build??'');
  if(!recipe)return null;
  const file=join(root,recipe[1]),source=ts.readConfigFile(file,readSource);
  if(source.error)throw new Error(ts.flattenDiagnosticMessageText(source.error.messageText,'\n'));
  const parsed=ts.parseJsonConfigFileContent(source.config,{...ts.sys,readFile:readSource},root,{},file);
  if(parsed.errors.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors,{getCurrentDirectory:()=>root,getCanonicalFileName:file=>file,getNewLine:()=> '\n'}));
  if(!parsed.options.outDir||!within(root,resolve(parsed.options.outDir)))throw new Error('TypeScript producer output must remain in its source owner');
  const outputs=[];
  for(const input of parsed.fileNames){
    if(!within(root,resolve(input)))throw new Error('TypeScript input is outside its source owner');
    for(const output of ts.getOutputFileNames(parsed,input,false)){
      if(!within(root,resolve(output))||!within(resolve(parsed.options.outDir),resolve(output)))throw new Error('TypeScript declared output escapes its owner');
      outputs.push({input:resolve(input),output:resolve(output)});
    }
  }
  return {configuration:file,parsed,outputs};
}

/** Emit the selected owners' existing direct TypeScript recipes and retain the
 * compiler's actual output events. No directory inventory is promoted as proof
 * of generation, and no application or package test runs here. */
export async function generateWorkspaceTypeScript(selection){
  const workspace=await verifyWorkspaceSelection(selection),providers=new Map();
  for(const importer of selection.importerIds){
    const root=join(workspace,importer),bytes=await readFile(join(root,'package.json')),manifest=JSON.parse(bytes);
    const recipe=/^tsc -p (tsconfig(?:\.build)?\.json)$/u.exec(manifest.scripts?.['build:node']??manifest.scripts?.build??'');
    if(recipe)providers.set(manifest.name,{importer,root,manifest,bytes,configuration:recipe[1]});
  }
  const active=new Set(),done=new Set(),packages=[];
  async function emit(name){
    if(done.has(name))return;
    if(active.has(name))throw new Error('cyclic TypeScript producer dependency: '+name);
    const provider=providers.get(name);active.add(name);
    for(const dependency of Object.keys(provider.manifest.dependencies??{}))if(providers.has(dependency))await emit(dependency);
    const {root,configuration}=provider,file=join(root,configuration);
    if(await realpath(file)!==file||!(await lstat(file)).isFile())throw new Error('TypeScript configuration is redirected');
    const configBytes=await readFile(file),require=createRequire(join(root,'package.json'));
    const compilerFile=require.resolve('typescript'),compilerManifestFile=require.resolve('typescript/package.json');
    const compilerManifestBytes=await readFile(compilerManifestFile),compilerManifest=JSON.parse(compilerManifestBytes),ts=require('typescript');
    const {parsed}=workspaceTypeScriptOutputContract({root,manifest:provider.manifest,compiler:ts});
    for(const input of parsed.fileNames)if(!within(root,resolve(input))||await realpath(input)!==resolve(input))throw new Error('TypeScript input is outside its regular source owner');
    const program=ts.createProgram(parsed.fileNames,parsed.options),diagnostics=ts.getPreEmitDiagnostics(program);
    if(diagnostics.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>root,getCanonicalFileName:file=>file,getNewLine:()=> '\n'}));
    const files=[],pending=[],outputNames=new Set();
    const emitted=program.emit(undefined,(name,text,bom,_onError,sources)=>{
      const output=resolve(name);
      if(!within(root,output)||!within(resolve(parsed.options.outDir),output))throw new Error('TypeScript emitted outside its configured owner output');
      if(outputNames.has(output))throw new Error('TypeScript emitted conflicting output paths');
      outputNames.add(output);
      const bytes=Buffer.from((bom?'\uFEFF':'')+text);
      pending.push((async()=>{
        await mkdir(dirname(output),{recursive:true});
        if(await realpath(dirname(output))!==dirname(output))throw new Error('TypeScript output parent is redirected');
        const held=await lstat(output).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(held&&!held.isFile())throw new Error('TypeScript output is not a regular file');
        await writeFile(output,bytes);
        const executable=(await Promise.all((sources??[]).map(source=>lstat(source.fileName)))).some(stat=>Boolean(stat.mode&0o111));
        await chmod(output,executable?0o755:0o644);
        files.push({path:relative(root,output).split('\\').join('/'),bytes:bytes.length,sha256:sha(bytes),executable});
      })());
    });
    await Promise.all(pending);
    assert.equal(emitted.emitSkipped,false,'TypeScript did not emit its declared products');
    if(!files.length||new Set(files.map(file=>file.path)).size!==files.length)throw new Error('TypeScript emitted no products or conflicting output paths');
    packages.push({name,version:provider.manifest.version,importer:provider.importer,manifestSha256:sha(provider.bytes),configuration:{path:configuration,sha256:sha(configBytes)},compiler:{name:compilerManifest.name,version:compilerManifest.version,manifestSha256:sha(compilerManifestBytes),entrySha256:sha(await readFile(compilerFile))},files:files.sort((a,b)=>a.path.localeCompare(b.path))});
    active.delete(name);done.add(name);
  }
  for(const name of providers.keys())await emit(name);
  await verifyWorkspaceSelection(selection);
  return {type:'NodeRuntimeTypeScriptEmission',version:1,producer:{package:'@red-cup-engineering/node-runtime-release-promotion-service',path:'src/generate-workspace-typescript.mjs',sha256:sha(await readFile(fileURLToPath(import.meta.url)))},sourceCommit:selection.commit,sourceLockSha256:selection.sourceHashes['pnpm-lock.yaml'],scopedLockSha256:selection.scopedLockSha256,sourceConfigurationUnchanged:true,applicationExecuted:false,packages};
}
