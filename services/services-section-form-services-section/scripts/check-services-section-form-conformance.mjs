#!/usr/bin/env node
import { validateJsonSchema } from "@red-cup-engineering/json-schema-services-section/validation";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";
import { findServicesSectionRepositoryRoot, readServicesSectionLaw } from "./read-services-section-law.mjs";

const operationDefinition = {
  name: "checkServicesSectionFormConformance",
  description: "Checks a ServicesSectionForm record for conformance against services-section-form.schema.json, composing @red-cup-engineering/computer-data-engine for the whole judgment.",
  inputSchema: { type: "object" },
  outputSchema: {
    type: "object",
    required: ["conformant", "obstructions"],
    additionalProperties: false,
    properties: {
      conformant: { type: "boolean" },
      obstructions: { type: "array" },
    },
  },
};

/**
 * Checks a ServicesSectionForm record for conformance against services-section-form.schema.json, calling @red-cup-engineering/computer-system-engine's own validateJsonSchema for the whole judgment; performs no schema evaluation of its own.
 * @param {object} form A ServicesSectionForm record — the exact shape foldDirectoryEntriesIntoServicesSectionForm produces.
 * @param {object} schema The applicable Group law, supplied by the consumer.
 * @returns {object} `{conformant, obstructions}` — conformant is whether form validates against services-section-form.schema.json; obstructions is the validator's own issue list ({kind, path, keyword, message}), empty when conformant is true.
 * @throws {TypeError} When form is not a non-null, non-array object.
 */
export function checkServicesSectionFormConformance(form, schema) {
  if (typeof form !== "object" || form === null || Array.isArray(form)) throw new TypeError("form must be a non-null object");
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) throw new TypeError("schema must be supplied explicitly");
  const result = validateJsonSchema(form, schema);
  return { conformant: result.valid, obstructions: result.issues };
}

if (import.meta.main) {
  let law;
  const operation = async (form) => {
    law ??= readServicesSectionLaw(await findServicesSectionRepositoryRoot(process.cwd()));
    return checkServicesSectionFormConformance(form, (await law).schema);
  };
  process.exitCode = (await runJavascriptNodeOperation(
    { ...operationDefinition, operation },
    { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout },
  )).exitCode;
}
