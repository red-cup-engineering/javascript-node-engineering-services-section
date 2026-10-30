#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { immutableJsonValue } from "@red-cup-engineering/immutable-json-value-service";
import { parseLines, serializeLines } from "@red-cup-engineering/json-codec-service";
import { projectJavascriptArgvTail } from "./project-javascript-argv-tail.mjs";
import { readJavascriptFileExportDocumentation } from "@red-cup-engineering/read-javascript-file-export-documentation-service";
import { readJavascriptNodeStandardInputText } from "@red-cup-engineering/read-javascript-node-standard-input-text-service";
import { writeJavascriptNodeStandardOutputText } from "@red-cup-engineering/write-javascript-node-standard-output-text-service";

/**
 * Returns the value following the first occurrence of one named token in an argument vector.
 *
 * @param {string} name The named token to find.
 * @param {string[]} argumentVector The argument vector to search.
 * @returns {string | undefined} The following value, when present.
 */
export function argument(name, argumentVector = process.argv) {
  const index = argumentVector.indexOf(name);
  return index === -1 ? undefined : argumentVector[index + 1];
}

/**
 * Parses one explicit JavaScript argument-vector carrier against one explicit Node-compatible option grammar.
 *
 * @param {object} request A JavascriptArgvParsingRequest@1 carrying the complete vector, option grammar, and parsing policy.
 * @returns {object} An immutable JavascriptArgvParseRead@1 carrying parsed options and positionals.
 * @throws {TypeError} When the request is inexact or its grammar and policy are invalid.
 */
export function parseJavascriptArgv(request) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) throw new TypeError("input must be a JavascriptArgvParsingRequest");
  if (Object.keys(request).sort().join(",") !== "allowPositionals,argumentVector,options,strict,type,version") throw new TypeError("request must carry exactly allowPositionals, argumentVector, options, strict, type, and version");
  if (request.type !== "JavascriptArgvParsingRequest" || request.version !== 1) throw new TypeError("request type and version must be JavascriptArgvParsingRequest@1");
  if (request.options === null || typeof request.options !== "object" || Array.isArray(request.options)) throw new TypeError("options must be an option grammar record");
  if (typeof request.allowPositionals !== "boolean" || typeof request.strict !== "boolean") throw new TypeError("allowPositionals and strict must be booleans");
  const tail = projectJavascriptArgvTail(request.argumentVector);
  const parsed = parseArgs({ args: tail.arguments, options: request.options, allowPositionals: request.allowPositionals, strict: request.strict });
  return immutableJsonValue({ type: "JavascriptArgvParseRead", version: 1, argumentVector: request.argumentVector, options: { ...parsed.values }, positionals: [...parsed.positionals] });
}

if (import.meta.main) {
  if (process.argv.length === 3 && ["--help", "-h"].includes(process.argv[2])) {
    const source = await readFile(new URL(import.meta.url), "utf8");
    const [documentation] = readJavascriptFileExportDocumentation({ type: "TextFileRead", path: "scripts/parse-javascript-argv.mjs", text: source });
    await writeJavascriptNodeStandardOutputText({ type: "JavascriptNodeStandardOutputTextWriteRequest", version: 1, text: `${documentation.name} — ${documentation.description}\n\n${documentation.signature}\n` }, { standardOutput: process.stdout });
  } else {
    const text = (await readJavascriptNodeStandardInputText({ type: "JavascriptNodeStandardInputTextReadRequest", version: 1 }, { standardInput: process.stdin })).text;
    await writeJavascriptNodeStandardOutputText({ type: "JavascriptNodeStandardOutputTextWriteRequest", version: 1, text: serializeLines(parseLines(text).map(parseJavascriptArgv)) }, { standardOutput: process.stdout });
  }
}
