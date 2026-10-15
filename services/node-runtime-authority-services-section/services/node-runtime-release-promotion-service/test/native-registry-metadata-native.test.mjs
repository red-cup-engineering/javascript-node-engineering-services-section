import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { nativeConfig, nativeRecords, nativeMetadataPass, inspectNativeMirrors, constants } from '../src/native-registry-metadata-provider.mjs';
import { assertRetainedNativeFiles } from '../src/native-registry-metadata-input.mjs';

const run = promisify(execFile);
const child = fileURLToPath(new URL('./fixtures/native-registry-metadata-pass.mjs', import.meta.url));
const sri = body => 'sha512-' + createHash('sha512').update(body).digest('base64');
const configFor = registry => ({ registriesByScope: { default: registry }, registriesByPrefix: {}, configByUri: {},
  minimumReleaseAge: 1440, minimumReleaseAgeStrict: true, minimumReleaseAgeIgnoreMissingTime: true,
  fetchRetries: 0, fetchTimeout: 5000 });

test('native getConfig refuses default pnpmfile before its top-level code runs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'metadata-hook-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, 'SHOULD-NOT-EXIST');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', packageManager: 'pnpm@11.28.5' }));
  await writeFile(join(root, 'pnpm-workspace.yaml'), "packages: ['.']\n");
  await writeFile(join(root, '.pnpmfile.cjs'), "require('node:fs').writeFileSync(" + JSON.stringify(marker) + ", 'hook ran'); module.exports = {};\n");
  await assert.rejects(nativeConfig(root), error => error.code === 'metadata-default-pnpmfile-unreceived');
  await assert.rejects(access(marker), { code: 'ENOENT' });
});

test('native lock classification refuses unsupported shapes before network acquisition', () => {
  const config = configFor('https://registry.npmjs.org/');
  const pin = { resolution: { integrity: sri('a') } };
  assert.equal(nativeRecords({ packages: { 'pin@1.0.0': pin } }, config).registry.length, 1);
  for (const resolution of [{ type: 'variations', variants: [] }, { type: 'directory', directory: '.' }]) {
    assert.throws(() => nativeRecords({ packages: { 'pin@1.0.0': { resolution } } }, config));
  }
  assert.throws(() => nativeRecords({ packages: { 'pin@1.0.0': { version: 'not-a-version', ...pin } } }, config));
});

test('native historical selection, genuine writer persistence and fresh-process negative receiving', async t => {
  const root = await mkdtemp(join(tmpdir(), 'metadata-native-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let requests = 0, registry, metadata;
  const server = createServer((request, response) => {
    requests++; response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(metadata));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  registry = 'http://127.0.0.1:' + server.address().port + '/';
  const artifacts = [0, 1, 2].map(revision => {
    const integrity = sri('revision-' + revision);
    return { revision, integrity, tarball: registry + '-/tarballs/sha512/' + Buffer.from(integrity.slice(7), 'base64').toString('base64url'), manifest: {} };
  });
  metadata = { name: 'native-history-fixture', 'dist-tags': { latest: '1.0.0' },
    time: { created: '2020-01-01T00:00:00.000Z', modified: '2020-01-01T00:00:00.000Z', '1.0.0': '2020-01-01T00:00:00.000Z' },
    versions: { '1.0.0': { name: 'native-history-fixture', version: '1.0.0', dist: { ...artifacts[2], revisions: artifacts } } } };
  const config = configFor(registry), cacheDir = join(root, 'cache');
  const lock = { packages: { 'native-history-fixture@1.0.0': { resolution: {
    integrity: artifacts[1].integrity, revision: 1, tarball: artifacts[1].tarball } } } };
  const records = nativeRecords(lock, config), input = { workspace: root, config, records, cacheDir };
  const inputPath = join(root, 'input.json'); await writeFile(inputPath, JSON.stringify(input));
  await run(process.execPath, [child, inputPath, 'acquire']);
  assert(requests >= 2, 'native full resolver and separate abbreviated verifier each requested metadata');
  const beforeOffline = requests;
  const offline = JSON.parse((await run(process.execPath, [child, inputPath, 'offline'])).stdout);
  assert.equal(offline.networkAttempts, 0); assert.equal(requests, beforeOffline);
  assert.equal(offline.registryRecords, 1); assert.equal(offline.files.length, 2);
  // Revision zero is also selected explicitly, never replaced by current r2.
  const zeroLock = structuredClone(lock);
  zeroLock.packages['native-history-fixture@1.0.0'].resolution = { integrity: artifacts[0].integrity, tarball: artifacts[0].tarball };
  assert.equal((await nativeMetadataPass({ ...input, records: nativeRecords(zeroLock, config), offline: true })).networkAttempts, 0);
  // Wrong historical revision or ordinary same-URL/wrong-integrity is rejected.
  const wrong = structuredClone(records);
  wrong.registry[0].resolution.integrity = sri('wrong');
  await assert.rejects(nativeMetadataPass({ ...input, records: wrong, offline: true }), error => error.code === 'metadata-selected-integrity-mismatch');
  const wrongRegistry = { ...config, registriesByScope: { default: registry + 'wrong/' } };
  await assert.rejects(nativeMetadataPass({ ...input, config: wrongRegistry, offline: true }));
  for (const [label, mutation] of [
    ['absent-full', async cache => rm(join(cache, constants.FULL_META_DIR), { recursive: true })],
    ['absent-abbreviated', async cache => rm(join(cache, constants.ABBREVIATED_META_DIR), { recursive: true })],
    ['truncated', async cache => writeFile(join(cache, offline.files[0].path), 'pnpm-meta-v1 9 999999\n{}')],
    ['corrupt-fragment', async cache => { const file = join(cache, offline.files[0].path), bytes = await readFile(file); bytes[bytes.length - 1] = 0; await writeFile(file, bytes); }],
  ]) {
    const copied = join(root, label); await cp(cacheDir, copied, { recursive: true }); await mutation(copied);
    const job = join(root, label + '.json'); await writeFile(job, JSON.stringify({ ...input, cacheDir: copied }));
    await assert.rejects(run(process.execPath, [child, job, 'offline']));
  }
  const absent = structuredClone(records); absent.registry[0].entry.version = '9.9.9';
  await assert.rejects(inspectNativeMirrors(cacheDir, absent), error => error.code === 'metadata-selected-version-absent');
  for (const [label, needle, replacement] of [['time', '2020-01-01', '2021-01-01'], ['artifact', artifacts[1].integrity, sri('different')]]) {
    const copied = join(root, label); await cp(cacheDir, copied, { recursive: true });
    const file = join(copied, offline.files[0].path), before = await readFile(file, 'utf8');
    assert(before.includes(needle)); await writeFile(file, before.replace(needle, replacement));
    const changed = await inspectNativeMirrors(copied, records);
    assert.throws(() => assertRetainedNativeFiles(changed, offline.files), error => error.code === 'metadata-input-digest-mismatch');
  }
  assert.equal(requests, beforeOffline, 'every receiving operation retained a throwing native network port');
});

test('ordinary same-URL wrong-integrity is refused beyond the native URL-only verifier', async t => {
  const root = await mkdtemp(join(tmpdir(), 'metadata-integrity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let registry;
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ name: 'ordinary-fixture',
      'dist-tags': { latest: '1.0.0' }, time: { modified: '2020-01-01T00:00:00.000Z', '1.0.0': '2020-01-01T00:00:00.000Z' },
      versions: { '1.0.0': { name: 'ordinary-fixture', version: '1.0.0', dist: { integrity: sri('right'), tarball: registry + 'ordinary-fixture/-/ordinary-fixture-1.0.0.tgz' } } } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  registry = 'http://127.0.0.1:' + server.address().port + '/';
  const config = configFor(registry), cacheDir = join(root, 'cache');
  const records = nativeRecords({ packages: { 'ordinary-fixture@1.0.0': { resolution: { integrity: sri('right') } } } }, config);
  const input = { workspace: root, cacheDir, config, records }, file = join(root, 'input.json');
  await writeFile(file, JSON.stringify(input)); await run(process.execPath, [child, file, 'acquire']);
  records.registry[0].resolution.integrity = sri('wrong');
  await assert.rejects(nativeMetadataPass({ ...input, records, offline: true }), error => error.code === 'metadata-selected-integrity-mismatch');
});
