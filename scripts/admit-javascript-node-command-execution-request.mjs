#!/usr/bin/env node
import path from "node:path";

import operationInputSchema from "../data/records/admit-javascript-node-command-execution-request.input.schema.json" with { type: "json" };
import operationOutputSchema from "../data/records/admit-javascript-node-command-execution-request.output.schema.json" with { type: "json" };

/**
 * Admits a candidate as an exact JavascriptNodeCommandExecutionRequest@1, unchanged.
 * @param {object} request A candidate JavascriptNodeCommandExecutionRequest.
 * @returns {object} The same request, admitted.
 */
export function admitJavascriptNodeCommandExecutionRequest(request) {
  if (
    request === null
    || typeof request !== "object"
    || Array.isArray(request)
    || Object.keys(request).sort().join(",") !== "arguments,command,directory,environment,input,type,version"
    || request.type !== "JavascriptNodeCommandExecutionRequest"
    || request.version !== 1
    || typeof request.command !== "string"
    || request.command.length === 0
    || !Array.isArray(request.arguments)
    || request.arguments.some((argument) => typeof argument !== "string")
    || typeof request.directory !== "string"
    || !path.isAbsolute(request.directory)
    || path.resolve(request.directory) !== request.directory
    || !(
      request.environment === null
      || (
        typeof request.environment === "object"
        && !Array.isArray(request.environment)
        && Object.values(request.environment).every((value) => typeof value === "string")
      )
    )
    || !(request.input === null || typeof request.input === "string")
  ) throw new TypeError("request must be an exact JavascriptNodeCommandExecutionRequest@1");
  return request;
}

if (import.meta.main) {
  const { runJavascriptNodeOperation } = await import("../src/operation.mjs");
  const result = await runJavascriptNodeOperation({ name: "admit-javascript-node-command-execution-request", description: "Admits a candidate as an exact JavascriptNodeCommandExecutionRequest@1, unchanged.", operation: admitJavascriptNodeCommandExecutionRequest, inputSchema: operationInputSchema, outputSchema: operationOutputSchema }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
