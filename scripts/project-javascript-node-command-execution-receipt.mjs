#!/usr/bin/env node
import { admitJavascriptNodeCommandExecutionRequest } from "@red-cup-engineering/javascript-node-services-section/admit-javascript-node-command-execution-request";
import { freezeJson } from "@red-cup-engineering/json-services-section";
import { runJavascriptNodeOperation } from "../src/operation.mjs";

function admitExecutionResult(result) {
  if (
    result === null
    || typeof result !== "object"
    || Array.isArray(result)
    || Object.keys(result).sort().join(",") !== "error,signal,status,stderr,stdout,type,version"
    || result.type !== "JavascriptNodeCommandExecutionResult"
    || result.version !== 1
    || !(result.status === null || Number.isInteger(result.status))
    || !(result.signal === null || typeof result.signal === "string")
    || typeof result.stdout !== "string"
    || typeof result.stderr !== "string"
    || typeof result.error !== "string"
  ) throw new TypeError("result must be an exact JavascriptNodeCommandExecutionResult@1");
  return result;
}

/**
 * Projects the exact execution request and child-process result boundary to an immutable receipt.
 *
 * @param {object} projection An exact JavascriptNodeCommandExecutionReceiptProjectionRequest@1.
 * @returns {object} An immutable JavascriptNodeCommandExecutionReceipt@1.
 */
export function projectJavascriptNodeCommandExecutionReceipt(projection) {
  if (
    projection === null
    || typeof projection !== "object"
    || Array.isArray(projection)
    || Object.keys(projection).sort().join(",") !== "request,result,type,version"
    || projection.type !== "JavascriptNodeCommandExecutionReceiptProjectionRequest"
    || projection.version !== 1
  ) throw new TypeError("projection must be an exact JavascriptNodeCommandExecutionReceiptProjectionRequest@1");
  const request = admitJavascriptNodeCommandExecutionRequest(projection.request);
  const result = admitExecutionResult(projection.result);
  return freezeJson({
    type: "JavascriptNodeCommandExecutionReceipt",
    version: 1,
    request,
    result,
  });
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "project-javascript-node-command-execution-receipt", description: "Projects the exact execution request and child-process result boundary to an immutable receipt.", operation: projectJavascriptNodeCommandExecutionReceipt }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
