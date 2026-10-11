#!/usr/bin/env node
import { spawn } from "node:child_process";
import { admitJavascriptNodeCommandExecutionRequest } from "@red-cup-engineering/javascript-node-services-section/admit-javascript-node-command-execution-request";

import { projectJavascriptNodeCommandExecutionReceipt } from "@red-cup-engineering/javascript-node-services-section/project-javascript-node-command-execution-receipt";

const positive = (value) => value === undefined || (Number.isSafeInteger(value) && value > 0);

/** Kill the child's whole process group: the program and everything it started. */
function killGroup(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/**
 * Executes one exact program request without a shell and without blocking this process: the
 * receipt arrives when the program exits. The program leads its own process group, so a program
 * that outlives `timeoutMilliseconds` is killed together with everything it started.
 * @param {object} candidateRequest An exact JavascriptNodeCommandExecutionRequest@1.
 * @param {{ timeoutMilliseconds?: number, outputLimit?: number }} policy Local execution bounds, not
 *   part of the caller's command data: the time the program may run, and how many characters of the
 *   end of each output stream are kept.
 * @returns {Promise<object>} An immutable JavascriptNodeCommandExecutionReceipt@1; never rejects
 *   once the request and policy are admitted.
 */
export function executeJavascriptNodeCommandAsynchronously(candidateRequest, policy = {}) {
  const request = admitJavascriptNodeCommandExecutionRequest(candidateRequest);
  if (policy === null || typeof policy !== "object" || Array.isArray(policy) || !positive(policy.timeoutMilliseconds) || !positive(policy.outputLimit)) {
    throw new TypeError("execution policy timeoutMilliseconds and outputLimit must be positive safe integers when supplied");
  }
  const limit = policy.outputLimit ?? Number.POSITIVE_INFINITY;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;
    const finish = (status, signal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(projectJavascriptNodeCommandExecutionReceipt({
        type: "JavascriptNodeCommandExecutionReceiptProjectionRequest",
        version: 1,
        request,
        result: { type: "JavascriptNodeCommandExecutionResult", version: 1, status, signal, stdout, stderr, error },
      }));
    };
    let child;
    try {
      child = spawn(request.command, request.arguments, {
        cwd: request.directory,
        shell: false,
        detached: true,
        env: request.environment === null ? undefined : request.environment,
        stdio: [request.input === null ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (error) {
      finish(null, null, error instanceof Error ? error.message : String(error));
      return;
    }
    let timedOut = "";
    // Not spawn's own timeout option: that one signals only the program, never what it started.
    if (policy.timeoutMilliseconds !== undefined) {
      timer = setTimeout(() => {
        timedOut = `timed out after ${policy.timeoutMilliseconds} ms`;
        killGroup(child);
      }, policy.timeoutMilliseconds);
    }
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout = (stdout + chunk).slice(-limit); });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr = (stderr + chunk).slice(-limit); });
    // A program that exits before reading its input closes the pipe; the receipt still reports its exit.
    if (request.input !== null) child.stdin.on("error", () => undefined).end(request.input);
    child.on("error", (error) => finish(null, null, error.message));
    child.on("close", (code, signal) => finish(Number.isInteger(code) ? code : null, typeof signal === "string" ? signal : null, timedOut));
  });
}
