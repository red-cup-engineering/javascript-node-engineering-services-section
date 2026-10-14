#!/usr/bin/env node
import { readFileSync, realpathSync, existsSync, lstatSync } from "node:fs";
import { resolve, relative, join, isAbsolute, matchesGlob } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { receiveSelectedSources, selectLockedWorkspaceClosure, selectDeclaredWorkspaceClosure, readWorkspaceSelectionLock, verifyWorkspaceSelection, exactImporterFilterArgs } from "../src/install-workspace-selection.mjs";
const producerFile=fileURLToPath(import.meta.url),producerRoot=execFileSync('git',['-C',dirname(producerFile),'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const producerCommit=execFileSync('git',['-C',producerRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),producerPath=relative(producerRoot,producerFile);
const producerBytes=readFileSync(producerFile),committedProducer=execFileSync('git',['-C',producerRoot,'show',producerCommit+':'+producerPath]);
if(!producerBytes.equals(committedProducer))throw new Error('source resolver differs from its committed producer');
const args = process.argv.slice(2), flags = { importers: [] };
for (let at = 0; at < args.length; at += 2) {
  if (!["--receipt", "--importer", "--source-lock"].includes(args[at]) || !args[at+1]) throw new TypeError("resolve-workspace-selection --receipt <installed receipt> [--importer <new project>...] [--source-lock <upstream lock>]");
  if (args[at] === "--importer") flags.importers.push(args[at+1]);
  else if (args[at] === "--source-lock") flags.sourceLock = args[at+1];
  else flags.receipt = args[at+1];
}
const previous = JSON.parse(readFileSync(flags.receipt, "utf8"));
const planned = previous.type === "NodeRuntimeLockedSourceSelection";
if ((!planned && (previous.type !== "NodeRuntimeWorkspaceSelectionInstallReceipt" || previous.status !== "installed")) || previous.sourceConfigurationUnchanged !== true) throw new TypeError("an unchanged installed selection or locked source plan is required");
const root = planned ? realpathSync(previous.workspace) : await verifyWorkspaceSelection(previous);
let ids = [...new Set([...previous.importerIds, ...flags.importers])].sort();
if (planned) {
  const commit=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(commit!==previous.commit||createHash('sha256').update(readFileSync(join(root,'pnpm-lock.yaml'))).digest('hex')!==previous.sourceLockSha256)throw new Error('locked source plan differs from its exact committed input');
  const locked=await readWorkspaceSelectionLock({workspace:root,tooling:previous.tooling});
  // An authored provider may have no historical importer yet. Follow existing
  // locked edges, and keep new demand for exact-source manifest receiving below.
  const lockedClosure=inputs=>[...new Set([...selectLockedWorkspaceClosure({lockfile:locked,
    importerIds:inputs.filter(id=>Object.hasOwn(locked.importers,id)),workspace:root}),...inputs])].sort();
  ids=lockedClosure(ids);
  let mounts=await receiveSelectedSources({root,importerIds:ids,materialize:true,environment:process.env,onOutput:text=>process.stderr.write(text)});
  // Current authored manifests govern demand; the old lock is resolution input.
  // New package owners are discovered from the committed source objects in
  // received mounts, under the authored PNPM workspace patterns. Only demanded
  // owner bodies are materialized. PNPM derives every new importer below.
  const workspaceFile=join(root,'pnpm-workspace.yaml');
  if(!lstatSync(workspaceFile).isFile()||realpathSync(workspaceFile)!==workspaceFile
    ||!readFileSync(workspaceFile).equals(execFileSync('git',['-C',root,'show',previous.commit+':pnpm-workspace.yaml'])))throw new Error('workspace patterns differ from committed source');
  const workspacePatterns=JSON.parse(execFileSync(previous.executable,['config','get','packages','--json'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  if(!Array.isArray(workspacePatterns)||workspacePatterns.some(pattern=>typeof pattern!=='string'))throw new Error('source workspace must declare package patterns');
  const workspaceOwner=id=>id==='.'||(workspacePatterns.some(pattern=>!pattern.startsWith('!')&&matchesGlob(id,pattern))
    &&!workspacePatterns.some(pattern=>pattern.startsWith('!')&&matchesGlob(id,pattern.slice(1))));
  const committedCandidates=()=>{
    const found=new Set(Object.keys(locked.importers).filter(workspaceOwner));
    for(const source of [{path:'.',revision:previous.commit},...mounts]){
      const repository=source.path==='.'?root:resolve(root,source.path);
      const files=execFileSync('git',['-c','core.hooksPath=/dev/null','-C',repository,'ls-tree','-r','-z','--name-only',source.revision],{encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
      for(const file of files.split('\0').filter(file=>file==='package.json'||file.endsWith('/package.json'))){
        const id=relative(root,resolve(repository,dirname(file))).split('\\').join('/')||'.';
        if(workspaceOwner(id))found.add(id);
      }
    }
    return [...found].sort();
  };
  const readOwnedManifest=(id)=>{
    const file=resolve(root,id,'package.json');
    const offset=relative(root,file);if(isAbsolute(offset)||offset==='..'||offset.startsWith('../')||typeof id!=='string'||id.includes('\0'))throw new Error('provider metadata leaves the selected source root');
    if(!workspaceOwner(id))throw new Error('provider is outside authored workspace patterns: '+id);
    if(existsSync(file)&&(!lstatSync(file).isFile()||realpathSync(file)!==file))throw new Error('provider manifest is redirected: '+id);
    const source=[{path:'.',revision:previous.commit},...mounts].filter(row=>row.path==='.'||id===row.path||id.startsWith(row.path+'/')).sort((a,b)=>b.path.length-a.path.length)[0];
    const repository=source.path==='.'?root:resolve(root,source.path),path=relative(repository,file);
    const entry=execFileSync('git',['-c','core.hooksPath=/dev/null','-C',repository,'ls-tree',source.revision,'--',path],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    if(!entry)return undefined;
    if(!/^(100644|100755) blob [a-f0-9]{40}\t/u.test(entry))throw new Error('provider metadata must be a committed regular file: '+id);
    const committed=execFileSync('git',['-c','core.hooksPath=/dev/null','-C',repository,'show',source.revision+':'+path],{stdio:['ignore','pipe','pipe']});
    if(existsSync(file)&&!readFileSync(file).equals(committed))throw new Error('provider manifest differs from exact received source: '+id);
    return JSON.parse(committed);
  };
  for(;;){
    const selected=ids.map(id=>({id,manifest:readOwnedManifest(id)})),names=new Set(selected.map(row=>row.manifest?.name)),missing=new Set();
    if(selected.some(row=>!row.manifest))throw new Error('selected provider manifest has no received source');
    for(const {manifest}of selected)for(const field of ['dependencies','devDependencies','optionalDependencies'])for(const[name,version]of Object.entries(manifest[field]??{}))if(version.startsWith('workspace:')&&!names.has(name))missing.add(name);
    if(!missing.size)break;
    const candidates=new Map([...missing].map(name=>[name,[]]));
    for(const id of committedCandidates()){if(ids.includes(id))continue;const manifest=readOwnedManifest(id);if(candidates.has(manifest?.name))candidates.get(manifest.name).push(id);}
    const additions=[];
    for(const[name,paths]of candidates){if(paths.length!==1)throw new Error('current workspace demand needs one received provider for '+name+': '+paths.length);additions.push(paths[0]);}
    ids=lockedClosure([...ids,...additions]);
    mounts=await receiveSelectedSources({root,importerIds:ids,materialize:true,environment:process.env,onOutput:text=>process.stderr.write(text)});
  }
}
if (flags.sourceLock !== undefined) {
  if (resolve(flags.sourceLock) !== join(dirname(resolve(flags.sourceLock)), "pnpm-lock.yaml")) throw new TypeError("upstream source lock must name its actual pnpm-lock.yaml carrier");
  const require = createRequire(resolve(previous.tooling, "package.json"));
  const { readWantedLockfile } = await import(pathToFileURL(require.resolve("@pnpm/lockfile.fs")).href);
  const supplied = await readWantedLockfile(dirname(resolve(flags.sourceLock)), { ignoreIncompatible: false });
  const current = await readWantedLockfile(root, { ignoreIncompatible: false });
  if (String(supplied.lockfileVersion) !== String(current.lockfileVersion)) throw new TypeError("upstream and receiving locks use different codecs");
  // Read supplementary supplier paths, retaining the receiving composition's
  // existing links. pnpm resolves the actual manifests below; no joined lock is written.
  ids = selectLockedWorkspaceClosure({ lockfile: { ...supplied, importers: { ...supplied.importers, ...current.importers } }, importerIds: ids, workspace: root });
  await receiveSelectedSources({ root, importerIds: ids, materialize: true, environment: process.env, onOutput: text => process.stderr.write(text) });
}
// Historical closure is acquisition evidence, not current demand. Recompute
// the final selection from the explicitly requested roots and received source
// manifests before PNPM resolution, so retired declarations cannot pin scope.
const acquiredImporterCount=ids.length;
ids=selectDeclaredWorkspaceClosure({workspace:root,
  importerIds:[...(previous.roots??previous.importerIds),...flags.importers],
  projects:ids.map(id=>({id,manifest:JSON.parse(readFileSync(join(root,id,"package.json"),"utf8"))}))});
const names = new Set();
for (const id of ids) {
  const offset = relative(root, resolve(root, id));
  if (isAbsolute(offset) || offset === ".." || offset.startsWith("../")) throw new TypeError("project leaves the receiving workspace");
  const manifest = JSON.parse(readFileSync(join(root,id,"package.json"), "utf8"));
  if (names.has(manifest.name)) throw new TypeError("competing project name in the selected composition: " + manifest.name);
  names.add(manifest.name);
}
for (const id of ids) {
  const manifest = JSON.parse(readFileSync(join(root,id,"package.json"), "utf8"));
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) for (const [name, version] of Object.entries(manifest[field] ?? {})) {
    if (version.startsWith("workspace:") && !names.has(name)) throw new TypeError("selected composition lacks " + name + " required by " + manifest.name);
  }
}
// An unchanged installed demand already has a frozen pnpm receiving receipt.
// Avoid mutable resolution, network discovery and a source write for that case.
if(!planned&&flags.sourceLock===undefined&&flags.importers.every(id=>previous.importerIds.includes(id))
  &&ids.length===previous.importerIds.length&&ids.every(id=>previous.importerIds.includes(id))){
  process.stdout.write(JSON.stringify({type:'NodeRuntimeWorkspaceSelectionResolution',version:1,workspace:root,
    importerIds:ids,acquiredImporterCount,lockOwner:'pnpm',sourceConfigurationUnchanged:true,resolutionRequired:false,
    applicationExecuted:false})+'\n');
  process.exit(0);
}
const command = [...ids.map(id => "--workspace-packages="+id), ...exactImporterFilterArgs(ids), "install", "--lockfile-only", "--no-frozen-lockfile", "--ignore-scripts", "--prefer-offline"];
const child = spawn(previous.executable, command, {cwd:root, env:process.env, stdio:["ignore", "pipe", "pipe"]});
child.stdout.on("data", chunk => process.stderr.write(chunk));
child.stderr.on("data", chunk => process.stderr.write(chunk));
const code = await new Promise((accept,reject) => {child.on("error",reject);child.on("exit",accept);});
if (code !== 0) throw new Error("pnpm could not resolve the selected composition: " + code);
if(!readFileSync(producerFile).equals(producerBytes))throw new Error('source resolver changed during resolution');
process.stdout.write(JSON.stringify({type:"NodeRuntimeWorkspaceSelectionResolution",version:1,workspace:root,importerIds:ids,acquiredImporterCount,lockOwner:"pnpm",applicationExecuted:false,
 inputCommit:previous.commit,inputSourceLockSha256:previous.sourceLockSha256??previous.sourceHashes['pnpm-lock.yaml'],resolvedSourceLockSha256:createHash('sha256').update(readFileSync(join(root,'pnpm-lock.yaml'))).digest('hex'),
 producer:{repository:'red-cup-engineering/computer-code-engineering-services-section',commit:producerCommit,path:producerPath,sha256:createHash('sha256').update(producerBytes).digest('hex')}})+"\n");
