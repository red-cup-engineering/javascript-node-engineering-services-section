import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,realpath,lstat,mkdir,writeFile,chmod} from 'node:fs/promises';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {generateWorkspaceTypeScript,workspaceTypeScriptOutputContract} from './generate-workspace-typescript.mjs';
import {createRequire} from 'node:module';
import {readNodeWorkspace} from './read-workspace-source.mjs';
import {workspaceModuleGenerationContract} from './workspace-module-generation.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const literal=path=>typeof path==='string'&&path&&!isAbsolute(path)&&!/[\\\0]/u.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..');

/** Receive declared source-product modules at the existing Code writer.
 * No build command, optional example assay or application is invoked. */
export async function generateWorkspaceArtifacts(options){
  const source=await readNodeWorkspace(options),{workspace,reader}=source,packages=[];
  const now=new Date().toISOString();
  const outputPaths=new Set();
  const providers=[];
  for(const importer of source.importerIds){
    const root=join(workspace,importer),manifestBytes=reader.bytes(join(root,'package.json')),manifest=JSON.parse(manifestBytes);
    const recipe=manifest.scripts?.['build:node']??manifest.scripts?.build??'';
    if(/^tsc -p (tsconfig(?:\.build)?\.json)$/u.test(recipe)){
      const compiler=createRequire(join(root,'package.json'))('typescript');
      for(const {output}of workspaceTypeScriptOutputContract({root,manifest,compiler,readSource:reader.source}).outputs){
        reader.uncommittedOutput(output);
        if(outputPaths.has(output))throw new Error('configured compiler or module products collide');
        outputPaths.add(output);
      }
    }
    const contract=workspaceModuleGenerationContract({root,manifest});
    if(!contract)continue;
    for(const output of contract.outputs){reader.uncommittedOutput(output);if(outputPaths.has(output))throw new Error('declared source products collide with actual compiler or module products');outputPaths.add(output);}
    providers.push({importer,root,manifestBytes,manifest,contract});
  }
  const typescript=await generateWorkspaceTypeScript(options);
  for(const row of typescript.packages)for(const file of row.files){
    if(!outputPaths.has(resolve(workspace,row.importer,file.path)))throw new Error('compiler emitted an undeclared product');
  }
  for(const {importer,root,manifestBytes,manifest,contract}of providers){
    const moduleBytes=reader.bytes(contract.module),inputs=new Map();
    const read=async path=>{
      if(!literal(path))throw new TypeError('source-product inputs must be canonical workspace-relative paths');
      const file=resolve(workspace,path);
      if(contract.outputs.includes(file))throw new Error('source-product producer cannot read its own output as an input');
      const text=reader.source(file);inputs.set(path,reader.sources.get(file));return text;
    };
    const programme=await import(pathToFileURL(contract.module).href);
    if(typeof programme[contract.export]!=='function')throw new TypeError('declared source-product export is absent');
    const result=await programme[contract.export]({sourceRoot:workspace,read,now});
    if(!Array.isArray(result?.files)||result.files.length!==contract.outputs.length)throw new Error('source-product module did not return every declared product');
    const products=new Map();
    for(const file of result.files){
      if(!literal(file?.path)||typeof file.text!=='string')throw new TypeError('source-product module must return canonical paths and UTF-8 text');
      const output=resolve(root,file.path);
      if(!contract.outputs.includes(output)||products.has(output))throw new Error('source-product module returned an undeclared or duplicate output');
      products.set(output,{path:file.path,bytes:Buffer.from(file.text,'utf8')});
    }
    await reader.verify();
    const files=[];
    for(const [output,product]of products){
      reader.uncommittedOutput(output);
      await mkdir(dirname(output),{recursive:true});
      if(await realpath(dirname(output))!==dirname(output))throw new Error('source-product output parent is redirected');
      const held=await lstat(output).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(held&&!held.isFile())throw new Error('source-product output is not a regular file');
      await writeFile(output,product.bytes);await chmod(output,0o644);
      files.push({path:product.path,bytes:product.bytes.length,sha256:sha(product.bytes),executable:false});
    }
    packages.push({name:manifest.name,version:manifest.version,importer,manifestSha256:sha(manifestBytes),
      module:{path:contract.declaration.module,export:contract.export,sha256:sha(moduleBytes)},publicationInstant:now,
      inputs:[...inputs.values()].sort((a,b)=>a.path.localeCompare(b.path)),files:files.sort((a,b)=>a.path.localeCompare(b.path))});
  }
  await reader.verify();
  return {type:'NodeRuntimeWorkspaceEmission',version:1,
    producer:{package:'@red-cup-engineering/node-runtime-release-promotion-service',path:'src/generate-workspace-artifacts.mjs',sha256:sha(await readFile(fileURLToPath(import.meta.url)))},
    sourceCommit:source.commit,sourceLockSha256:sha(reader.bytes(join(workspace,'pnpm-lock.yaml'))),
    sourceConfigurationUnchanged:true,applicationExecuted:false,typescript,packages};
}

