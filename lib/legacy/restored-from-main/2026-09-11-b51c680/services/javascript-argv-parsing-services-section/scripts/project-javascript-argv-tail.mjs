#!/usr/bin/env node
import { immutableJsonValue } from "@red-cup-engineering/immutable-json-value-service";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

/**
 * Projects one complete JavaScript argument-vector carrier to its user-supplied argument tail.
 * @param {object} vector A JavascriptArgumentVector@1 carrying runtime, program, and user argument strings.
 * @returns {object} An immutable JavascriptArgvTail@1 carrying only the user arguments.
 * @throws {TypeError} When the vector carrier is inexact or contains non-string arguments.
 */
export function projectJavascriptArgvTail(vector) {
  if (vector === null || typeof vector !== "object" || Array.isArray(vector)) throw new TypeError("input must be a JavascriptArgumentVector");
  if (Object.keys(vector).sort().join(",") !== "arguments,type,version") throw new TypeError("vector must carry exactly arguments, type, and version");
  if (vector.type !== "JavascriptArgumentVector" || vector.version !== 1) throw new TypeError("vector type and version must be JavascriptArgumentVector@1");
  if (!Array.isArray(vector.arguments) || vector.arguments.length < 2 || vector.arguments.some((argument) => typeof argument !== "string")) throw new TypeError("vector.arguments must contain string runtime and program addresses followed by user arguments");
  return immutableJsonValue({ type: "JavascriptArgvTail", version: 1, arguments: vector.arguments.slice(2) });
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "project-javascript-argv-tail", description: "Projects one complete JavaScript argument-vector carrier to its user-supplied argument tail.", operation: projectJavascriptArgvTail }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
