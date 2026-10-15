import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertInterpreterSearchPath, assertNormalInvocation, assertOwnerStage, assertNonExecutingConfig, assertNoToolchainSwitch, assertNativeResolution, nonSecretPolicy } from '../src/native-registry-metadata-contract.mjs';
import { admitMetadataOutput, observeSupplierSlot, observeSupplierClosure } from '../src/native-registry-metadata-input.mjs';
import { runtimeFingerprint } from '../src/runtime-bindings.mjs';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const cohort = JSON.parse(await readFile(new URL('../data/records/native-registry-metadata-suppliers.json', import.meta.url)));
const refuses = (fn, code) => assert.throws(fn, error => error.code === code);

test('admission is exact-owner, exact-build-stage and exact-declared cohort', () => {
  assertOwnerStage(manifest, 'build-input', cohort);
  refuses(() => assertOwnerStage({ ...manifest, name: '@other/owner' }, 'build-input', cohort), 'metadata-owner-mismatch');
  refuses(() => assertOwnerStage(manifest, 'runtime', cohort), 'metadata-stage-mismatch');
  refuses(() => assertOwnerStage(manifest, 'build-input', { ...cohort, packageManager: 'pnpm@11.28.6' }), 'metadata-cohort-mismatch');
  for (const member of cohort.suppliers) {
    refuses(() => assertOwnerStage({ ...manifest, devDependencies: { ...manifest.devDependencies, [member.name]: '^' + member.version } },
      'build-input', cohort), 'metadata-cohort-declaration-mismatch');
    refuses(() => assertOwnerStage({ ...manifest, dependencies: { ...manifest.dependencies, [member.name]: member.version } },
      'build-input', cohort), 'metadata-supplier-is-runtime-dependency');
  }
});

test('config execution refusals cover unused scope token helpers before auth construction', () => {
  assertNonExecutingConfig({ configByUri: {} });
  for (const config of [
    { configByUri: { '//unused.invalid/': { '@unused': { tokenHelper: ['sentinel-never-run'] } } } },
    { authConfig: { '//other.invalid/:tokenHelper': ['sentinel-never-run'] } },
    { tokenHelper: [] },
  ]) refuses(() => assertNonExecutingConfig(config), 'metadata-token-helper-unreceived');
  refuses(() => assertNonExecutingConfig({ configDependencies: { hook: '1.0.0' } }), 'metadata-config-dependencies-unreceived');
  refuses(() => assertNonExecutingConfig({ globalPnpmfile: '/never/execute.cjs' }), 'metadata-global-pnpmfile-unreceived');
  refuses(() => assertNonExecutingConfig({ pnpmfile: ['custom.cjs'] }), 'metadata-pnpmfile-unreceived');
  refuses(() => assertNonExecutingConfig({}, { hooks: { readPackage: [() => {}] } }), 'metadata-hooks-unreceived');
  refuses(() => assertNonExecutingConfig({ customResolvers: [() => {}] }), 'metadata-hooks-unreceived');
  refuses(() => assertNonExecutingConfig({ customFetchers: [() => {}] }), 'metadata-hooks-unreceived');
});

test('receipts contain only explicit non-secret policy and registry identity', () => {
  const config = { registriesByScope: { default: 'https://registry.example/' },
    configByUri: { 'https://registry.example/': { '@default': { authToken: 'SECRET_TOKEN' }, key: 'SECRET_KEY' } },
    authConfig: { token: 'SECRET_AUTH' }, httpsProxy: 'https://person:SECRET_PROXY@proxy.invalid',
    minimumReleaseAgeIgnoreMissingTime: true, minimumReleaseAge: 1440, allowBuilds: { esbuild: true } };
  const result = nonSecretPolicy(config, { BUILTIN_REGISTRIES_BY_PREFIX: {} });
  assert.equal(result.minimumReleaseAgeIgnoreMissingTime, true);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.deepEqual(result.allowBuilds, { esbuild: true });
  refuses(() => nonSecretPolicy({ ...config, registriesByScope: { default: 'https://user:pass@registry.example/' } },
    { BUILTIN_REGISTRIES_BY_PREFIX: {} }), 'metadata-credential-bearing-registry-unreceived');
});

test('same URL is insufficient: native selected integrity and historical revision must match', () => {
  const record = { entry: { name: 'pin', version: '1.0.0' }, resolution: { tarball: 'https://registry.example/pin.tgz', integrity: 'sha512-A', revision: 1 } };
  const result = { manifest: { name: 'pin', version: '1.0.0' }, resolution: { ...record.resolution } };
  assertNativeResolution(record, result);
  refuses(() => assertNativeResolution(record, { ...result, resolution: { ...result.resolution, integrity: 'sha512-B' } }), 'metadata-selected-integrity-mismatch');
  refuses(() => assertNativeResolution(record, { ...result, resolution: { ...result.resolution, revision: 2 } }), 'metadata-selected-revision-mismatch');
  assertNativeResolution({ ...record, resolution: { integrity: 'sha512-A' } }, { ...result, resolution: { integrity: 'sha512-A' } });
});

test('acquisition has no package export or bin and keeps literal provider imports observable', async () => {
  assert.equal(JSON.stringify(manifest.exports).includes('metadata'), false);
  assert.equal(JSON.stringify(manifest.bin).includes('metadata'), false);
  const provider = await readFile(new URL('../src/native-registry-metadata-provider.mjs', import.meta.url), 'utf8');
  for (const name of cohort.suppliers.filter(s => !['@pnpm/worker', '@pnpm/logger'].includes(s.name)).map(s => s.name)) {
    assert(provider.includes("from '" + name + "'"));
  }
});

test('uncached supplier slots detect a byte-identical same-name/version instance swap', async t => {
  const root = await mkdtemp(join(tmpdir(), 'metadata-slot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'owner/src'), { recursive: true });
  await mkdir(join(root, 'owner/node_modules/@pnpm'), { recursive: true });
  const body = { name: '@pnpm/test', version: '1.0.0', type: 'module', exports: { '.': './lib/index.js' } };
  for (const name of ['one', 'two']) {
    await mkdir(join(root, name, 'lib'), { recursive: true });
    await writeFile(join(root, name, 'package.json'), JSON.stringify(body));
    await writeFile(join(root, name, 'lib/index.js'), 'export const value = 1;\n');
  }
  const slot = join(root, 'owner/node_modules/@pnpm/test');
  await symlink(join(root, 'one'), slot);
  const before = await observeSupplierSlot(root, join(root, 'owner/src'), '@pnpm/test');
  await unlink(slot); await symlink(join(root, 'two'), slot);
  const after = await observeSupplierSlot(root, join(root, 'owner/src'), '@pnpm/test');
  assert.notEqual(before.root, after.root);
  assert.notDeepEqual(before.links, after.links);
  assert.deepEqual(before.manifest, after.manifest);
});

test('complete dependency-instance fingerprints use a fresh observation cache', async t => {
  const root = await mkdtemp(join(tmpdir(), 'metadata-hash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'pkg/node_modules/dep'), { recursive: true });
  await writeFile(join(root, 'pkg/package.json'), JSON.stringify({ name: 'pkg', dependencies: { dep: '1.0.0' } }));
  await writeFile(join(root, 'pkg/node_modules/dep/package.json'), JSON.stringify({ name: 'dep', version: '1.0.0' }));
  const asset = join(root, 'pkg/node_modules/dep/asset.txt');
  await writeFile(asset, 'before');
  const before = await runtimeFingerprint(root, 'pkg', new Map());
  await writeFile(asset, 'after');
  const after = await runtimeFingerprint(root, 'pkg', new Map());
  assert.equal(before.packages, 2); assert.equal(after.packages, 2);
  assert.notEqual(before.digest, after.digest);
});

test('toolchain switching is refused before initializing any inventory CLI', () => {
  const root = { packageManager: 'pnpm@11.28.5' };
  const context = { wantedPackageManager: { name: 'pnpm', version: '11.28.5' } };
  assertNoToolchainSwitch({}, context, root, false);
  refuses(() => assertNoToolchainSwitch({}, context, { packageManager: 'pnpm@11.28.4' }, false), 'metadata-root-package-manager-mismatch');
  refuses(() => assertNoToolchainSwitch({}, { wantedPackageManager: { name: 'yarn', version: '11.28.5' } }, root, false),
    'metadata-package-manager-switch-unreceived');
  refuses(() => assertNoToolchainSwitch({}, context, root, true), 'metadata-package-manager-switch-unreceived');
  for (const key of ['packageManager', 'runtime']) refuses(() => assertNoToolchainSwitch({}, context,
    { ...root, devEngines: { [key]: { name: 'node', version: '100.0.0' } } }, false), 'metadata-runtime-switch-unreceived');
  refuses(() => assertNoToolchainSwitch({ useNodeVersion: '100.0.0' }, context, root, false), 'metadata-runtime-switch-unreceived');
});

test('transport identity binds effective public TLS/proxy settings without credentials', () => {
  const config = { registriesByScope: { default: 'https://registry.example/' }, strictSsl: true };
  const constants = { BUILTIN_REGISTRIES_BY_PREFIX: {} };
  const before = nonSecretPolicy(config, constants);
  for (const change of [
    { strictSsl: false }, { ca: ['PUBLIC_CA'] }, { cert: ['PUBLIC_CERT'] },
    { httpsProxy: 'https://user:SECRET@proxy.example/' }, { httpProxy: 'http://proxy.example/' },
    { noProxy: 'example' }, { localAddress: '127.0.0.1' },
    { configByUri: { '//registry.example/': { tls: { ca: ['PUBLIC_CA'] } } } },
  ]) assert.notDeepEqual(nonSecretPolicy({ ...config, ...change }, constants), before);
  const result = nonSecretPolicy({ ...config, ca: ['PUBLIC_CA'], cert: ['PUBLIC_CERT'], key: 'SECRET_KEY',
    httpsProxy: 'https://user:SECRET_PROXY@proxy.example/' }, constants);
  for (const value of ['SECRET', 'PUBLIC_CA', 'PUBLIC_CERT', 'user']) assert(!JSON.stringify(result).includes(value));
  assert.equal(result.transport.httpsProxy, 'https://proxy.example/');
  assert.equal(result.transport.clientKeyConfigured, true);
});

test('transitive import shadows and package-content links are refused without changing shared fingerprint semantics', async t => {
  const root = await mkdtemp(join(tmpdir(), 'metadata-shadow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'pkg/lib'), { recursive: true });
  await mkdir(join(root, 'node_modules/dep'), { recursive: true });
  await writeFile(join(root, 'pkg/package.json'), JSON.stringify({ name: 'pkg', dependencies: { dep: '1.0.0' } }));
  await writeFile(join(root, 'node_modules/dep/package.json'), JSON.stringify({ name: 'dep', version: '1.0.0' }));
  const before = await runtimeFingerprint(root, 'pkg', new Map());
  assert.equal((await observeSupplierClosure(root, [join(root, 'pkg')])).length, 2);
  await mkdir(join(root, 'pkg/lib/node_modules/dep'), { recursive: true });
  await writeFile(join(root, 'pkg/lib/node_modules/dep/package.json'), JSON.stringify({ name: 'dep', version: '1.0.0' }));
  assert.deepEqual(await runtimeFingerprint(root, 'pkg', new Map()), before);
  await assert.rejects(observeSupplierClosure(root, [join(root, 'pkg')]), { code: 'metadata-nested-module-slot-unreceived' });
  await rm(join(root, 'pkg/lib/node_modules'), { recursive: true });
  await symlink(join(root, 'node_modules/dep'), join(root, 'pkg/lib/linked'));
  await assert.rejects(observeSupplierClosure(root, [join(root, 'pkg')]), { code: 'metadata-package-content-link-unreceived' });
});

test('uncached transitive slots bind identical replacement instances and ignored bin bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'metadata-transitive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'pkg/node_modules/.bin'), { recursive: true });
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await writeFile(join(root, 'pkg/package.json'), JSON.stringify({ name: 'pkg', dependencies: { dep: '1.0.0' } }));
  for (const name of ['one', 'two']) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, 'package.json'), JSON.stringify({ name: 'dep', version: '1.0.0' }));
  }
  const slot = join(root, 'node_modules/dep');
  await symlink(join(root, 'one'), slot);
  const before = await observeSupplierClosure(root, [join(root, 'pkg')]);
  await unlink(slot); await symlink(join(root, 'two'), slot);
  const after = await observeSupplierClosure(root, [join(root, 'pkg')]);
  assert.notDeepEqual(after, before);
  await writeFile(join(root, 'pkg/node_modules/.bin/dep'), 'received bin');
  assert.notDeepEqual(await observeSupplierClosure(root, [join(root, 'pkg')]), after);
});

test('output aliases cannot enter source before acquisition or receiving effects', async t => {
  const root = await mkdtemp(join(tmpdir(), 'metadata-output-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), retained = join(root, 'retained');
  await mkdir(source); await mkdir(retained);
  await symlink(source, join(root, 'to-source'));
  for (const create of [true, false]) {
    await assert.rejects(admitMetadataOutput(source, join(root, 'to-source', 'new'), { create }),
      { code: 'metadata-output-link-or-shape-unreceived' });
    await assert.rejects(admitMetadataOutput(source, join(root, 'to-source'), { create }),
      { code: 'metadata-output-link-or-shape-unreceived' });
  }
  await assert.rejects(admitMetadataOutput(source, join(source, 'new'), { create: true }), { code: 'metadata-output-overlaps-source' });
  await assert.rejects(admitMetadataOutput(source, root), { code: 'metadata-output-overlaps-source' });
  assert.equal(await admitMetadataOutput(source, join(root, 'new'), { create: true }), join(root, 'new'));
  assert.equal(await admitMetadataOutput(source, retained), retained);
  assert.deepEqual(await readdir(source), []); // Admission itself created nothing.
  assert.deepEqual(await readdir(retained), []);
});

test('normal invocation assertion rejects unreceived Node launch controls diagnostically', () => {
  assertNormalInvocation([], { NODE_EXTRA_CA_CERTS: '/received/public-ca.pem', AUTH_EXAMPLE: 'not serialized' });
  for (const flags of [['--preserve-symlinks'], ['--require', 'preload'], ['--import=preload'], ['--loader=loader']]) {
    refuses(() => assertNormalInvocation(flags, {}), 'metadata-node-arguments-unreceived');
  }
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_PRESERVE_SYMLINKS']) {
    refuses(() => assertNormalInvocation([], { [key]: 'unsupported' }), 'metadata-node-environment-unreceived');
  }
});

test('relative and empty PATH entries refuse the real two-cwd interpreter mismatch', async t => {
  const root = await mkdtemp(join(tmpdir(), 'metadata-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['parent', 'workspace']) {
    await mkdir(join(root, name, 'relative-bin'), { recursive: true });
    await writeFile(join(root, name, 'relative-bin/node'), '#!/bin/sh\nprintf ' + name, { mode: 0o755 });
  }
  const observe = cwd => execFileSync('/usr/bin/env', ['node'], { cwd, env: { PATH: 'relative-bin' }, encoding: 'utf8' });
  assert.equal(observe(join(root, 'parent')), 'parent');
  assert.equal(observe(join(root, 'workspace')), 'workspace');
  for (const path of ['relative-bin', '', ':/usr/bin', '/usr/bin:', '/usr/bin::/bin']) {
    refuses(() => assertInterpreterSearchPath(path), 'metadata-interpreter-search-unreceived');
  }
  assert.deepEqual(assertInterpreterSearchPath('/usr/bin:/bin'), ['/usr/bin', '/bin']);
});

test('prepare refuses unsupported parent Node arguments before spawning acquisition', async t => {
  const root = await mkdtemp(join(tmpdir(), 'metadata-prepare-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'must-not-exist'), script = new URL('../scripts/acquire-registry-metadata.mjs', import.meta.url).pathname;
  const env = { ...process.env }; delete env.NODE_PATH; // Explicit normal test environment except the one tested flag.
  let refused;
  try {
    execFileSync(process.execPath, ['--preserve-symlinks', script, 'prepare', '--workspace', root,
      '--pnpm', '/never/invoke-pnpm', '--output', output, '--stage', 'build-input'], { env, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) { refused = error; }
  assert.equal(refused?.stderr.trim(), 'metadata-node-arguments-unreceived');
  assert.deepEqual(await readdir(root), []);
});

test('duplicate ancestor module slots are refused where native Node skips their search position', async t => {
  const root = await mkdtemp(join(tmpdir(), 'metadata-duplicate-slot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['node_modules/pkg/lib', 'node_modules/dep', 'node_modules/node_modules/dep']) {
    await mkdir(join(root, path), { recursive: true });
  }
  await writeFile(join(root, 'node_modules/pkg/package.json'), JSON.stringify({ name: 'pkg', dependencies: { dep: '1.0.0' } }));
  await writeFile(join(root, 'node_modules/pkg/lib/index.cjs'), "module.exports = require('dep');");
  for (const path of ['node_modules/dep', 'node_modules/node_modules/dep']) {
    await writeFile(join(root, path, 'package.json'), JSON.stringify({ name: 'dep', version: '1.0.0', main: 'index.cjs' }));
    await writeFile(join(root, path, 'index.cjs'), "module.exports = 'before';");
  }
  const entry = join(root, 'node_modules/pkg/lib/index.cjs');
  assert(!createRequire(entry).resolve.paths('dep').includes(join(root, 'node_modules/node_modules')));
  const before = await runtimeFingerprint(root, 'node_modules/pkg', new Map());
  const observe = () => execFileSync(process.execPath, ['-p', 'require(' + JSON.stringify(entry) + ')'], { encoding: 'utf8' }).trim();
  assert.equal(observe(), 'before');
  await writeFile(join(root, 'node_modules/dep/index.cjs'), "module.exports = 'after';");
  assert.equal(observe(), 'after');
  assert.deepEqual(await runtimeFingerprint(root, 'node_modules/pkg', new Map()), before);
  await assert.rejects(observeSupplierClosure(root, [join(root, 'node_modules/pkg')]),
    { code: 'metadata-duplicate-module-slot-unreceived' });
  await rm(join(root, 'node_modules/node_modules'), { recursive: true });
  assert.equal((await observeSupplierClosure(root, [join(root, 'node_modules/pkg')])).length, 2);
});
