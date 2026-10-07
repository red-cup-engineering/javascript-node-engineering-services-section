#!/usr/bin/env node
// Runs an already-admitted shell-style command string in a sandboxed child
// process and reports pass/fail plus its combined output. Recovered from the
// deleted @red-cup-engineering/sandbox-command-execution-service
// (a8f47a569b7) for its three remaining house consumers (software-mission-
// execution-service's agent-tools.mjs and mission-runtime.mjs, and protected-
// acceptance-service's acceptance-capsule.mjs), each of which hands it a
// caller-supplied command string (a mission manifest's verify/acceptance
// command) rather than an already-split program+arguments pair, so it is not
// the same contract as this package's own execute-javascript-node-command
// (which deliberately never invokes a shell): this is the node substrate's
// shell-command-string effectful capability; that one is its no-shell exact
// program capability. Node builtins only.
import { spawnSync } from "node:child_process";

/**
 * Splits a command string into argv when every token is shell-metacharacter
 * free, so a simple command need not pay for a shell at all. Returns null
 * when the string contains anything a shell would treat specially, so the
 * caller falls back to real shell execution for it.
 * @param {string} command
 * @returns {string[]|null}
 */
export function directArguments(command) {
  const parts = String(command || "").trim().split(/\s+/u).filter(Boolean);
  return parts.length > 0 && parts.every((part) => /^[A-Za-z0-9_./:@=+,%-]+$/u.test(part)) ? parts : null;
}

/** @param {{status: number|null, stdout?: string, stderr?: string, error?: Error, signal: string|null}} result */
export function normalizeCommandResult(result) {
  return Object.freeze({
    code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message || "",
    cancelled: result.signal !== null && result.status === null,
  });
}

/** @param {{code: number|null, stdout: string, stderr: string, error: string}} result */
export function normalizeVerificationResult(result) {
  return Object.freeze({
    passed: result.code === 0,
    output: `exit=${result.code}\n${result.stdout}\n${result.stderr}\n${result.error}`,
  });
}

/**
 * Runs one already-admitted command in `cwd` and captures its result.
 * @param {string} command
 * @param {{cwd?: string, shell?: boolean|"auto", signal?: AbortSignal}} [options]
 * @returns {{code: number|null, stdout: string, stderr: string, error: string, cancelled: boolean}}
 */
export function runCommand(command, { cwd, shell = "auto", signal } = {}) {
  if (signal?.aborted) throw signal.reason ?? new Error("command execution cancelled by customer");
  const childEnvironment = { ...process.env };
  // A recursive `node --test` must not inherit the outer test runner's
  // suppression of a nested one: a verification command is a separate host
  // act.
  delete childEnvironment.NODE_TEST_CONTEXT;
  const argv = shell === true ? null : directArguments(command);
  if (argv?.[0] === "node") argv[0] = process.execPath;
  const result = argv
    ? spawnSync(argv[0], argv.slice(1), { cwd, shell: false, encoding: "utf8", maxBuffer: Number.POSITIVE_INFINITY, env: childEnvironment })
    : spawnSync(command, { cwd, shell: shell === false ? false : true, encoding: "utf8", maxBuffer: Number.POSITIVE_INFINITY, env: childEnvironment });
  return normalizeCommandResult(result);
}

/**
 * Runs a test/verification command in `workdir`; passed = exit code 0.
 * @param {string} workdir
 * @param {string} command
 * @param {{shell?: boolean|"auto", signal?: AbortSignal}} [opts]
 * @returns {{passed: boolean, output: string}}
 */
export function runTestsCommand(workdir, command, opts = {}) {
  return normalizeVerificationResult(runCommand(command, { cwd: workdir, ...opts }));
}
