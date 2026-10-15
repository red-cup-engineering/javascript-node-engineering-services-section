// Intentionally visible static external imports. This file has no package export or bin.
// Its owning bootstrap admits installed artifacts before loading this module.
import { getConfig, shouldPersistLockfile } from '@pnpm/config.reader';
import { readCurrentLockfile, readWantedLockfile, readWantedLockfileFile } from '@pnpm/lockfile.fs';
import { nameVerFromPkgSnapshot, pkgSnapshotToResolution } from '@pnpm/lockfile.utils';
import { createResolver, makeResolutionStrict } from '@pnpm/installing.client';
import { createPackageVersionPolicy, getPublishedByPolicy } from '@pnpm/config.version-policy';
import { createFetchFromRegistry } from '@pnpm/network.fetch';
import { createGetAuthHeaderByURI } from '@pnpm/network.auth-header';
import { createNpmResolver, createNpmResolutionVerifier, loadMeta, decodeRegistry, parseBareSpecifier } from '@pnpm/resolving.npm-resolver';
import * as constants from '@pnpm/constants';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assertNativeResolution, assertNonExecutingConfig, assertNoToolchainSwitch, MetadataInputRefusal, nonSecretPolicy, PNPM_VERSION, requireInput } from './native-registry-metadata-contract.mjs';

export { constants };
/** Compare actual ESM import targets with the bootstrap's uncached slots. These
 * exact cohort manifests must use unconditional public root export strings. */
export function nativeSupplierImports() {
  return {
    '@pnpm/config.reader': import.meta.resolve('@pnpm/config.reader'),
    '@pnpm/lockfile.fs': import.meta.resolve('@pnpm/lockfile.fs'),
    '@pnpm/lockfile.utils': import.meta.resolve('@pnpm/lockfile.utils'),
    '@pnpm/installing.client': import.meta.resolve('@pnpm/installing.client'),
    '@pnpm/config.version-policy': import.meta.resolve('@pnpm/config.version-policy'),
    '@pnpm/network.fetch': import.meta.resolve('@pnpm/network.fetch'),
    '@pnpm/network.auth-header': import.meta.resolve('@pnpm/network.auth-header'),
    '@pnpm/resolving.npm-resolver': import.meta.resolve('@pnpm/resolving.npm-resolver'),
    '@pnpm/constants': import.meta.resolve('@pnpm/constants'),
    '@pnpm/logger': import.meta.resolve('@pnpm/logger'),
    '@pnpm/worker': import.meta.resolve('@pnpm/worker'),
  };
}
export async function nativeConfig(workspace, { inventory = false, rootManifest } = {}) {
  const result = await getConfig({ cliOptions: { dir: workspace }, workspaceDir: workspace,
    packageManager: { name: 'pnpm', version: PNPM_VERSION }, env: process.env });
  assertNonExecutingConfig(result.config, result.context);
  if (inventory) {
    requireInput(resolve(result.context.rootProjectManifestDir) === workspace, 'metadata-config-root-mismatch');
    assertNoToolchainSwitch(result.config, result.context, rootManifest,
      result.context.wantedPackageManager ? shouldPersistLockfile(result.context.wantedPackageManager) : false);
  }
  for (const name of ['.pnpmfile.cjs', '.pnpmfile.mjs']) {
    const exists = await lstat(join(workspace, name)).then(() => true, error => {
      if (error.code === 'ENOENT') return false; throw error;
    });
    requireInput(!exists, 'metadata-default-pnpmfile-unreceived');
  }
  const identity = nonSecretPolicy(result.config, constants);
  // Native getConfig expands effective scoped TLS file values into configByUri.tls
  // and global cafile into ca. Hashes above bind those effective public bytes;
  // global cafile's exact file bytes are retained by digest as well. Never key bytes.
  identity.transportFiles = {};
  if (result.config.cafile) identity.transportFiles.cafileSha256 = digest(await readFile(result.config.cafile));
  if (process.env.NODE_EXTRA_CA_CERTS) identity.transportFiles.nodeExtraCaCertsSha256 = digest(await readFile(process.env.NODE_EXTRA_CA_CERTS));
  return { ...result, identity };
}

export async function nativeLock(workspace, config, { installed = true } = {}) {
  requireInput(!config.useGitBranchLockfile && !config.gitBranchLockfile && !config.mergeGitBranchLockfiles,
    'metadata-branch-lock-unreceived');
  requireInput(config.sharedWorkspaceLockfile !== false && resolve(config.lockfileDir ?? workspace) === workspace,
    'metadata-nonroot-lock-unreceived');
  const lock = await readWantedLockfileFile(workspace, { ignoreIncompatible: false });
  requireInput(lock?.packages && lock.importers, 'metadata-native-lock-missing');
  if (installed) {
    requireInput(config.nodeLinker === 'isolated' && config.symlink !== false, 'metadata-installed-layout-unreceived');
    const current = await readCurrentLockfile(resolve(workspace, config.virtualStoreDir ?? 'node_modules/.pnpm'), { ignoreIncompatible: false });
    const wanted = await readWantedLockfile(workspace, { ignoreIncompatible: false });
    requireInput(current && isDeepStrictEqual(current, wanted), 'metadata-installed-lock-mismatch');
  }
  return lock;
}

/** Native converted lock snapshots name the expected installed dependency and
 * peer instances. The existing runtimeFingerprint owns their complete byte hash. */
export async function receiveInstalledSupplierGraph(workspace, ownerProject, cohort) {
  const lock = await readWantedLockfile(workspace, { ignoreIncompatible: false });
  const inside = path => { const p = relative(workspace, path); return p === '' || (!isAbsolute(p) && p !== '..' && !p.startsWith('..' + sep)); };
  const visited = new Map();
  async function installedFrom(from, name) {
    for (let directory = from; inside(directory); directory = dirname(directory)) {
      const target = await realpath(join(directory, 'node_modules', name)).catch(error => {
        if (error.code === 'ENOENT') return null; throw error;
      });
      if (target) { requireInput(inside(target), 'metadata-installed-supplier-escape'); return target; }
      if (directory === workspace) break;
    }
    return null;
  }
  function snapshotFor(name, reference) {
    // Opaque native lock references may already be a full alias key. Look up
    // keys; parsing each selected snapshot remains with nameVerFromPkgSnapshot.
    const keys = [...new Set([reference, name + '@' + reference])].filter(key => Object.hasOwn(lock.packages, key));
    requireInput(keys.length === 1, 'metadata-supplier-snapshot-unreceived');
    return keys[0];
  }
  async function visit(from, name, reference, optional = false) {
    const key = snapshotFor(name, reference), snapshot = lock.packages[key];
    const directory = await installedFrom(from, name);
    if (!directory) { requireInput(optional, 'metadata-installed-edge-missing'); return null; }
    const instance = relative(workspace, directory).split(sep).join('/');
    const prior = visited.get(instance);
    if (prior) { requireInput(prior.snapshot === key, 'metadata-installed-peer-context-mismatch'); return instance; }
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    const selected = nameVerFromPkgSnapshot(key, snapshot);
    requireInput(!selected.nonSemverVersion && manifest.name === selected.name && manifest.version === selected.version,
      'metadata-installed-lock-instance-mismatch');
    const row = { instance, snapshot: key, name: selected.name, version: selected.version, edges: [] };
    visited.set(instance, row);
    const expected = { ...snapshot.dependencies, ...snapshot.optionalDependencies };
    for (const edge of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })) {
      requireInput(Object.hasOwn(expected, edge) || Boolean(manifest.optionalDependencies?.[edge]) ||
        Boolean(manifest.peerDependenciesMeta?.[edge]?.optional), 'metadata-installed-edge-unlocked');
    }
    for (const [edge, ref] of Object.entries(expected).sort(([a], [b]) => a.localeCompare(b))) {
      row.edges.push({ name: edge, target: await visit(directory, edge, ref, Object.hasOwn(snapshot.optionalDependencies ?? {}, edge)) });
    }
    return instance;
  }
  for (const supplier of cohort.suppliers) {
    const reference = lock.importers[ownerProject]?.devDependencies?.[supplier.name];
    requireInput(typeof reference === 'string', 'metadata-supplier-importer-unreceived');
    await visit(resolve(workspace, ownerProject), supplier.name, reference);
  }
  return [...visited.values()].sort((a, b) => a.instance.localeCompare(b.instance));
}

/** Total classification: every native package record is either acquired, explicitly
 * retained on the native Git-content route, or refuses the entire operation. */
export function nativeRecords(lock, config) {
  const registry = [], nonRegistry = [];
  for (const [key, snapshot] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
    const entry = nameVerFromPkgSnapshot(key, snapshot);
    const resolution = pkgSnapshotToResolution(key, snapshot, config);
    requireInput(entry?.name && entry.version && resolution, 'metadata-package-shape-unreceived');
    requireInput(!resolution.type && !resolution.variants, 'metadata-resolution-shape-unreceived');
    if (entry.nonSemverVersion != null) {
      requireInput(resolution.gitHosted === true && typeof resolution.integrity === 'string' &&
        typeof resolution.tarball === 'string', 'metadata-nonregistry-shape-unreceived');
      nonRegistry.push({ key, entry, resolution, route: 'native-package-content' });
      continue;
    }
    requireInput(!resolution.gitHosted && typeof resolution.integrity === 'string' && resolution.integrity.length > 0 &&
      typeof resolution.tarball === 'string', 'metadata-registry-shape-unreceived');
    // Native revision selectors preserve historical revision zero as well as rN.
    const selector = entry.version + '+r' + (resolution.revision ?? 0);
    const parsed = parseBareSpecifier(selector, entry.name, 'latest', config.registriesByScope.default);
    requireInput(parsed?.type === 'version' && parsed.fetchSpec === entry.version &&
      parsed.revision === (resolution.revision ?? 0), 'metadata-version-shape-unreceived');
    registry.push({ key, entry, resolution, request: { alias: entry.name,
      bareSpecifier: entry.registryName == null ? selector : entry.registryName + ':' + selector } });
  }
  return { registry, nonRegistry, total: registry.length + nonRegistry.length };
}

function policyOptions(config) {
  return { minimumReleaseAge: config.minimumReleaseAge, minimumReleaseAgeStrict: config.minimumReleaseAgeStrict,
    minimumReleaseAgeExclude: config.minimumReleaseAgeExclude, ignoreMissingTimeField: config.minimumReleaseAgeIgnoreMissingTime,
    trustPolicy: config.trustPolicy, trustPolicyExclude: config.trustPolicyExclude, trustPolicyIgnoreAfter: config.trustPolicyIgnoreAfter };
}
function transportOptions(config) {
  return { ...config, timeout: config.fetchTimeout, retry: { retries: config.fetchRetries,
    factor: config.fetchRetryFactor, minTimeout: config.fetchRetryMintimeout, maxTimeout: config.fetchRetryMaxtimeout } };
}

/** No store/currentPkg/workspace shortcut; full resolver and verifier have separate native caches. */
export async function nativeMetadataPass({ workspace, cacheDir, config, records, offline }) {
  assertNonExecutingConfig(config);
  let networkAttempts = 0;
  const transport = transportOptions(config);
  const fetch = offline ? async () => { networkAttempts++; throw new MetadataInputRefusal('metadata-offline-network-attempt'); }
    : createFetchFromRegistry(transport);
  const auth = createGetAuthHeaderByURI(config.configByUri);
  const options = { ...transport, ...policyOptions(config), cacheDir, storeDir: undefined,
    fullMetadata: true, filterMetadata: false, offline, preferOffline: false };
  const nativeOffline = offline ? createNpmResolver(fetch, auth, options) : undefined;
  const resolvePackage = makeResolutionStrict(offline ? async (wanted, opts) => {
    // These are the supplier's public resolver branches, not local protocol parsing.
    return await nativeOffline.resolveFromNpm(wanted, opts) ??
      await nativeOffline.resolveFromJsr(wanted, opts) ??
      await nativeOffline.resolveFromNamedRegistry(wanted, opts);
  } : createResolver(options).resolve);
  const abbreviatedOffline = offline ? createNpmResolver(fetch, auth, { ...options, fullMetadata: false }) : undefined;
  const resolveAbbreviated = offline ? makeResolutionStrict(async (wanted, opts) =>
    await abbreviatedOffline.resolveFromNpm(wanted, opts) ??
    await abbreviatedOffline.resolveFromJsr(wanted, opts) ??
    await abbreviatedOffline.resolveFromNamedRegistry(wanted, opts)) : undefined;
  const verifier = createNpmResolutionVerifier({ ...policyOptions(config), cacheDir, offline,
    registriesByScope: config.registriesByScope, registriesByPrefix: config.registriesByPrefix,
    getAuthHeaderValueByURI: auth, fetchOpts: { fetch, retry: transport.retry,
      timeout: transport.timeout, fetchWarnTimeoutMs: config.fetchWarnTimeoutMs } });
  const resolveOptions = { ...getPublishedByPolicy(config), lockfileDir: workspace,
    alwaysTryWorkspacePackages: false, trustPolicy: config.trustPolicy,
    trustPolicyExclude: config.trustPolicyExclude ? createPackageVersionPolicy(config.trustPolicyExclude) : undefined,
    trustPolicyIgnoreAfter: config.trustPolicyIgnoreAfter };
  for (const record of records.registry) {
    const result = await resolvePackage(record.request, resolveOptions);
    assertNativeResolution(record, result);
    if (offline) assertNativeResolution(record, await resolveAbbreviated(record.request, resolveOptions));
    requireInput((await verifier.verify(record.resolution, record.entry)).ok === true, 'metadata-native-verifier-refused');
  }
  requireInput(networkAttempts === 0, 'metadata-offline-network-attempt');
  return { registryRecords: records.registry.length, nonRegistryRecords: records.nonRegistry.length, ...(offline ? { networkAttempts } : {}) };
}

const digest = body => createHash('sha256').update(body).digest('hex');
/** Discover native files rather than reimplementing PNPM package-name mirror encoding. */
export async function inspectNativeMirrors(cacheDir, records) {
  const files = [], groups = new Map();
  async function visit(directory) {
    for (const dirent of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, dirent.name);
      requireInput(!dirent.isSymbolicLink(), 'metadata-mirror-link-refused');
      if (dirent.isDirectory()) { await visit(path); continue; }
      requireInput(dirent.isFile(), 'metadata-mirror-shape-refused');
      const nativePath = relative(cacheDir, path).split(sep).join('/');
      const kind = nativePath.startsWith(constants.FULL_META_DIR + '/') ? 'full' :
        nativePath.startsWith(constants.ABBREVIATED_META_DIR + '/') ? 'abbreviated' : undefined;
      requireInput(kind && nativePath.endsWith('.jsonl'), 'metadata-unexpected-cache-file');
      const prefix = kind === 'full' ? constants.FULL_META_DIR : constants.ABBREVIATED_META_DIR;
      const registryKey = nativePath.slice(prefix.length + 1).split('/')[0];
      const registry = decodeRegistry(registryKey);
      // No credentials or query-bearing registry identifiers may enter receipts.
      const url = new URL(registry);
      requireInput(!url.username && !url.password && !url.search && !url.hash, 'metadata-unsafe-mirror-registry');
      const bytes = await readFile(path);
      const meta = await loadMeta(path, { hydrateEagerly: true });
      requireInput(meta?.name && meta.versions, 'metadata-corrupt-native-mirror');
      const key = registryKey + '\0' + meta.name;
      const group = groups.get(key) ?? { name: meta.name, mirrors: {} };
      requireInput(!group.mirrors[kind], 'metadata-duplicate-native-mirror');
      group.mirrors[kind] = new Set(Object.keys(meta.versions).filter(version => meta.versions[version] != null));
      groups.set(key, group);
      files.push({ path: nativePath, kind, bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  await visit(cacheDir);
  for (const group of groups.values()) requireInput(group.mirrors.full && group.mirrors.abbreviated, 'metadata-mirror-class-missing');
  for (const record of records.registry) {
    requireInput([...groups.values()].some(group => group.name === record.entry.name &&
      group.mirrors.full.has(record.entry.version) && group.mirrors.abbreviated.has(record.entry.version)),
    'metadata-selected-version-absent');
  }
  // Native offline resolution and verification establish the route-specific binding.
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
