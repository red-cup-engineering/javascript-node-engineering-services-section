#!/usr/bin/env node
import { readFileSync, realpathSync, existsSync, lstatSync } from "node:fs";
import { resolve, relative, join, isAbsolute } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { receiveSelectedSources, selectLockedWorkspaceClosure, readWorkspaceSelectionLock } from "../src/install-workspace-selection.mjs";
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
const root = realpathSync(previous.workspace);
let ids = [...new Set([...previous.importerIds, ...flags.importers])].sort();
if (planned) {
  const commit=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(commit!==previous.commit||createHash('sha256').update(readFileSync(join(root,'pnpm-lock.yaml'))).digest('hex')!==previous.sourceLockSha256)throw new Error('locked source plan differs from its exact committed input');
  const locked=await readWorkspaceSelectionLock({workspace:root,tooling:previous.tooling});
  ids=selectLockedWorkspaceClosure({lockfile:locked,importerIds:ids,workspace:root});
  let mounts=await receiveSelectedSources({root,importerIds:ids,materialize:true,environment:process.env,onOutput:text=>process.stderr.write(text)});
  // Current authored manifests govern workspace demand. A historical lock is
  // resolver input and cannot omit a newly declared supplier. Read only package
  // metadata at its known importer paths in already received source carriers;
  // PNPM still resolves every version/peer/integrity below, never a joined lock.
  const readOwnedManifest=(id)=>{
    const file=resolve(root,id,'package.json');
    if(!existsSync(file))return undefined;
    if(!lstatSync(file).isFile()||realpathSync(file)!==file)throw new Error('provider manifest is redirected: '+id);
    const source=[{path:'.',revision:previous.commit},...mounts].filter(row=>row.path==='.'||id===row.path||id.startsWith(row.path+'/')).sort((a,b)=>b.path.length-a.path.length)[0];
    const repository=source.path==='.'?root:resolve(root,source.path),path=relative(repository,file);
    let committed;try{committed=execFileSync('git',['-c','core.hooksPath=/dev/null','-C',repository,'show',source.revision+':'+path],{env:{...process.env,GIT_NO_LAZY_FETCH:'1'},stdio:['ignore','pipe','ignore']});}catch{return undefined;}
    const bytes=readFileSync(file);if(!bytes.equals(committed))throw new Error('provider manifest differs from exact received source: '+id);
    return JSON.parse(bytes);
  };
  for(;;){
    const selected=ids.map(id=>({id,manifest:readOwnedManifest(id)})),names=new Set(selected.map(row=>row.manifest?.name)),missing=new Set();
    if(selected.some(row=>!row.manifest))throw new Error('selected provider manifest has no received source');
    for(const {manifest}of selected)for(const field of ['dependencies','devDependencies','optionalDependencies'])for(const[name,version]of Object.entries(manifest[field]??{}))if(version.startsWith('workspace:')&&!names.has(name))missing.add(name);
    if(!missing.size)break;
    const candidates=new Map([...missing].map(name=>[name,[]]));
    for(const id of Object.keys(locked.importers)){if(ids.includes(id))continue;const manifest=readOwnedManifest(id);if(candidates.has(manifest?.name))candidates.get(manifest.name).push(id);}
    const additions=[];
    for(const[name,paths]of candidates){if(paths.length!==1)throw new Error('current workspace demand needs one received provider for '+name+': '+paths.length);additions.push(paths[0]);}
    ids=selectLockedWorkspaceClosure({lockfile:locked,importerIds:[...ids,...additions],workspace:root});
    mounts=await receiveSelectedSources({root,importerIds:ids,materialize:true,environment:process.env,onOutput:text=>process.stderr.write(text)});
  }
}
if (flags.sourceLock !== undefined) {
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
const command = [...ids.filter(id => id !== ".").map(id => "--workspace-packages="+id), "install", "--lockfile-only", "--no-frozen-lockfile", "--ignore-scripts", "--prefer-offline"];
const child = spawn(previous.executable, command, {cwd:root, env:process.env, stdio:["ignore", "pipe", "pipe"]});
child.stdout.on("data", chunk => process.stderr.write(chunk));
child.stderr.on("data", chunk => process.stderr.write(chunk));
const code = await new Promise((accept,reject) => {child.on("error",reject);child.on("exit",accept);});
if (code !== 0) throw new Error("pnpm could not resolve the selected composition: " + code);
process.stdout.write(JSON.stringify({type:"NodeRuntimeWorkspaceSelectionResolution",version:1,workspace:root,importerIds:ids,lockOwner:"pnpm",applicationExecuted:false})+"\n");
