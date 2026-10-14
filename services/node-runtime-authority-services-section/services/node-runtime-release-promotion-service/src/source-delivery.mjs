import { createHash } from 'node:crypto';
import { realpathSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { relative, sep, isAbsolute, join } from 'node:path';
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

/** Receive finite published source into an existing checkout. The caller must
 * coordinate exclusive writers of this checkout's named paths, index and HEAD
 * throughout prepare/receive. This is a Git custody operation, not an office or
 * effect authorization, and cannot make uncoordinated editors atomic. Child
 * gitlink working bodies are never visited or checked out. Preflight checks
 * precede mutation; interrupted effects or post-effect ref/readback refusals may
 * leave named paths partly received with HEAD unchanged. A new preflight must
 * receive the current public ref and named states before further effects.
 * Explicit correspondence retains held source in the target's public ancestor
 * history even when the approved target supersedes that file. The caller's
 * source judgment owns that replacement; unpublished unique carriers refuse.
 */
export function preparePublishedSourceReceivingSync({ repository, sourceBase, target, ref,
  remote = 'origin', coordinated = false, publicCorrespondence = {} }) {
  repository = realpathSync(repository);
  if (process.env.GIT_INDEX_FILE || process.env.GIT_DIR || process.env.GIT_WORK_TREE)
    throw new TypeError('source receiving cannot use an overridden checkout or index');
  const oid = value => {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value ?? '')) throw new TypeError('source receiving needs full immutable commits');
    return value;
  };
  oid(sourceBase); oid(target);
  if (coordinated !== true) throw new TypeError('source receiving needs caller-coordinated exclusive writers');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(remote)
      || typeof ref !== 'string' || !ref.startsWith('refs/heads/')) throw new TypeError('source receiving needs one exact public branch');
  gitSync(repository, ['check-ref-format', ref]);
  if (realpathSync(gitTextSync(repository, ['rev-parse', '--show-toplevel'])) !== repository)
    throw new TypeError('source receiving requires the checkout owner');
  if (!isAncestorSync(repository, sourceBase, target)) throw new TypeError('source receiving must retain original source history');
  const publicHead = () => {
    const rows = gitTextSync(repository, ['ls-remote', '--refs', remote, ref]).split('\n').filter(Boolean);
    if (rows.length !== 1 || rows[0] !== target + '\t' + ref) throw new TypeError('published source ref differs from the selected target');
  };
  publicHead();
  const paths = String(gitSync(repository, ['diff-tree', '--no-commit-id', '--name-only', '-z', '-r', '--no-renames', sourceBase, target], {maxBuffer: 128 * 1024}))
    .split('\0').filter(Boolean).map(pathOf);
  if (paths.length > 200) throw new TypeError('source receiving exceeds 200 changed paths');
  const attributes = () => {
    if (!paths.length) return [];
    return [[], ['--cached'], ['--source=' + target]].map(selection => {
      const fields = String(gitSync(repository, ['check-attr', ...selection, '-z', '--stdin',
        'filter', 'text', 'eol', 'working-tree-encoding'], {input: paths.join('\0') + '\0', maxBuffer: 128 * 1024})).split('\0');
      for (let offset = 0; offset + 2 < fields.length; offset += 3)
        if (!['unspecified', 'unset'].includes(fields[offset + 2]))
          throw new TypeError('source receiving refuses checkout transformations: ' + fields[offset] + ' ' + fields[offset + 1]);
      return fields;
    });
  };
  const attributeState = attributes();
  const allowed = new Set(paths);
  if (!publicCorrespondence || typeof publicCorrespondence !== 'object' || Array.isArray(publicCorrespondence)
      || Object.keys(publicCorrespondence).some(path => !allowed.has(path))) throw new TypeError('source correspondence must name changed paths only');
  const stateOfEntry = entry => entry === null ? null : {mode: entry.mode, object: entry.object};
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const head = () => gitTextSync(repository, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const before = treeOfSync(repository, sourceBase), after = treeOfSync(repository, target);
  const work = path => {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) {
      try { if (!lstatSync(join(repository, ...parts.slice(0, index))).isDirectory()) throw new TypeError('source parent is not a real directory: ' + path); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }
    let stat; try { stat = lstatSync(join(repository, path)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (stat.isDirectory()) return {directory: true};
    if (stat.size > 16 * 1024 * 1024) throw new TypeError('source receiving carrier exceeds 16 MiB: ' + path);
    const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(join(repository, path)))
      : stat.isFile() ? readFileSync(join(repository, path)) : null;
    if (bytes === null) throw new TypeError('unsupported source carrier: ' + path);
    return {mode: stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644',
      object: gitTextSync(repository, ['hash-object', '--stdin'], {input: bytes})};
  };
  const index = path => {
    const rows = String(gitSync(repository, ['ls-files', '--stage', '-z', '--', path], {env: {GIT_LITERAL_PATHSPECS: '1'}, maxBuffer: 128 * 1024})).split('\0').filter(Boolean);
    if (rows.length === 0) return null;
    if (rows.length !== 1 || !rows[0].endsWith('\t' + path)) throw new TypeError('unmerged or overlapping index source: ' + path);
    const [mode, object, stage] = rows[0].split('\t')[0].split(' ');
    if (stage !== '0') throw new TypeError('unmerged index source: ' + path);
    return {mode, object};
  };
  const observations = paths.map(path => {
    const old = stateOfEntry(entryAtSync(repository, before, path));
    const incoming = stateOfEntry(entryAtSync(repository, after, path));
    if ([old, incoming].some(entry => entry && !['100644', '100755', '120000', '160000'].includes(entry.mode)))
      throw new TypeError('unsupported immutable source carrier: ' + path);
    const held = work(path), staged = index(path);
    let correspondence = null;
    if (publicCorrespondence[path] !== undefined) {
      const commit = oid(publicCorrespondence[path]);
      if (!isAncestorSync(repository, commit, target)) throw new TypeError('held source correspondence is not retained publicly: ' + path);
      correspondence = stateOfEntry(entryAtSync(repository, commit, path));
      if (!correspondence || !['100644', '100755', '120000', '160000'].includes(correspondence.mode))
        throw new TypeError('public held source correspondence needs a supported carrier: ' + path);
    }
    const admitted = value => same(value, old) || same(value, incoming) || correspondence !== null && same(value, correspondence);
    if (!admitted(staged)) throw new TypeError('unique indexed source needs composition: ' + path);
    if (old?.mode === '160000' || incoming?.mode === '160000') {
      if (old?.mode !== incoming?.mode || !held?.directory) throw new TypeError('gitlink carrier transition needs separate receiving: ' + path);
    } else if (!admitted(held)) throw new TypeError('unique working source needs composition: ' + path);
    return {path, old, incoming, held, staged};
  });
  if (head() !== sourceBase) throw new TypeError('source receiving HEAD differs from original source');
  const summary = Object.freeze({sourceBase, target, remote, ref, paths: Object.freeze([...paths]),
    gitlinks: Object.freeze(observations.filter(row => row.incoming?.mode === '160000').map(row => row.path))});
  return Object.freeze({summary, receive() {
    publicHead();
    if (!same(attributes(), attributeState)) throw new TypeError('source receiving checkout attributes changed');
    if (head() !== sourceBase) throw new TypeError('source receiving HEAD changed before mutation');
    for (const row of observations) if (!same(work(row.path), row.held) || !same(index(row.path), row.staged))
      throw new TypeError('source receiving carrier changed before mutation: ' + row.path);
    const restore = (selected, working) => {
      if (!selected.length) return;
      gitSync(repository, ['-c', 'submodule.recurse=false', '-c', 'core.autocrlf=false', 'restore', '--source=' + target, '--staged',
        ...(working ? ['--worktree'] : []), '--pathspec-from-file=-', '--pathspec-file-nul'],
      {input: selected.join('\0') + '\0', env: {GIT_LITERAL_PATHSPECS: '1'}});
    };
    restore(observations.filter(row => row.incoming?.mode !== '160000').map(row => row.path), true);
    restore(summary.gitlinks, false);
    for (const row of observations) {
      if (!same(index(row.path), row.incoming)
          || row.incoming?.mode !== '160000' && !same(work(row.path), row.incoming))
        throw new TypeError('source receiving readback differs: ' + row.path);
    }
    publicHead();
    gitSync(repository, ['update-ref', 'HEAD', target, sourceBase]);
    if (head() !== target) throw new TypeError('source receiving HEAD readback differs');
    return summary;
  }});
}
