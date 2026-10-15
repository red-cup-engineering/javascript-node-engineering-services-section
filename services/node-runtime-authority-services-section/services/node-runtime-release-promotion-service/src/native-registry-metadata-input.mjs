// Build-only orchestration. Admission happens before dynamic loading of the provider
// whose literal PNPM imports remain visible to the ordinary external-import audit.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, lstat, mkdir, readFile, readdir, readlink, realpath, chmod, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readNodeWorkspace, workspaceSourceReader } from './read-workspace-source.mjs';
import { runtimeFingerprint } from './runtime-bindings.mjs';
import { assertInterpreterSearchPath, assertNormalInvocation, assertOwnerStage, METADATA_SCHEMA, PNPM_VERSION, requireInput } from './native-registry-metadata-contract.mjs';

const run = promisify(execFile);
const ownerRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const canonical = value => JSON.stringify(value, (_, child) => child && !Array.isArray(child) && typeof child === 'object'
  ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const identityOf = value => sha256(canonical(value));
const inside = (root, path) => { const p = relative(root, path); return p === '' || (!isAbsolute(p) && p !== '..' && !p.startsWith('..' + sep)); };
const moduleFiles = ['src/native-registry-metadata-contract.mjs', 'src/native-registry-metadata-provider.mjs',
  'src/native-registry-metadata-input.mjs', 'scripts/acquire-registry-metadata.mjs',
  'data/records/native-registry-metadata-suppliers.json', 'package.json', '.npmignore', 'src/read-workspace-source.mjs',
  'src/runtime-bindings.mjs', 'src/release-source.mjs', 'src/git-objects.mjs', 'src/release-digest.mjs', 'src/tree-carry.mjs'];

async function packageContaining(file) {
  let at = dirname(await realpath(file));
  for (;;) {
    try { return { root: at, manifest: JSON.parse(await readFile(join(at, 'package.json'), 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    requireInput(dirname(at) !== at, 'metadata-supplier-manifest-missing');
    at = dirname(at);
  }
}

/** The CLI bundles undeclared dist/node_modules. Bind its complete distribution,
 * including those bytes; a dependency-only fingerprint would omit them. */
async function distributionDigest(root) {
  const entries = [];
  async function walk(path) {
    const info = await lstat(path), name = relative(root, path).split(sep).join('/');
    if (info.isSymbolicLink()) {
      requireInput(inside(root, await realpath(path)), 'metadata-cli-link-escape');
      entries.push([name, 'link', await readlink(path)]);
    } else if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await walk(join(path, name));
    } else {
      requireInput(info.isFile(), 'metadata-cli-distribution-shape');
      entries.push([name, info.mode & 0o111, sha256(await readFile(path))]);
    }
  }
  await walk(root);
  return { digest: identityOf(entries), files: entries.length };
}

async function cliIdentity(pnpm) {
  assertNormalInvocation(process.execArgv, process.env);
  requireInput(typeof pnpm === 'string' && isAbsolute(pnpm), 'metadata-exact-cli-path-required');
  const executable = await realpath(pnpm), supplier = await packageContaining(executable);
  requireInput(supplier.manifest.name === 'pnpm' && supplier.manifest.version === PNPM_VERSION,
    'metadata-cli-cohort-mismatch');
  const declaredBin = typeof supplier.manifest.bin === 'string' ? supplier.manifest.bin : supplier.manifest.bin?.pnpm;
  requireInput(typeof declaredBin === 'string' && await realpath(resolve(supplier.root, declaredBin)) === executable,
    'metadata-cli-launcher-unreceived');
  requireInput((await readFile(executable, 'utf8')).split('\n')[0] === '#!/usr/bin/env node',
    'metadata-cli-interpreter-unreceived');
  let nodeSlot;
  for (const segment of assertInterpreterSearchPath(process.env.PATH)) {
    const candidate = join(segment, 'node');
    try {
      await access(candidate, fsConstants.X_OK);
      if ((await lstat(await realpath(candidate))).isFile()) { nodeSlot = candidate; break; }
    } catch (error) { if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error; }
  }
  const nodeExecutable = await realpath(process.execPath);
  requireInput(nodeSlot && await realpath(nodeSlot) === nodeExecutable, 'metadata-cli-interpreter-unreceived');
  return { version: PNPM_VERSION, executable, package: supplier.root, ...await distributionDigest(supplier.root),
    nodeVersion: process.version, nodeExecutable, nodeExecutableSha256: sha256(await readFile(nodeExecutable)),
    nodeInvocation: { execArgv: [...process.execArgv], pathSlot: nodeSlot,
      pathSlotLink: (await lstat(nodeSlot)).isSymbolicLink() ? await readlink(nodeSlot) : null,
      interpreterLauncher: '/usr/bin/env', interpreterLauncherSha256: sha256(await readFile('/usr/bin/env')),
      unsupportedResolutionControls: 'refused; caller must enforce before process launch' } };
}

/** Uncached filesystem resolution records the actual package slot, including
 * every intervening link. Node's require/ESM resolution caches are not an oracle
 * for a later observation after a node_modules link has changed. */
async function observePackageSlot(workspace, from, name) {
  requireInput(/^(?:@[^/]+\/)?[^/]+$/u.test(name) && !['.', '..'].includes(name), 'metadata-dependency-name-unreceived');
  for (let directory = from; inside(workspace, directory); directory = dirname(directory)) {
    // Node skips node_modules/node_modules at this ancestor. The shared helper
    // walks all ancestors; refuse the discrepant slot instead of changing it.
    if (basename(directory) === 'node_modules') {
      const duplicate = await lstat(join(directory, 'node_modules')).catch(error => {
        if (error.code === 'ENOENT') return null; throw error;
      });
      requireInput(!duplicate, 'metadata-duplicate-module-slot-unreceived');
    }
    const slot = join(directory, 'node_modules', name);
    const info = await lstat(slot).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (info) {
      const root = await realpath(slot);
      requireInput(inside(workspace, root), 'metadata-installed-supplier-escape');
      const links = [];
      let at = workspace;
      for (const segment of relative(workspace, slot).split(sep)) {
        at = join(at, segment);
        const state = await lstat(at);
        if (state.isSymbolicLink()) links.push({ path: relative(workspace, at), target: await readlink(at), realpath: relative(workspace, await realpath(at)) });
      }
      const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      return { root, manifest, slot: relative(workspace, slot), links };
    }
    if (directory === workspace) break;
  }
  return null;
}
export async function observeSupplierSlot(workspace, from, name) {
  const installed = await observePackageSlot(workspace, from, name);
  requireInput(installed, 'metadata-installed-supplier-missing');
  requireInput(installed.manifest.type === 'module' && installed.manifest.exports?.['.'] === './lib/index.js',
    'metadata-supplier-export-unreceived');
  const entry = await realpath(join(installed.root, installed.manifest.exports['.']));
  requireInput(inside(installed.root, entry), 'metadata-supplier-export-escape');
  return { ...installed, entry };
}

/** A deliberately bounded installed layout for this exact supplier cohort. The
 * shared fingerprint omits node_modules inside package contents, so refuse those
 * import shadows before provider loading. The genuine isolated installation has
 * only package-root node_modules/.bin wrappers; bind those separately. Refuse
 * package-content symlinks rather than assuming their import parent is unchanged.
 * This does not change runtimeFingerprint's other callers. */
export async function observeSupplierClosure(workspace, roots) {
  const packages = new Map();
  async function visit(root) {
    if (packages.has(root)) return;
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const row = { project: relative(workspace, root), edges: [], ignoredBytes: [] };
    packages.set(root, row);
    async function content(path, inBin = false) {
      const state = await lstat(path);
      requireInput(!state.isSymbolicLink(), 'metadata-package-content-link-unreceived');
      requireInput(state.isFile() || state.isDirectory(), 'metadata-package-content-shape-unreceived');
      if (state.isDirectory()) {
        for (const name of (await readdir(path)).sort()) {
          if (name === 'node_modules') {
            requireInput(path === root && !inBin, 'metadata-nested-module-slot-unreceived');
            const modules = join(path, name), state = await lstat(modules);
            requireInput(state.isDirectory() && !state.isSymbolicLink(), 'metadata-package-content-link-unreceived');
            const names = await readdir(modules);
            requireInput(names.every(value => value === '.bin'), 'metadata-package-root-module-slot-unreceived');
            // Include the empty directory state, too. No omitted module-bearing
            // path or symlink is allowed under this bounded root .bin exception.
            row.ignoredBytes.push(['node_modules', names]);
            if (names.length) await content(join(modules, '.bin'), true);
          } else {
            requireInput(name !== '.git', 'metadata-package-git-directory-unreceived');
            await content(join(path, name), inBin);
          }
        }
      } else if (inBin) row.ignoredBytes.push([relative(root, path), state.mode & 0o111, sha256(await readFile(path))]);
    }
    await content(root);
    const names = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }).sort();
    for (const name of names) {
      const installed = await observePackageSlot(workspace, root, name);
      requireInput(installed || !manifest.dependencies?.[name] || manifest.optionalDependencies?.[name],
        'metadata-installed-dependency-missing');
      row.edges.push({ name, ...(installed ? { project: relative(workspace, installed.root),
        slot: installed.slot, links: installed.links } : { absent: true }) });
      if (installed) await visit(installed.root);
    }
  }
  for (const root of roots) await visit(root);
  return [...packages.values()].sort((a, b) => a.project.localeCompare(b.project));
}

async function supplierIdentity(workspace, cohort, pnpm) {
  const instances = [], cache = new Map(); // Never share this cache between observations.
  for (const supplier of cohort.suppliers) {
    const installed = await observeSupplierSlot(workspace, join(ownerRoot, 'src'), supplier.name);
    requireInput(installed.manifest.name === supplier.name && installed.manifest.version === supplier.version,
      'metadata-installed-supplier-mismatch');
    const project = relative(workspace, installed.root).split(sep).join('/');
    instances.push({ name: supplier.name, version: supplier.version, project, slot: installed.slot, links: installed.links,
      entry: relative(workspace, installed.entry).split(sep).join('/'),
      ...await runtimeFingerprint(workspace, project, cache) });
  }
  const slots = await observeSupplierClosure(workspace, instances.map(instance => resolve(workspace, instance.project)));
  return { instances, slots, cli: await cliIdentity(pnpm) };
}

export async function admitNativeMetadataInput({ workspace, pnpm, stage }) {
  const manifest = JSON.parse(await readFile(join(ownerRoot, 'package.json'), 'utf8'));
  const cohort = JSON.parse(await readFile(join(ownerRoot, 'data/records/native-registry-metadata-suppliers.json'), 'utf8'));
  assertOwnerStage(manifest, stage, cohort);
  // Validate the exact selected CLI before any source inventory command executes it.
  const initialCli = await cliIdentity(pnpm);
  const root = await realpath(resolve(workspace));
  const commit = (await run('git', ['-C', root, 'rev-parse', 'HEAD^{commit}'])).stdout.trim();
  const earlySource = await workspaceSourceReader({ workspace: root, commit, importerIds: ['.'], recursive: true });
  for (const file of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) earlySource.bytes(join(root, file));
  for (const file of ['.npmrc', '.pnpmfile.cjs', '.pnpmfile.mjs']) {
    const present = await lstat(join(root, file)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (present) earlySource.bytes(join(root, file));
  }
  for (const file of moduleFiles) earlySource.bytes(join(ownerRoot, file));
  const suppliers = await supplierIdentity(root, cohort, pnpm);
  requireInput(identityOf(initialCli) === identityOf(suppliers.cli), 'metadata-cli-changed');
  const provider = await import('./native-registry-metadata-provider.mjs');
  const esmEntries = provider.nativeSupplierImports();
  for (const instance of suppliers.instances) requireInput(
    await realpath(fileURLToPath(esmEntries[instance.name])) === resolve(root, instance.entry), 'metadata-supplier-esm-target-mismatch');
  // PNPM list initializes pnpmfiles. Refuse all unreceived hooks/helpers/config
  // dependencies using the admitted native config reader BEFORE inventory CLI.
  const rootManifest = JSON.parse(earlySource.bytes(join(root, 'package.json')));
  const configuration = await provider.nativeConfig(root, { inventory: true, rootManifest });
  await earlySource.verify();
  requireInput(identityOf(await supplierIdentity(root, cohort, pnpm)) === identityOf(suppliers), 'metadata-supplier-changed');
  const source = await readNodeWorkspace({ workspace: root, pnpm });
  const project = relative(source.workspace, ownerRoot).split(sep).join('/');
  requireInput(source.importerIds.includes(project) && inside(source.workspace, ownerRoot), 'metadata-owner-outside-workspace');
  requireInput(project.endsWith('services/node-runtime-authority-services-section/services/node-runtime-release-promotion-service'),
    'metadata-owner-path-mismatch');
  for (const file of moduleFiles) source.reader.bytes(join(ownerRoot, file));
  const lock = await provider.nativeLock(source.workspace, configuration.config);
  const installedGraph = await provider.receiveInstalledSupplierGraph(source.workspace, project, cohort);
  const records = provider.nativeRecords(lock, configuration.config); // Entire lock, before acquisition.
  const importer = lock.importers[project];
  for (const supplier of cohort.suppliers) {
    const declaration = importer?.devDependencies?.[supplier.name];
    requireInput(declaration?.specifier === supplier.version, 'metadata-supplier-lock-declaration-mismatch');
    const record = records.registry.find(row => row.entry.name === supplier.name && row.entry.version === supplier.version);
    requireInput(record?.resolution.integrity === supplier.integrity, 'metadata-supplier-lock-integrity-mismatch');
  }
  const binding = {
    schema: METADATA_SCHEMA, owner: manifest.name, stage,
    source: { commit: source.commit, mounts: source.reader.mounts,
      files: [...source.reader.sources.values()].sort((a, b) => a.path.localeCompare(b.path)) },
    suppliers: { ...suppliers, installedGraph }, policy: configuration.identity,
    coverage: { total: records.total, registry: records.registry.length, nonRegistry: records.nonRegistry.length,
      nativeSelectionsSha256: identityOf(records) },
  };
  async function verifyUnchanged() {
    await source.reader.verify();
    requireInput(identityOf(await supplierIdentity(source.workspace, cohort, pnpm)) === identityOf(suppliers),
      'metadata-supplier-changed');
    const current = await provider.nativeConfig(source.workspace, { inventory: true, rootManifest });
    requireInput(identityOf(current.identity) === identityOf(configuration.identity), 'metadata-policy-changed');
    await provider.nativeLock(source.workspace, current.config);
  }
  return { workspace: source.workspace, provider, config: configuration.config, records, binding, verifyUnchanged };
}

async function writeExclusive(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
async function freezeTree(path) {
  const info = await lstat(path);
  requireInput(!info.isSymbolicLink(), 'metadata-snapshot-link-refused');
  if (info.isDirectory()) { for (const child of await readdir(path)) await freezeTree(join(path, child)); await chmod(path, 0o500); }
  else { requireInput(info.isFile(), 'metadata-snapshot-shape-refused'); await chmod(path, 0o400); }
}
export function assertAcquisitionBinding(acquisition, binding) {
  requireInput(acquisition.schema === METADATA_SCHEMA && identityOf(acquisition.binding) === identityOf(binding),
    'metadata-input-binding-mismatch');
  requireInput(Number.isFinite(Date.parse(acquisition.startedAt)) && Number.isFinite(Date.parse(acquisition.finishedAt)) &&
    acquisition.startedAt <= acquisition.finishedAt, 'metadata-acquisition-interval-invalid');
}
export function assertRetainedNativeFiles(actual, expected) {
  requireInput(identityOf(actual) === identityOf(expected), 'metadata-input-digest-mismatch');
}
/** Refuse lexical aliases before effects. Every existing ancestor must be a
 * real directory, and the canonical output must be disjoint from source. This
 * same admission is used by acquisition, receiving and later verification. */
export async function admitMetadataOutput(workspace, output, { create = false } = {}) {
  requireInput(typeof output === 'string' && output.length > 0, 'metadata-output-invalid');
  const target = resolve(output), source = await realpath(workspace), ancestors = [];
  for (let at = target;; at = dirname(at)) { ancestors.unshift(at); if (dirname(at) === at) break; }
  for (const path of ancestors) {
    const state = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!state) { requireInput(create && path === target, 'metadata-output-parent-missing'); continue; }
    requireInput(!state.isSymbolicLink() && state.isDirectory(), 'metadata-output-link-or-shape-unreceived');
    requireInput(!(create && path === target), 'metadata-output-already-exists');
  }
  const canonical = create ? join(await realpath(dirname(target)), basename(target)) : await realpath(target);
  requireInput(canonical === target && !inside(source, canonical) && !inside(canonical, source), 'metadata-output-overlaps-source');
  return canonical;
}

export async function acquireNativeMetadataInput(options) {
  const admitted = await admitNativeMetadataInput(options);
  const output = await admitMetadataOutput(admitted.workspace, options.output, { create: true });
  await mkdir(output, { mode: 0o700 }); // Exclusive fresh directory; no inherited verdict or metadata.
  const cacheDir = join(output, 'cache'); await mkdir(cacheDir, { mode: 0o700 });
  const startedAt = new Date().toISOString();
  await admitted.provider.nativeMetadataPass({ ...admitted, cacheDir, offline: false });
  await admitted.verifyUnchanged();
  const acquisition = { schema: METADATA_SCHEMA, state: 'awaiting-separate-process-receiving',
    binding: admitted.binding, startedAt, finishedAt: new Date().toISOString() };
  await writeExclusive(join(output, 'acquisition.json'), acquisition);
  // Do not force process.exit: native best-effort mirror writes finish naturally.
  return { state: acquisition.state, registryRecords: admitted.records.registry.length };
}

/** Called by the orchestrator only after the acquisition child exits naturally.
 * Direct verification is also available for later immutable-input custody checks. */
export async function receiveNativeMetadataInput(options, { verifyOnly = false } = {}) {
  const admitted = await admitNativeMetadataInput(options);
  const output = await admitMetadataOutput(admitted.workspace, options.output);
  const acquisitionPath = join(output, 'acquisition.json');
  const acquisitionState = await lstat(acquisitionPath);
  requireInput(acquisitionState.isFile() && !acquisitionState.isSymbolicLink(), 'metadata-receipt-shape-unreceived');
  const acquisition = JSON.parse(await readFile(acquisitionPath, 'utf8'));
  assertAcquisitionBinding(acquisition, admitted.binding);
  const cacheDir = await admitMetadataOutput(admitted.workspace, join(output, 'cache'));
  const expectedNames = verifyOnly ? ['acquisition.json', 'cache', 'metadata-input.json'] : ['acquisition.json', 'cache'];
  requireInput(identityOf((await readdir(output)).sort()) === identityOf(expectedNames.sort()), 'metadata-unexpected-input-entry');
  const before = await admitted.provider.inspectNativeMirrors(cacheDir, admitted.records);
  let received;
  if (verifyOnly) {
    const receiptState = await lstat(join(output, 'metadata-input.json'));
    requireInput(receiptState.isFile() && !receiptState.isSymbolicLink(), 'metadata-receipt-shape-unreceived');
    received = JSON.parse(await readFile(join(output, 'metadata-input.json'), 'utf8'));
    requireInput(typeof options.identity === 'string' && /^[a-f0-9]{64}$/u.test(options.identity) &&
      received.identity === options.identity, 'metadata-expected-identity-mismatch');
    const { identity, ...body } = received;
    assertRetainedNativeFiles(before, received.files);
    requireInput(identity === identityOf(body) &&
      received.acquisitionSha256 === sha256(await readFile(join(output, 'acquisition.json'))), 'metadata-input-digest-mismatch');
  }
  const result = await admitted.provider.nativeMetadataPass({ ...admitted, cacheDir, offline: true });
  requireInput(identityOf(await admitted.provider.inspectNativeMirrors(cacheDir, admitted.records)) === identityOf(before),
    'metadata-mirror-changed');
  await admitted.verifyUnchanged();
  if (!verifyOnly) {
    const body = { schema: METADATA_SCHEMA, state: 'received-material', bindingSha256: identityOf(admitted.binding),
      acquisitionSha256: sha256(await readFile(join(output, 'acquisition.json'))), files: before, coverage: result,
      receivedAt: new Date().toISOString(), scope: 'native-api-material; stock OS-network-denied deployment remains separate' };
    received = { ...body, identity: identityOf(body) };
    await writeExclusive(join(output, 'metadata-input.json'), received);
    await freezeTree(output);
  }
  return { identity: received.identity, ...result, files: before.length };
}

/** Native persistence has no public flush API. A clean child completion followed
 * by a new child is the lifecycle boundary; neither child uses process.exit. */
export async function prepareNativeMetadataInput(options) {
  assertNormalInvocation(process.execArgv, process.env);
  const script = join(ownerRoot, 'scripts/acquire-registry-metadata.mjs');
  const args = ['--workspace', options.workspace, '--pnpm', options.pnpm, '--output', options.output, '--stage', options.stage];
  for (const mode of ['acquire', 'receive']) {
    try { await run(process.execPath, [script, mode, ...args], { maxBuffer: 1024 * 1024, env: process.env }); }
    catch { requireInput(false, 'metadata-' + mode + '-child-refused'); }
  }
  const received = JSON.parse(await readFile(join(options.output, 'metadata-input.json'), 'utf8'));
  return { identity: received.identity, ...received.coverage, files: received.files.length };
}
