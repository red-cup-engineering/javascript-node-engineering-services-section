import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { directArguments, normalizeCommandResult, normalizeVerificationResult, runTestsCommand } from "../scripts/run-sandboxed-command.mjs";

test("normalizes a declared direct command without granting shell syntax", () => {
  assert.deepEqual(directArguments("node --test test/example.test.mjs"), ["node", "--test", "test/example.test.mjs"]);
  assert.equal(directArguments("node test.mjs && rm -rf scratch"), null);
  assert.equal(directArguments(""), null);
});

test("normalizes process and verification results deterministically", () => {
  const result = normalizeCommandResult({ status: 1, stdout: undefined, stderr: "failed", error: undefined, signal: null });
  assert.deepEqual(result, { code: 1, stdout: "", stderr: "failed", error: "", cancelled: false });
  assert.deepEqual(normalizeVerificationResult(result), { passed: false, output: "exit=1\n\nfailed\n" });
});

test("nested node test verification executes instead of inheriting recursive-run suppression", () => {
  const root = mkdtempSync(join(tmpdir(), "run-sandboxed-command-nested-test-"));
  writeFileSync(join(root, "failure.test.mjs"), 'import test from "node:test"; import assert from "node:assert/strict"; test("real nested failure", () => assert.equal(1, 2));\n');
  const result = runTestsCommand(root, "node --test failure.test.mjs");
  assert.equal(result.passed, false);
  assert.match(result.output, /real nested failure/);
  assert.doesNotMatch(result.output, /skipping running files/);
});

test("direct node verification binds to the provider runtime rather than ambient PATH", () => {
  const root = mkdtempSync(join(tmpdir(), "run-sandboxed-command-runtime-"));
  const fakeBin = join(root, "fake-bin");
  const fakeNode = join(fakeBin, "node");
  const priorPath = process.env.PATH;
  mkdirSync(fakeBin);
  writeFileSync(join(root, "runtime.mjs"), "if (process.execPath !== process.argv[2]) process.exit(9);\n");
  writeFileSync(fakeNode, "#!/bin/sh\necho fake-node >&2\nexit 88\n");
  chmodSync(fakeNode, 0o755);
  try {
    process.env.PATH = `${fakeBin}:${priorPath || ""}`;
    const result = runTestsCommand(root, `node runtime.mjs ${process.execPath}`);
    assert.equal(result.passed, true);
    assert.doesNotMatch(result.output, /fake-node/);
  } finally {
    priorPath === undefined ? delete process.env.PATH : (process.env.PATH = priorPath);
  }
});

test("spawn failures remain visible to verification callers", () => {
  const result = runTestsCommand(tmpdir(), "command-that-does-not-exist-run-sandboxed-command-test", { shell: false });
  assert.equal(result.passed, false);
  assert.match(result.output, /ENOENT|not found/i);
});
