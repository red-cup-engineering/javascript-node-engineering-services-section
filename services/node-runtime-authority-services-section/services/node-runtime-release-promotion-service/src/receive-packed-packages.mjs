import assert from 'node:assert/strict';
import {lstatSync,readFileSync,readdirSync,readlinkSync,realpathSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {readNodeWorkspace} from './read-workspace-source.mjs';
import {comparePackedManifest,packedPath,readPackedWorkspacePackages} from './packed-workspace-packages.mjs';
import {receivingFilePaths,receivingPackageNames,receivingRegularFile} from './receiving-declarations.mjs';
import {currentReceivingNode,packageReceivingEnvironment,runReceivingTest,sha256} from './bounded-node-test.mjs';

function selectedTree(runtime,directory){
  const entries=[];
  function visit(current){
    for(const name of readdirSync(current).sort()){
      // Dependencies retain their native package identities, not parent custody.
      if(name==='node_modules')continue;
      const file=join(current,name),stat=lstatSync(file),path=relative(directory,file);
      if(stat.isDirectory()){entries.push({path,kind:'directory'});visit(file);}
      else if(stat.isFile())entries.push({path,kind:'file',executable:Boolean(stat.mode&0o111),sha256:sha256(readFileSync(file))});
      else if(stat.isSymbolicLink())entries.push({path,kind:'link',target:readlinkSync(file),resolved:packedPath(runtime,file)});
      else throw new TypeError('selected packed owner has unsupported file type: '+file);
    }
  }
  visit(directory);return entries;
}

function packedIdentity(packed,names){
  return {runtime:packed.runtime,packages:packed.packages.map(item=>({directory:item.directory,
    aliases:item.aliases,manifest:sha256(item.manifestBytes)})),
    selected:packed.packages.filter(item=>names.includes(item.manifest.name)).map(item=>({directory:item.directory,tree:selectedTree(packed.runtime,item.directory)}))};
}

/** Receive only committed consumer-selected offline fixture suites in the real
 * packed PNPM output. This does not write or accept a deployment receipt. */
export async function receivePackedPackages(options={}){
  let phase='admission';
  const result={status:'refused',satisfied:false,enrolled:0,executedFiles:0,executedCases:0,skippedCases:0,todoCases:0,packages:[]};
  try{
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['workspace','pnpm','runtime'].includes(key)))
      throw new TypeError('receiving accepts only workspace, pnpm and runtime');
    const {workspace,pnpm,runtime}=options;
    if(typeof runtime!=='string'||!runtime)throw new TypeError('packed runtime root is required');
    const source=await readNodeWorkspace({workspace,pnpm});
    result.sourceCommit=source.commit;
    const owners=source.importerIds.map(id=>({id,directory:resolve(source.workspace,id),manifest:JSON.parse(source.reader.bytes(join(source.workspace,id,'package.json')))}));
    const packed=readPackedWorkspacePackages(runtime);result.runtime=packed.runtime;
    const uniqueOwner=name=>{
      const matches=owners.filter(owner=>owner.manifest.name===name);
      if(matches.length!==1)throw new TypeError('receiving source owner is not unique: '+name);
      return matches[0];
    };
    const root=packed.packages[0],rootOwner=uniqueOwner(root.manifest.name);
    comparePackedManifest(root.manifest,rootOwner.manifest);
    assert.deepEqual(root.manifest.receivingPackages,rootOwner.manifest.receivingPackages,'packed receivingPackages differs from committed consumer');
    const names=receivingPackageNames(rootOwner.manifest.receivingPackages);
    result.enrolled=names.length;
    for(const name of names){
      const owner=uniqueOwner(name),matches=packed.packages.filter(item=>item.manifest.name===name);
      if(matches.length!==1)throw new TypeError('receiving packed owner is missing or ambiguous: '+name);
      const actual=matches[0];comparePackedManifest(actual.manifest,owner.manifest);
      for(const field of ['receivingTests','receivingFixtures'])
        assert.deepEqual(actual.manifest[field],owner.manifest[field],'packed '+field+' differs from committed provider: '+name);
      const tests=receivingFilePaths(owner.manifest),fixtures=receivingFilePaths(owner.manifest,'receivingFixtures');
      const item={name,version:owner.manifest.version,sourcePath:owner.id,directory:actual.directory,tests:[],fixtures:[]};
      result.packages.push(item);
      for(const [paths,target] of [[tests,item.tests],[fixtures,item.fixtures]])for(const path of paths){
        const file=join(owner.directory,path),bytes=source.reader.bytes(file),packedFile=receivingRegularFile(actual.directory,path);
        assert.ok(bytes.equals(readFileSync(packedFile)),'packed receiving bytes differ from committed provider: '+name+':'+path);
        const fact=source.reader.object(file);
        target.push({path,gitBlob:fact.identity,sourceCommit:fact.sourceCommit,sha256:sha256(bytes),...(target===item.tests?{status:'unexecuted',executed:false}:{})});
      }
    }
    const identity=packedIdentity(packed,names);
    result.node=currentReceivingNode();
    const verify=async()=>{
      // Both checks run even if one fails so refusal never omits either boundary.
      const failures=[];
      try{await source.reader.verify();}catch(error){failures.push('source: '+error.message);}
      try{
        assert.equal(realpathSync(resolve(runtime)),packed.runtime,'runtime location changed');
        assert.deepEqual(packedIdentity(readPackedWorkspacePackages(runtime),names),identity,'packed identity changed');
        for(const item of result.packages)for(const {path,sha256:expected} of [...item.tests,...item.fixtures])
          assert.equal(sha256(readFileSync(receivingRegularFile(item.directory,path))),expected,'selected receiving file changed');
        assert.deepEqual(currentReceivingNode(),result.node,'invoking Node identity changed');
      }catch(error){failures.push('packed/tool: '+error.message);}
      if(failures.length)throw new Error(failures.join('\n'));
    };
    phase='identity';await verify();
    if(!names.length){result.status='not-enrolled';return result;}
    const environment=packageReceivingEnvironment(result.node.executable);
    for(const item of result.packages)for(const test of item.tests){
      phase='execution';
      const observation=await runReceivingTest({file:join(item.directory,test.path),directory:item.directory,node:result.node.executable,environment});
      Object.assign(test,observation);
      if(test.executed)result.executedFiles++;
      result.executedCases+=test.tap.executed??0;result.skippedCases+=test.tap.skipped??0;result.todoCases+=test.tap.todo??0;
      phase='identity';await verify();
      if(test.status!=='passed'){phase='execution';throw new Error('selected receiving test '+test.status+': '+item.name+':'+test.path);}
    }
    result.status='received';result.satisfied=true;return result;
  }catch(error){
    result.status='refused';result.satisfied=false;result.refusal={phase,message:error.message};
    error.result=result;throw error;
  }
}
