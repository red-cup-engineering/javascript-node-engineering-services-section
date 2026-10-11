#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { admitJavascriptNodeCommandExecutionRequest } from "@red-cup-engineering/javascript-node-services-section/admit-javascript-node-command-execution-request";

import { projectJavascriptNodeCommandExecutionReceipt } from "@red-cup-engineering/javascript-node-services-section/project-javascript-node-command-execution-receipt";

import operationInputSchema from "../data/records/schema/execute-javascript-node-command.input.schema.json" with { type: "json" };
import operationOutputSchema from "../data/records/schema/execute-javascript-node-command.output.schema.json" with { type: "json" };
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

/**
 * Executes one exact program request without a shell.
 * @param {object} candidateRequest An exact JavascriptNodeCommandExecutionRequest@1.
 * @param {{ timeoutMilliseconds?: number }} policy A local execution bound; it is not part of the caller's command data.
 * @returns {object} An immutable JavascriptNodeCommandExecutionReceipt@1.
 */
export function executeJavascriptNodeCommand(candidateRequest, policy = {}) {
  const request = admitJavascriptNodeCommandExecutionRequest(candidateRequest);
  if (policy === null || typeof policy !== "object" || Array.isArray(policy) || (policy.timeoutMilliseconds !== undefined && (!Number.isSafeInteger(policy.timeoutMilliseconds) || policy.timeoutMilliseconds <= 0))) {
    throw new TypeError("execution policy timeoutMilliseconds must be a positive safe integer when supplied");
  }
  const childResult = spawnSync(request.command, request.arguments, {
    cwd: request.directory,
    shell: false,
    encoding: "utf8",
    maxBuffer: Number.POSITIVE_INFINITY,
    env: request.environment === null ? undefined : request.environment,
    input: request.input === null ? undefined : request.input,
    ...(policy.timeoutMilliseconds === undefined ? {} : { timeout: policy.timeoutMilliseconds }),
  });
  const result = {
    type: "JavascriptNodeCommandExecutionResult",
    version: 1,
    status: Number.isInteger(childResult.status) ? childResult.status : null,
    signal: typeof childResult.signal === "string" ? childResult.signal : null,
    stdout: typeof childResult.stdout === "string" ? childResult.stdout : "",
    stderr: typeof childResult.stderr === "string" ? childResult.stderr : "",
    error: typeof childResult.error === "string" ? childResult.error : childResult.error?.message ?? "",
  };
  return projectJavascriptNodeCommandExecutionReceipt({
    type: "JavascriptNodeCommandExecutionReceiptProjectionRequest",
    version: 1,
    request,
    result,
  });
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "execute-javascript-node-command", description: "Executes one exact program request without a shell.", operation: executeJavascriptNodeCommand, inputSchema: operationInputSchema, outputSchema: operationOutputSchema }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
