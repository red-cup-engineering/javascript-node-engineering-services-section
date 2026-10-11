import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { relative, sep, isAbsolute } from 'node:path';
import { gitSync, gitTextSync, entryAtSync, treeOfSync, writeBlobSync, replaceInTreeSync, derivedCommitSync, isAncestorSync } from './git-objects.mjs';
import { nameCandidateSync } from './integrate.mjs';

const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const contentId = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const pathOf = value => {
  if (typeof value !== 'string' || !value || /[\\\0\n\r\t]/u.test(value)
      || value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    throw new TypeError('delivery needs canonical repository file paths');
  }
  return value;
};

/** Prepare only the exact admitted text transformation. No working tree, index or HEAD is read as source. */
export function prepareSourceDeliverySync({ repository, territory = repository, sourceBase, proposal, proposalId }) {
  repository = realpathSync(repository);
  territory = realpathSync(territory);
  if (realpathSync(gitTextSync(repository, ['rev-parse', '--show-toplevel'])) !== repository) {
    throw new TypeError('delivery repository must be the source checkout root');
  }
  const local = relative(repository, territory);
  if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) throw new TypeError('delivery territory leaves its repository');
  const prefix = local ? pathOf(local.split(sep).join('/')) + '/' : '';
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(sourceBase ?? '')) throw new TypeError('delivery requires the original immutable sourceBase');
  if (!contentId.test(proposalId ?? '')) throw new TypeError('delivery requires its addressed development proposal');
  if (proposal?.type !== 'SoftwareMissionChangeProposal' || !Array.isArray(proposal.changes) || !proposal.changes.length) {
    throw new TypeError('delivery requires the received source transformation');
  }
  const before = treeOfSync(repository, sourceBase);
  const changes = Object.create(null);
  for (const change of proposal.changes) {
    const path = prefix + pathOf(change?.path);
    if (Object.hasOwn(changes, path) || Object.keys(changes).some(other => other.startsWith(path + '/') || path.startsWith(other + '/'))) {
      throw new TypeError('delivery repeats or overlaps a file target');
    }
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) {
      const parent = entryAtSync(repository, before, parts.slice(0, index).join('/'));
      if (parent !== null && parent.type !== 'tree') throw new TypeError('delivery would replace an unadmitted parent');
    }
    const entry = entryAtSync(repository, before, path);
    if (entry !== null && (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))) {
      throw new TypeError('text delivery cannot replace another categorical carrier');
    }
    const bytes = entry === null ? Buffer.alloc(0) : gitSync(repository, ['cat-file', 'blob', entry.object]);
    if (typeof change.beforeExisted !== 'boolean' || change.beforeExisted !== (entry !== null) || digest(bytes) !== change.beforeDigest) {
      throw new TypeError('delivery sourceBase differs from the admitted source: ' + path);
    }
    if (typeof change.afterBytesBase64 !== 'string') throw new TypeError('delivery output needs exact bytes');
    const after = Buffer.from(change.afterBytesBase64, 'base64');
    if (after.toString('base64') !== change.afterBytesBase64 || digest(after) !== change.afterDigest) throw new TypeError('delivery output bytes differ from the admitted digest');
    new TextDecoder('utf-8', { fatal: true }).decode(after);
    if (change.afterExisted !== undefined && typeof change.afterExisted !== 'boolean') throw new TypeError('delivery output existence must be Boolean');
    if (change.afterExisted === false && after.length !== 0) throw new TypeError('absent delivery output has bytes');
    changes[path] = change.afterExisted === false ? null : { mode: entry?.mode ?? '100644', object: writeBlobSync(repository, after) };
  }
  const tree = replaceInTreeSync(repository, before, changes) ?? gitTextSync(repository, ['mktree'], { input: '' });
  const commit = derivedCommitSync(repository, tree, [sourceBase], 'Receive development proposal ' + proposalId + '\n');
  const name = 'development/' + Buffer.from(proposalId.split(';')[1], 'base64url').toString('hex');
  const summary = Object.freeze({ sourceBase, commit, name, proposal: proposalId });
  return Object.freeze({ summary, activate() {
    return nameCandidateSync({ repository, name, commit, sourceBase, message: 'Receive development proposal ' + proposalId });
  } });
}

/** Receive an independently composed source carrier, retiring its repository-link indirection.
 * The source commit must retain the referenced repository's history. This is a Git-tree
 * transformation; a text-write request never acquires permission to replace a gitlink.
 */
export function prepareSourceTreeDeliverySync({repository,sourceBase,proposalId,path,expected,sourceRepository,sourceCommit}) {
 repository=realpathSync(repository); sourceRepository=realpathSync(sourceRepository);path=pathOf(path);
 if(realpathSync(gitTextSync(repository,['rev-parse','--show-toplevel']))!==repository
   ||realpathSync(gitTextSync(sourceRepository,['rev-parse','--show-toplevel']))!==sourceRepository)
  throw new TypeError('source tree delivery requires repository-owned carriers');
 if(!/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(sourceBase??'')||!contentId.test(proposalId??''))throw new TypeError('source tree delivery requires immutable source and proposal identities');
 const before=treeOfSync(repository,sourceBase),entry=entryAtSync(repository,before,path);
 if(!entry||entry.mode!=='160000'||entry.type!=='commit'||expected?.mode!==entry.mode||expected?.object!==entry.object)
  throw new TypeError('source tree delivery source differs from the referenced carrier');
 if(!/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(sourceCommit??'')||!isAncestorSync(sourceRepository,entry.object,sourceCommit))
  throw new TypeError('source tree delivery must preserve the referenced source history');
 const tree=treeOfSync(sourceRepository,sourceCommit);
 // Native Git verifies every imported object; neither checkout nor staging index supplies bytes.
 const pack=gitSync(sourceRepository,['pack-objects','--stdout','--revs'],{input:tree+'\n'});
 gitSync(repository,['unpack-objects','-q'],{input:pack});
 if(gitTextSync(repository,['cat-file','-t',tree])!=='tree')throw new TypeError('delivered source is not a tree');
 const changes={[path]:{mode:'040000',object:tree}};
 const modules=entryAtSync(repository,before,'.gitmodules');
 if(modules){
  if(modules.type!=='blob'||modules.mode!=='100644')throw new TypeError('repository-link declarations must be text');
  const original=gitSync(repository,['cat-file','blob',modules.object]).toString('utf8');
  const config=text=>{try{return gitTextSync(repository,['config','--blob',writeBlobSync(repository,Buffer.from(text)),'--get-regexp','^submodule[.].*[.]path$'],{input:text}).split('\n').filter(Boolean);}catch(e){if(e.status===1)return [];throw e;}};
  const pairs=config(original);const matches=pairs.filter(line=>line.slice(line.search(/\s/)+1)===path);
  if(matches.length!==1)throw new TypeError('source tree delivery requires one exact repository-link declaration');
  const key=matches[0].split(/\s/)[0];
  const blocks=original.split(/(?=^[ \t]*\[)/mu);const retained=blocks.filter(block=>!config(block).some(line=>line.split(/\s/)[0]===key));
  const text=retained.join(''),remaining=config(text);
  if(JSON.stringify(remaining)!==JSON.stringify(pairs.filter(line=>line!==matches[0])))throw new TypeError('source tree delivery would alter unrelated repository links');
  changes['.gitmodules']={mode:modules.mode,object:writeBlobSync(repository,Buffer.from(text))};
 }
 const result=replaceInTreeSync(repository,before,changes);
 const commit=derivedCommitSync(repository,result,[sourceBase],'Receive source tree '+proposalId+'\n');
 const name='development/tree-'+Buffer.from(proposalId.split(';')[1],'base64url').toString('hex');
 const summary=Object.freeze({sourceBase,commit,name,proposal:proposalId,path,sourceCommit,sourceTree:tree});
 return Object.freeze({summary,activate(){return nameCandidateSync({repository,name,commit,sourceBase,message:'Receive source tree '+proposalId});}});
}
