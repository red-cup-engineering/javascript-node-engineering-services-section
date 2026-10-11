import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { isolateJavascriptNodeCommandExecutionRequest } from "@red-cup-engineering/javascript-node-services-section/isolate-javascript-node-command-execution-request";
import { executeJavascriptNodeCommandAsynchronously } from "../scripts/execute-javascript-node-command-asynchronously.mjs";

const request = (arguments_, fields = {}) => ({
  type: "JavascriptNodeCommandExecutionRequest",
  version: 1,
  command: process.execPath,
  arguments: arguments_,
  directory: tmpdir(),
  environment: null,
  input: null,
  ...fields,
});

test("executes an explicit program without blocking and resolves its receipt", async () => {
  const pending = executeJavascriptNodeCommandAsynchronously(request(["-e", "process.stdin.pipe(process.stdout); process.stderr.write('err')"], { input: "in" }));
  let turned = false;
  await Promise.resolve().then(() => { turned = true; });
  assert.equal(turned, true);
  const receipt = await pending;
  assert.deepEqual(receipt.result, { type: "JavascriptNodeCommandExecutionResult", version: 1, status: 0, signal: null, stdout: "in", stderr: "err", error: "" });
});

test("returns spawn failure as receipt evidence", async () => {
  const receipt = await executeJavascriptNodeCommandAsynchronously(request([], { command: "command-that-does-not-exist-for-command-service-test" }));
  assert.equal(receipt.result.status, null);
  assert.match(receipt.result.error, /ENOENT/u);
});

test("kills a program that outlives its time together with what it started", async () => {
  const marker = path.join(mkdtempSync(path.join(tmpdir(), "execute-async-")), "grandchild-survived");
  const grandchild = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x"), 600)`;
  const receipt = await executeJavascriptNodeCommandAsynchronously(request(["-e", `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" }); setTimeout(() => {}, 5000)`]), { timeoutMilliseconds: 150 });
  assert.equal(receipt.result.signal, "SIGKILL");
  assert.match(receipt.result.error, /timed out after 150 ms/u);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(spawnSync("test", ["-e", marker]).status, 1);
  rmSync(path.dirname(marker), { recursive: true, force: true });
});

test("keeps only the end of each stream when an output limit is set", async () => {
  const receipt = await executeJavascriptNodeCommandAsynchronously(request(["-e", "process.stdout.write('abcdef')"]), { outputLimit: 3 });
  assert.equal(receipt.result.stdout, "def");
});

test("refuses implicit execution fields and unbounded policies", () => {
  const { input: _input, ...partial } = request([]);
  assert.throws(() => executeJavascriptNodeCommandAsynchronously(partial), TypeError);
  assert.throws(() => executeJavascriptNodeCommandAsynchronously(request([]), { timeoutMilliseconds: 0 }), TypeError);
});

const sandboxed = spawnSync("bwrap", ["--unshare-all", "--ro-bind", "/", "/", "--", "true"]).status === 0;

test("an isolated request writes only where it is bound, sees no hidden files and reaches no network", { skip: sandboxed ? false : "bubblewrap with user namespaces is unavailable" }, async (context) => {
  const root = mkdtempSync(path.join(homedir(), ".execute-isolated-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const writable = path.join(root, "work");
  mkdirSync(writable);
  writeFileSync(path.join(root, "secret"), "hidden");
  const program = [
    "const fs = require('node:fs');",
    "fs.writeFileSync('made', 'ok');",
    `let secret = 'unseen'; try { secret = fs.readFileSync(${JSON.stringify(path.join(root, "secret"))}, 'utf8'); } catch {}`,
    "let outside = 'refused'; try { fs.writeFileSync('/etc/561-isolation-escape', 'x'); outside = 'written'; } catch (error) { outside = error.code; }",
    "require('node:net').connect(80, '1.1.1.1').on('error', (error) => { process.stdout.write(JSON.stringify({ secret, outside, network: error.code, home: process.env.HOME, keys: Object.keys(process.env).sort() })); });",
  ].join("\n");
  const node = path.dirname(path.dirname(process.execPath));
  const receipt = await executeJavascriptNodeCommandAsynchronously(isolateJavascriptNodeCommandExecutionRequest({
    type: "JavascriptNodeCommandIsolationRequest",
    version: 1,
    request: request(["-e", program], { directory: writable, environment: { HOME: "/tmp", PATH: path.dirname(process.execPath) } }),
    hidden: ["/home", "/tmp"],
    readable: [node],
    writable: [writable],
  }), { timeoutMilliseconds: 20_000 });
  assert.equal(receipt.result.status, 0, receipt.result.stderr);
  const seen = JSON.parse(receipt.result.stdout);
  assert.equal(seen.secret, "unseen");
  assert.equal(seen.outside, "EROFS");
  assert.equal(readFileSync(path.join(writable, "made"), "utf8"), "ok");
  assert.match(seen.network, /ENETUNREACH|EAI_AGAIN|ECONNREFUSED/u);
  assert.equal(seen.home, "/tmp");
  assert.deepEqual(seen.keys, ["HOME", "PATH", "PWD"]);
});
