import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareRuntimeBindings, retainedRuntimeTargets, runtimeBindingTransaction, runtimeFingerprint } from '../src/runtime-bindings.mjs';

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'independent-runtime-'));
  const root = join(home, 'releases');
  const initial = join(root, 'first');
  await mkdir(initial, { recursive: true });
  const services = new Map(), ports = new Map(), calls = [];
  for (const name of ['a', 'b']) {
    await mkdir(join(initial, name, 'node_modules'), { recursive: true });
    await mkdir(join(initial, name, 'dep'), { recursive: true });
    await writeFile(join(initial, name, 'package.json'), JSON.stringify({ name, type: 'module', dependencies: { dependency: '1' } }));
    await writeFile(join(initial, name, 'dep/package.json'), JSON.stringify({ name: 'dependency', type: 'module' }));
    await writeFile(join(initial, name, 'dep/value.mjs'), 'export const value="first";');
    await symlink('../dep', join(initial, name, 'node_modules/dependency'));
    await writeFile(join(initial, name, 'asset.txt'), 'first');
    await writeFile(join(initial, name, 'server.mjs'), `import {createServer} from 'node:http';import {readFileSync} from 'node:fs';import {value} from './dep/value.mjs';const server=createServer((req,res)=>{if(req.url==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: connected\\n\\n');const timer=setInterval(()=>res.write('data: alive\\n\\n'),20);res.on('close',()=>clearInterval(timer));}else res.end(value+':'+readFileSync('asset.txt','utf8'));});server.listen(0,'127.0.0.1',()=>process.send(server.address().port));`);
    await writeFile(join(initial, name + '.service'), '[Service]\nWorkingDirectory=' + join(root, 'runtimes', name + '.service', name) + '\n');
  }
  await symlink('first', join(root, 'current'));
  const runtimes = ['a', 'b'].map(name => ({ name: name + '.service', project: name, file: name + '.service', health: name }));
  async function stop(name) {
    const child = services.get(name);
    if (child) { await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); services.delete(name); }
  }
  async function systemctl(args) {
    calls.push(args);
    const [action, name] = args;
    if (action === 'is-active') return services.has(name) ? 'active' : 'inactive';
    if (action === 'restart' || action === 'start') {
      await stop(name);
      const project = name.replace('.service', '');
      const child = fork('server.mjs', [], { cwd: await realpath(join(root, 'runtimes', name, project)), stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] });
      services.set(name, child);
      const port = await new Promise((accept, reject) => { child.once('message', accept); child.once('error', reject); child.once('exit', () => reject(Error('server exited before listening'))); });
      ports.set(name, port);
    }
    if (action === 'stop' || action === 'disable') await stop(args.at(-1));
    return '';
  }
  const healthy = async plan => {
    for (let attempt = 0; attempt < 20; attempt++) {
      try { return (await fetch('http://127.0.0.1:' + ports.get(plan.name))).ok; }
      catch (error) { if (attempt === 19) throw error; await new Promise(r => setTimeout(r, 10)); }
    }
  };
  const prepare = release => prepareRuntimeBindings({ home, releaseRoot: root, release: join(root, release), runtimes });
  const apply = plans => runtimeBindingTransaction(plans, { systemctl, healthy });
  return { home, root, initial, services, ports, calls, prepare, apply, systemctl, async close() { for (const name of services.keys()) await stop(name); await rm(home, { recursive: true, force: true }); } };
}

test('unrelated publications keep a real open event stream and its immutable assets; dependency changes reach only their consumer', async () => {
  const f = await fixture();
  try {
    await f.apply(await f.prepare('first')).apply();
    const originalA = f.services.get('a.service'), originalB = f.services.get('b.service');
    const controller = new AbortController();
    const stream = (await fetch('http://127.0.0.1:' + f.ports.get('a.service') + '/events', { signal: controller.signal })).body.getReader();
    await stream.read();
    for (const release of ['second', 'third', 'fourth']) {
      await cp(f.initial, join(f.root, release), { recursive: true, verbatimSymlinks: true });
      await writeFile(join(f.root, release, 'unrelated.txt'), release);
      const plans = await f.prepare(release);
      assert.ok(plans.every(p => !p.changed));
      await f.apply(plans).apply();
      await rm(join(f.root, 'current')); await symlink(release, join(f.root, 'current'));
    }
    assert.equal(f.services.get('a.service'), originalA);
    assert.equal(f.services.get('b.service'), originalB);
    assert.equal(await readlink(join(f.root, 'runtimes/a.service')), '../first');
    assert.deepEqual(await retainedRuntimeTargets(f.root), ['first']);
    // Exercise the surviving carrier after the ordinary two-release retention window.
    await rm(join(f.root, 'second'), { recursive: true });
    assert.equal((await stream.read()).done, false);
    assert.equal(await (await fetch('http://127.0.0.1:' + f.ports.get('a.service'))).text(), 'first:first');
    controller.abort();
    await writeFile(join(f.root, 'fourth/a/dep/value.mjs'), 'export const value="changed";');
    const changed = await f.prepare('fourth');
    assert.deepEqual(changed.map(p => p.changed), [true, false]);
    await f.apply(changed).apply();
    assert.notEqual(f.services.get('a.service'), originalA);
    assert.equal(f.services.get('b.service'), originalB);
    assert.equal(await (await fetch('http://127.0.0.1:' + f.ports.get('a.service'))).text(), 'changed:first');
  } finally { await f.close(); }
});

test('failed receiving rolls back changed bindings and units while the untouched process lives', async () => {
  const f = await fixture();
  try {
    await f.apply(await f.prepare('first')).apply();
    const b = f.services.get('b.service');
    await cp(f.initial, join(f.root, 'bad'), { recursive: true, verbatimSymlinks: true });
    await writeFile(join(f.root, 'bad/a/asset.txt'), 'bad');
    const plans = await f.prepare('bad');
    const transaction = runtimeBindingTransaction(plans, { systemctl: f.systemctl, healthy: async () => false });
    // A rejection after moving/installing is inside the rollback boundary.
    await assert.rejects(transaction.apply(), /did not answer/);
    await transaction.rollback();
    assert.equal(await readlink(join(f.root, 'runtimes/a.service')), '../first');
    assert.equal(await readFile(join(f.home, '.config/systemd/user/a.service'), 'utf8'), await readFile(join(f.initial, 'a.service'), 'utf8'));
    assert.equal(f.services.get('b.service'), b);
  } finally { await f.close(); }
});

test('admission refuses dependencies outside the immutable release and units coupled to the platform pointer', async () => {
  const f = await fixture();
  try {
    await rm(join(f.initial, 'a/node_modules/dependency')); await symlink(f.home, join(f.initial, 'a/node_modules/dependency'));
    await assert.rejects(runtimeFingerprint(f.initial, 'a'), /escapes its release/);
    await rm(join(f.initial, 'a/node_modules/dependency')); await symlink('../dep', join(f.initial, 'a/node_modules/dependency'));
    await writeFile(join(f.initial, 'a.service'), '[Service]\nWorkingDirectory=' + join(f.root, 'current/a') + '\n');
    await assert.rejects(f.prepare('first'), /own binding/);
  } finally { await f.close(); }
});
