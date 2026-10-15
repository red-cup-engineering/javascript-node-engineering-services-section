#!/usr/bin/env node
import path from "node:path";

import { admitJavascriptNodeCommandExecutionRequest } from "@red-cup-engineering/javascript-node-services-section/admit-javascript-node-command-execution-request";

const absolutePaths = (value) => Array.isArray(value) && value.every((entry) => typeof entry === "string" && path.isAbsolute(entry) && path.resolve(entry) === entry);

/**
 * Wraps an exact command request so its program runs inside a bubblewrap sandbox: every namespace
 * unshared (no network, its own process tree, dying with the process that started it), the host
 * filesystem read-only, with a hidden root applied before synthetic dev/proc. Other `hidden`
 * directories are replaced by empty tmpfs mounts afterward, so explicit dev/proc masks remain hidden; each `readable` one is shown
 * again read-only and each `writable` one bound read-write, in that order, so a later entry reopens
 * what an earlier one hid. The program starts in the request's directory with exactly the request's
 * environment; nothing of the host's is inherited. The wrapped request is still one exact request,
 * executed by whichever command executor the caller chooses.
 * @param {object} isolation An exact JavascriptNodeCommandIsolationRequest@1.
 * @returns {object} The JavascriptNodeCommandExecutionRequest@1 that runs `bwrap`.
 */
export function isolateJavascriptNodeCommandExecutionRequest(isolation) {
  if (
    isolation === null
    || typeof isolation !== "object"
    || Array.isArray(isolation)
    || Object.keys(isolation).sort().join(",") !== "hidden,readable,request,type,version,writable"
    || isolation.type !== "JavascriptNodeCommandIsolationRequest"
    || isolation.version !== 1
    || !absolutePaths(isolation.hidden)
    || !absolutePaths(isolation.readable)
    || !absolutePaths(isolation.writable)
  ) throw new TypeError("isolation must be an exact JavascriptNodeCommandIsolationRequest@1");
  const request = admitJavascriptNodeCommandExecutionRequest(isolation.request);
  return admitJavascriptNodeCommandExecutionRequest({
    type: "JavascriptNodeCommandExecutionRequest",
    version: 1,
    command: "bwrap",
    arguments: [
      "--die-with-parent", "--new-session", "--unshare-all",
      "--ro-bind", "/", "/",
      ...isolation.hidden.filter((entry) => entry === "/").flatMap((entry) => ["--tmpfs", entry]),
      "--dev", "/dev", "--proc", "/proc",
      ...isolation.hidden.filter((entry) => entry !== "/").flatMap((entry) => ["--tmpfs", entry]),
      ...isolation.readable.flatMap((entry) => ["--ro-bind", entry, entry]),
      ...isolation.writable.flatMap((entry) => ["--bind", entry, entry]),
      "--chdir", request.directory,
      "--clearenv", ...Object.entries(request.environment ?? {}).flatMap(([name, value]) => ["--setenv", name, value]),
      "--", request.command, ...request.arguments,
    ],
    directory: request.directory,
    environment: null,
    input: request.input,
  });
}

if (import.meta.main) {
  const { runJavascriptNodeOperation } = await import("../src/operation.mjs");
  const result = await runJavascriptNodeOperation({ name: "isolate-javascript-node-command-execution-request", description: "Wraps an exact command request so its program runs inside a bubblewrap sandbox.", operation: isolateJavascriptNodeCommandExecutionRequest }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
