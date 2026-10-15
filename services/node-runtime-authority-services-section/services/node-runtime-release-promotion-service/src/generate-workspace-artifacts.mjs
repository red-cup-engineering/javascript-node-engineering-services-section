import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,realpath,lstat,mkdir,writeFile,chmod} from 'node:fs/promises';
import {join,resolve,dirname,isAbsolute,relative,basename,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {prepareWorkspaceTypeScriptGeneration} from './generate-workspace-typescript.mjs';
import {readNodeWorkspace} from './read-workspace-source.mjs';
import {workspaceModuleGenerationContract,workspaceGenerationOrder} from './workspace-module-generation.mjs';
import {assessSourceInterfaces} from './assess-source-interfaces.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const literal=path=>typeof path==='string'&&path&&!isAbsolute(path)&&!/[\\\0]/u.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..');

/** Receive declared source-product modules at the existing Code writer.
 * No build command, optional example assay or application is invoked. */
export async function generateWorkspaceArtifacts(options){
  const source=await readNodeWorkspace(options),{workspace,reader}=source,packages=[];
  const now=new Date().toISOString();
  const outputPaths=new Set(),typed=await prepareWorkspaceTypeScriptGeneration(source),generation=[];
  for(const [name,provider]of typed.providers){
    for(const output of provider.outputs){if(outputPaths.has(output))throw new Error('configured compiler products collide');outputPaths.add(output);}
    generation.push({id:'typescript:'+name,kind:'typescript',name,inputs:provider.contract.parsed.fileNames.map(file=>resolve(file)),outputs:[...provider.outputs]});
  }
  const providers=[];
  for(const importer of source.importerIds){
    const root=join(workspace,importer),manifestBytes=reader.bytes(join(root,'package.json')),manifest=JSON.parse(manifestBytes);
    const contract=workspaceModuleGenerationContract({root,manifest});
    if(!contract)continue;
    for(const output of contract.outputs){reader.uncommittedOutput(output);if(outputPaths.has(output))throw new Error('declared source products collide with actual compiler or module products');outputPaths.add(output);}
    const provider={importer,root,manifestBytes,manifest,contract,id:'module:'+manifest.name,kind:'module',inputs:[contract.module],outputs:contract.outputs};
    providers.push(provider);generation.push(provider);
  }
  const assessment=await assessSourceInterfaces({workspace,commit:source.commit,importerIds:source.importerIds,recursiveSource:true,sourceReader:reader});
  const order=workspaceGenerationOrder(generation,assessment);
  await reader.verify();
  const plan={type:'NodeRuntimeWorkspaceGenerationPlan',version:1,sourceCommit:source.commit,
    applicationExecuted:false,productsEmitted:false,
    importerIds:source.importerIds,...(source.filter===undefined?{}:{filter:source.filter}),
    generationOrder:order.map(({provider,requires})=>({producer:provider.id,inputs:provider.inputs,outputs:provider.outputs,requires})),
    sources:[...reader.sources.values()],missing:assessment.missing,unreceived:assessment.unreceived};
  if(options.planOutput!==undefined){
    if(typeof options.planOutput!=='string'||!options.planOutput||options.planOutput.includes('\0'))throw new TypeError('plan output must name a file outside the source workspace');
    const requested=resolve(options.planOutput),output=join(await realpath(dirname(requested)),basename(requested)),offset=relative(workspace,output);
    if(!isAbsolute(offset)&&offset!=='..'&&!offset.startsWith('..'+sep))throw new TypeError('plan output must remain outside the source workspace');
    const held=await lstat(output).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(held&&!held.isFile())throw new TypeError('plan output must be a regular file');
    await writeFile(output,JSON.stringify(plan)+'\n',{mode:0o600});
  }
  if(options.planOnly)return plan;
  if(plan.missing.length)throw new Error('Source interfaces or publication declarations are incomplete:\n'+JSON.stringify(plan.missing));
  for(const {provider}of order){
    if(provider.kind==='typescript'){await typed.emit(provider.name);continue;}
    const {importer,root,manifestBytes,manifest,contract}=provider;
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
  const typescript=await typed.receipt();
  for(const row of typescript.packages)for(const file of row.files){
    if(!outputPaths.has(resolve(workspace,row.importer,file.path)))throw new Error('compiler emitted an undeclared product');
  }
  await reader.verify();
  return {type:'NodeRuntimeWorkspaceEmission',version:1,
    producer:{package:'@red-cup-engineering/node-runtime-release-promotion-service',path:'src/generate-workspace-artifacts.mjs',sha256:sha(await readFile(fileURLToPath(import.meta.url)))},
    sourceCommit:source.commit,sourceLockSha256:sha(reader.bytes(join(workspace,'pnpm-lock.yaml'))),
    sourceConfigurationUnchanged:true,applicationExecuted:false,
    importerIds:source.importerIds,...(source.filter===undefined?{}:{filter:source.filter}),
    generationOrder:order.map(({provider,requires})=>({producer:provider.id,requires})),typescript,packages};
}

