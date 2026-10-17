import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const pnpmEntry = process.env.QUALIFIED_PNPM_ENTRY;
const publicationModule = process.env.PUBLICATION_COMMAND_MODULE;
const enabled = Boolean(pnpmEntry && publicationModule);
const published = "2026-10-17T01:49:17.638Z";
const eligible = Date.parse(published) + 1440 * 60_000;
const name = "@red-cup-engineering/organizing";
const version = "0.3.4";
const integrity = "sha512-" + Buffer.alloc(64, 7).toString("base64");

async function captureExecution(file, args, options) {
  try {
    return { status: 0, signal: null, killed: false, ...await execute(file, args, options) };
  } catch (error) {
    return { status: error.code, signal: error.signal ?? null, killed: error.killed ?? false,
      stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

function assertNormalPolicyRefusal(result) {
  assert.equal(result.signal, null, "policy refusal must terminate without a signal");
  assert.equal(result.killed, false, "policy refusal must not be killed or timed out");
  assert.equal(result.status, 1, "policy refusal must have PNPM's normal numeric exit code 1");
  assert.match(result.stdout + result.stderr, /ERR_PNPM_NO_MATURE_MATCHING_VERSION/);
}

test("abnormal termination cannot qualify as native policy refusal", async t => {
  const marker = 'console.log("ERR_PNPM_NO_MATURE_MATCHING_VERSION");';
  for (const [label, source, options] of [
    ["timeout", marker + "setInterval(() => {}, 1000);", { timeout: 1000 }],
    ["signal", marker + 'process.kill(process.pid, "SIGTERM");', {}],
    ["maxBuffer", marker + 'console.log("x".repeat(8192));', { maxBuffer: 1024 }],
  ]) {
    await t.test(label, async () => {
      const result = await captureExecution(process.execPath, ["-e", source], options);
      assert.match(result.stdout + result.stderr, /ERR_PNPM_NO_MATURE_MATCHING_VERSION/);
      if (label === "timeout") assert.equal(result.killed, true);
      if (label === "signal") assert.equal(result.signal, "SIGTERM");
      if (label === "maxBuffer") assert.equal(result.status, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
      assert.throws(() => assertNormalPolicyRefusal(result), { code: "ERR_ASSERTION" });
      t.diagnostic(JSON.stringify({ label, status: result.status, signal: result.signal,
        killed: result.killed, qualifiedAsPolicyRefusal: false }));
    });
  }
});

// This tests PNPM's supported CLI and publication's supplied command projection.
// Registry metadata and time are controlled inputs; no actual Organizing carrier
// is downloaded and no application installation or first-party admission occurs.
test("publication preparation retains native PNPM age policy", { skip: !enabled }, async t => {
  assert.equal(JSON.parse(await readFile(resolve(pnpmEntry, "../../package.json"), "utf8")).version, "11.28.5");
  const { packageManagerInstallCommand } = await import(pathToFileURL(resolve(publicationModule)));
  const root = await mkdtemp(join(tmpdir(), "pnpm-publication-age-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (decodeURIComponent(request.url).toLowerCase() !== "/" + name) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ name, "dist-tags": { latest: version },
      time: { created: published, modified: published, [version]: published },
      versions: { [version]: { name, version, dist: { integrity,
        tarball: `http://127.0.0.1:${server.address().port}/organizing-0.3.4.tgz` } } } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const registry = `http://127.0.0.1:${server.address().port}/`;
  const policy = "packages: []\nminimumReleaseAge: 1440\nminimumReleaseAgeStrict: true\n";
  for (const [label, now, admitted] of [["before", eligible - 1, false], ["after", eligible + 1, true]]) {
    await t.test(label, async () => {
      const project = join(root, label);
      await mkdir(project);
      const manifest = JSON.stringify({ name: "age-policy-consumer", version: "0.0.0",
        dependencies: { [name]: version } }, null, 2) + "\n";
      const npmrc = `registry=${registry}\n@red-cup-engineering:registry=${registry}\nupdate-notifier=false\n`;
      await writeFile(join(project, "package.json"), manifest);
      await writeFile(join(project, "pnpm-workspace.yaml"), policy);
      await writeFile(join(project, ".npmrc"), npmrc);
      const home = join(project, "home");
      await mkdir(home);
      const userConfig = join(home, "empty-npmrc");
      await writeFile(userConfig, "");
      const clock = join(project, "clock.mjs");
      await writeFile(clock, `const NativeDate = Date; globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [${now}])); } static now() { return ${now}; } };\n`);
      const command = packageManagerInstallCommand("pnpm", registry, "update-lock", { cacheRoot: join(project, "cache") });
      assert.equal(command.command, "pnpm");
      assert.equal(command.arguments.some(value => /minimumReleaseAge|minimum-release-age/.test(value)), false);
      const result = await captureExecution(process.execPath,
          ["--import", clock, resolve(pnpmEntry), ...command.arguments, "--lockfile-only", "--ignore-scripts", "--reporter=append-only"],
          { cwd: project, timeout: 45_000, maxBuffer: 2 * 1024 * 1024,
            env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home,
              CI: "true", npm_config_userconfig: userConfig, npm_config_globalconfig: userConfig } });
      const output = result.stdout + result.stderr;
      assert.equal(await readFile(join(project, "pnpm-workspace.yaml"), "utf8"), policy);
      assert.equal(await readFile(join(project, "package.json"), "utf8"), manifest);
      assert.equal(await readFile(join(project, ".npmrc"), "utf8"), npmrc);
      assert.doesNotMatch(output, /Added .*minimumReleaseAgeExclude/);
      if (admitted) {
        assert.equal(result.signal, null);
        assert.equal(result.killed, false);
        assert.equal(result.status, 0, output);
        const lock = await readFile(join(project, "pnpm-lock.yaml"), "utf8");
        assert.match(lock, /specifier: 0\.3\.4\s+version: 0\.3\.4/);
        assert.ok(lock.includes(integrity));
        assert.ok(lock.includes("@red-cup-engineering/organizing@0.3.4"));
      } else {
        assertNormalPolicyRefusal(result);
        await assert.rejects(access(join(project, "pnpm-lock.yaml")), { code: "ENOENT" });
      }
      await assert.rejects(access(join(project, "node_modules")), { code: "ENOENT" });
      t.diagnostic(JSON.stringify({ label, pnpm: "11.28.5", published, observedAt: new Date(now).toISOString(),
        minimumReleaseAge: 1440, nativeStatus: result.status, signal: result.signal, killed: result.killed,
        selected: admitted ? `${name}@${version}` : null,
        policyUnchanged: true, applicationInstalled: false }));
    });
  }
  assert.ok(requests.length >= 2);
  assert.ok(requests.every(url => !url.endsWith(".tgz")), "lock-only policy assay must not download carriers");
});
