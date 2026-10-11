#!/usr/bin/env node
import { spawnSync } from "node:child_process";

/**
 * Executes one exact program request with this process's own stdio
 * inherited by the child, untouched -- for a delegate that must hand its
 * own already-connected stdin/stdout/stderr to another program directly
 * (for example a git-lfs custom transfer agent handing the live,
 * line-delimited protocol connection straight to the real transfer
 * binary). Nothing is captured in this mode: only the exit disposition is
 * reported, because the calling and called programs, not this process,
 * own every byte that crosses stdin/stdout/stderr.
 * @param {object} request
 * @param {string} request.command
 * @param {string[]} [request.arguments]
 * @param {string} [request.directory]
 * @param {Object<string,string>|null} [request.environment] merged onto this process's own environment; omit or pass null to inherit it unchanged
 * @returns {{type: "JavascriptNodeCommandExecutionInheritedStdioResult", version: 1, status: number|null, signal: string|null, error: string}}
 */
export function executeJavascriptNodeCommandWithInheritedStdio(request) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("request must be an object");
  }
  const { command, arguments: args = [], directory = process.cwd(), environment = null } = request;
  if (typeof command !== "string" || command.length === 0) throw new TypeError("command must be a nonempty string");
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new TypeError("arguments must be an array of strings");
  }
  if (typeof directory !== "string" || directory.length === 0) throw new TypeError("directory must be a nonempty string");
  if (!(environment === null || (typeof environment === "object" && !Array.isArray(environment) && Object.values(environment).every((value) => typeof value === "string")))) {
    throw new TypeError("environment must be null or an object of strings");
  }
  const result = spawnSync(command, args, {
    cwd: directory,
    shell: false,
    stdio: "inherit",
    env: environment === null ? undefined : { ...process.env, ...environment },
  });
  return Object.freeze({
    type: "JavascriptNodeCommandExecutionInheritedStdioResult",
    version: 1,
    status: Number.isInteger(result.status) ? result.status : null,
    signal: typeof result.signal === "string" ? result.signal : null,
    error: typeof result.error === "string" ? result.error : result.error?.message ?? "",
  });
}
