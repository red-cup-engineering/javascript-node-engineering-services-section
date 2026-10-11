// Independent processes receive immutable trees, not the platform's moving `current`.
// The installed dependency graph is deliberately conservative: a package's entire
// released contents participate, including assets and dynamically read files.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { selectionEntries } from './release-source.mjs';

const inside = (root, path) => { const p = relative(root, path); return p === '' || (!isAbsolute(p) && p !== '..' && !p.startsWith('..' + sep)); };
const hash = (parts) => { const h = createHash('sha256'); for (const part of parts) { const b = Buffer.from(part); h.update(String(b.length) + ':'); h.update(b); } return h.digest('hex'); };
const fingerprintContext = receipt => hash(['runtime-closure/v1', process.version, process.platform, process.arch, receipt.installKey ?? '']);
const optional = async (action) => { try { return await action(); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const child = (root, path) => { if (!path || isAbsolute(path) || !inside(root, resolve(root, path))) throw new Error('runtime path must be inside its release: ' + path); return resolve(root, path); };

async function link(pointer, target) {
  await mkdir(dirname(pointer), { recursive: true });
  const temporary = pointer + '.' + randomUUID();
  await symlink(target, temporary);
  await rename(temporary, pointer);
}

/** Content of the installed runtime closure; no global checkout aliases or lockfile-wide key. */
export async function runtimeFingerprint(release, project, cache = new Map(), { repository } = {}) {
  const root = await realpath(release);
  const packages = new Map();
  let source;
  if (repository) {
    const key = 'source-selection:' + root;
    if (!cache.has(key)) {
      const receipt = JSON.parse(await readFile(join(root, 'release-receipt.json'), 'utf8'));
      if (receipt.identityVersion !== 1 || !receipt.source?.commit) throw new Error('runtime source must have a verified Git release identity');
      if (receipt.artifactDigest !== basename(root)) throw new Error('runtime receipt must name its admitted release');
      cache.set(key, { receipt, entries: null, derived: receipt.derived ?? [] });
    }
    source = cache.get(key);
    const recorded = source.receipt.runtimeClosures?.[project];
    if (source.receipt.installKey && recorded?.context === fingerprintContext(source.receipt)) return { digest: recorded.digest, packages: recorded.packages };
    source.entries ??= selectionEntries({ ...source.receipt.source, repository });
  }
  async function contents(path, visiting = new Set()) {
    if (cache.has(path)) return cache.get(path);
    if (visiting.has(path)) throw new Error('cyclic runtime source link: ' + path);
    const next = new Set(visiting).add(path);
    const info = await lstat(path);
    let value;
    if (info.isSymbolicLink()) {
      const target = await realpath(path);
      if (!inside(root, target)) throw new Error('runtime source link escapes its release: ' + path);
      value = hash(['link', relative(root, target), await contents(target, next)]);
    } else if (info.isDirectory()) {
      const entries = (await readdir(path)).filter(n => n !== 'node_modules' && n !== '.git').sort();
      const parts = ['directory'];
      for (const name of entries) parts.push(name, await contents(join(path, name), next));
      value = hash(parts);
    } else if (info.isFile()) value = hash(['file', String(info.mode & 0o111), await readFile(path)]);
    else throw new Error('unsupported runtime source: ' + path);
    cache.set(path, value);
    return value;
  }
  async function dependency(from, name) {
    for (let at = from; inside(root, at); at = dirname(at)) {
      const target = await optional(() => realpath(join(at, 'node_modules', name)));
      if (target) {
        if (!inside(root, target)) throw new Error('installed dependency escapes its release: ' + name);
        return target;
      }
      if (at === root) break;
    }
    return null;
  }
  async function visit(directory) {
    directory = await realpath(directory);
    if (!inside(root, directory)) throw new Error('runtime project escapes its release');
    if (packages.has(directory)) return;
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    const edges = [];
    packages.set(directory, edges); // installed peer/workspace cycles are ordinary
    const names = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }).sort();
    for (const name of names) {
      const target = await dependency(directory, name);
      if (!target && manifest.dependencies?.[name] && !manifest.optionalDependencies?.[name]) throw new Error('missing runtime dependency ' + name + ' from ' + directory);
      edges.push(name, target ? relative(root, target) : 'absent');
      if (target) await visit(target);
    }
  }
  await visit(child(root, project));
  const parts = ['runtime-closure/v1', process.version, process.platform, process.arch, project];
  for (const directory of [...packages.keys()].sort()) {
    const path = relative(root, directory);
    let content;
    if (source && !path.startsWith('node_modules/')) {
      const key = 'git-package:' + directory;
      if (!cache.has(key)) {
        const entries = source.entries.filter(e => e.path.startsWith(path + '/'));
        if (entries.length === 0) throw new Error('runtime package is absent from admitted source: ' + path);
        const recorded = entries.flatMap(e => [relative(path, e.path), e.mode, e.oid]);
        for (const e of entries) if (e.mode === '120000') recorded.push(await contents(join(root, e.path)));
        for (const generated of source.derived) if (generated.startsWith(path + '/')) recorded.push(generated, await contents(join(root, generated)));
        cache.set(key, hash(recorded));
      }
      content = cache.get(key);
    } else content = await contents(directory);
    parts.push(path, content, ...packages.get(directory));
  }
  return { digest: hash(parts), packages: packages.size };
}

/** Validate before admission; each existing binding supplies its own comparison baseline. */
export async function prepareRuntimeBindings({ releaseRoot, release, runtimes = [], home, repository }) {
  const cache = new Map();
  const names = new Set();
  const plans = [];
  for (const runtime of runtimes) {
    const { name, file, project, health } = runtime;
    if (!/^[a-z][a-z0-9-]*\.service$/u.test(name ?? '') || names.has(name)) throw new Error('runtime unit name must be unique: ' + name);
    if (!health) throw new Error('runtime requires an observable health receiver: ' + name);
    names.add(name);
    const pointer = join(releaseRoot, 'runtimes', name);
    const beforeLink = await optional(() => readlink(pointer));
    const before = await optional(() => realpath(beforeLink === null ? join(releaseRoot, 'current') : pointer));
    if (beforeLink !== null && !before) throw new Error('runtime binding is dangling: ' + name);
    if (before && (dirname(before) !== releaseRoot)) throw new Error('runtime binding must name one admitted release: ' + name);
    const installedUnit = join(home, '.config/systemd/user', name);
    const beforeUnit = await optional(() => readFile(installedUnit));
    const unit = await readFile(child(release, file));
    const working = /^WorkingDirectory=(.+)$/mu.exec(unit.toString())?.[1]?.replace(/^%h(?=\/|$)/u, home);
    if (!working || resolve(working) !== child(pointer, project)) throw new Error('runtime unit must start from its own binding: ' + name);
    const after = await runtimeFingerprint(release, project, cache, { repository });
    const prior = before ? await runtimeFingerprint(before, project, cache, { repository }) : null;
    plans.push({ ...runtime, pointer, beforeLink, before, installedUnit, beforeUnit, unit, after,
      target: '../' + basename(release), changed: prior?.digest !== after.digest || !unit.equals(beforeUnit ?? Buffer.alloc(0)) });
  }
  // Admission and subsequent promotion share the same installed artifact. Record the
  // established closure in its existing materialization receipt, never in a side registry.
  if (repository && plans.length) {
    const receiptPath = join(release, 'release-receipt.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    receipt.runtimeClosures = { ...receipt.runtimeClosures, ...Object.fromEntries(plans.map(plan => [plan.project, { ...plan.after, context: fingerprintContext(receipt) }])) };
    await writeFile(receiptPath + '.tmp', JSON.stringify(receipt, null, 2) + '\n', { mode: 0o444 });
    await rename(receiptPath + '.tmp', receiptPath);
  }
  return plans;
}

/** A release transaction owns rollback; untouched processes are never restarted on rollback. */
export function runtimeBindingTransaction(plans, { systemctl, healthy, onStep = () => {} }) {
  const touched = [];
  return {
    async apply() {
      for (const plan of plans) {
        const active = (await systemctl(['is-active', plan.name]).catch(() => '')).trim() === 'active';
        touched.push({ plan, active });
        if (plan.changed) {
          await link(plan.pointer, plan.target);
          await mkdir(dirname(plan.installedUnit), { recursive: true });
          await writeFile(plan.installedUnit + '.tmp', plan.unit, { mode: 0o644 });
          await rename(plan.installedUnit + '.tmp', plan.installedUnit);
          await systemctl(['daemon-reload']);
          await systemctl(['enable', plan.name]);
          await systemctl(['restart', plan.name]);
        } else {
          if (plan.beforeLink === null) await link(plan.pointer, '../' + basename(plan.before));
          if (!active) await systemctl(['start', plan.name]);
        }
        if (!(await healthy(plan))) throw new Error('runtime did not answer: ' + plan.name);
        onStep(`${plan.name}: ${plan.changed ? 'received' : 'retained'} ${plan.changed ? basename(plan.target) : basename(plan.before)} (${plan.after.packages} installed packages)`);
      }
    },
    async rollback() {
      for (const { plan, active } of touched.reverse()) {
        if (plan.beforeLink !== null) await link(plan.pointer, plan.beforeLink);
        else await rm(plan.pointer, { force: true });
        if (!plan.changed && active) continue;
        if (plan.beforeUnit) {
          await writeFile(plan.installedUnit + '.tmp', plan.beforeUnit, { mode: 0o644 });
          await rename(plan.installedUnit + '.tmp', plan.installedUnit);
          await systemctl(['daemon-reload']);
          await systemctl([active ? 'restart' : 'stop', plan.name]);
        } else {
          await systemctl(['disable', '--now', plan.name]);
          await rm(plan.installedUnit, { force: true });
          await systemctl(['daemon-reload']);
        }
      }
    },
  };
}

/** Pins survive any number of platform promotions, and also survive removal from a spec. */
export async function retainedRuntimeTargets(releaseRoot) {
  const directory = join(releaseRoot, 'runtimes');
  const targets = [];
  for (const name of await optional(() => readdir(directory)) ?? []) {
    const target = await realpath(join(directory, name));
    if (dirname(target) !== releaseRoot) throw new Error('cannot retire releases with an unverified runtime binding: ' + name);
    targets.push(basename(target));
  }
  return [...new Set(targets)];
}
