// Adapted from Guix scripts/package-receiving.mjs; provenance retained in
// specifications/packed-package-receiving-provenance.md. No old receipt/layout
// authority or Guix orchestration is imported by the native receiving operation.
import {lstatSync} from 'node:fs';
import {join} from 'node:path';

export function receivingPackageNames(names=[]){
  if(!Array.isArray(names)||names.some(name=>typeof name!=='string'||name.length>214||
      !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name))||
      new Set(names).size!==names.length)
    throw new TypeError('receivingPackages must contain unique package names');
  return names;
}

export function receivingFilePaths(manifest,field='receivingTests'){
  const paths=field==='receivingFixtures'&&manifest[field]===undefined?[]:manifest[field];
  if(!Array.isArray(paths)||(field==='receivingTests'&&!paths.length)||new Set(paths).size!==paths.length||
      paths.some(path=>typeof path!=='string'||!path||
        !path.split('/').every(part=>/^[a-zA-Z0-9._-]+$/.test(part)&&part!=='.'&&part!=='..')))
    throw new TypeError(`invalid ${field} declaration for ${manifest?.name}: expected unique explicit relative file paths`);
  return paths;
}

export function receivingRegularFile(root,path){
  const parts=path.split('/');let current=root;
  for(let index=0;index<parts.length;index++){
    current=join(current,parts[index]);const stat=lstatSync(current);
    if(index===parts.length-1?!stat.isFile():!stat.isDirectory())
      throw new TypeError('receiving path is not a regular file without symlinks: '+path);
  }
  return current;
}
