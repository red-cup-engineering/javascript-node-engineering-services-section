import { parseJsonValue } from "@red-cup-engineering/json-services-section/parse-json-value";
import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
import { isJsonValue } from "@red-cup-engineering/json-services-section/is-json-value";

import { admit, defineType } from "@red-cup-engineering/signcell/type-system";

function refusal(reason, message) {
  return Object.freeze({ ok: false, refusal: Object.freeze({ reason, message }) });
}
function caught(error) {
  return refusal(error instanceof Error ? error.name : "OperationError", error instanceof Error ? error.message : String(error));
}

/** Bind one implementation to shared domain and codomain declarations; invalid declarations throw before execution. */
export function createJavascriptNodeOperation(definition) {
  const input = defineType({ id: `${definition.name}:input`, name: `${definition.name} input`, description: definition.description, schema: definition.inputSchema ?? true, parents: [] });
  const output = defineType({ id: `${definition.name}:output`, name: `${definition.name} output`, description: definition.description, schema: definition.outputSchema ?? true, parents: [] });
  if (!input.ok) throw new TypeError(input.refusal.message);
  if (!output.ok) throw new TypeError(output.refusal.message);
  const operation = definition.operation;
  if (typeof operation !== "function") throw new TypeError("operation must be callable");
  return Object.freeze({
    name: definition.name, description: definition.description, inputType: input.value, outputType: output.value,
    async invoke(value) {
      const admitted = admit(input.value, value);
      if (!admitted.ok) return refusal("InvalidInput", admitted.refusal.issues.map(issue => `${issue.path || "/"} ${issue.message}`).join("; "));
      try {
        const result = await operation(value);
        const accepted = admit(output.value, result);
        return accepted.ok ? Object.freeze({ ok: true, value: result }) : refusal("InvalidOutput", accepted.refusal.issues.map(issue => `${issue.path || "/"} ${issue.message}`).join("; "));
      } catch (error) { return caught(error); }
    },
  });
}

async function emit(value, output) {
  if (!isJsonValue(value)) throw new TypeError("operation output must be a JSON value");
  await write(`${canonicalJson(value)}\n`, output);
}
function write(text, output) {
  return new Promise((resolve, reject) => output.write(text, error => error ? reject(error) : resolve()));
}

/** One NDJSON interpreter shared by individual commands and command catalogs. */
async function run(executor, streams) {
  let pending = "", processed = 0, refused = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const line = async (text) => {
    if (text.endsWith("\r")) text = text.slice(0, -1);
    if (text.length === 0) return;
    processed += 1;
    let result ;
    try { result = await executor.invoke(parseJsonValue(text)); } catch (error) { result = caught(error); }
    if (!result.ok) refused += 1;
    if (result.ok && !isJsonValue(result.value)) {
      refused += 1;
      result = refusal("InvalidJsonOutput", "operation output must be a JSON value");
    }
    await emit(result.ok ? result.value : result, streams.standardOutput);
  };
  for await (const chunk of streams.standardInput) {
    pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let end ;
    while ((end = pending.indexOf("\n")) >= 0) { await line(pending.slice(0, end)); pending = pending.slice(end + 1); }
  }
  pending += decoder.decode();
  if (pending.length > 0) await line(pending);
  return Object.freeze({ exitCode: refused > 0 ? 2 : 0, processed, refused });
}

async function help(name, description, streams) {
  await write(`${name} — ${description.replace(/\n/gu, " ")}\n`, streams.standardOutput);
  return Object.freeze({ exitCode: 0, processed: 0, refused: 0 });
}

/** Execute a schema-bound command over explicitly supplied streams; returns process disposition without exiting. */
export async function runJavascriptNodeOperation(definition, streams) {
  if (streams.arguments.includes("--help")) return help(definition.name, definition.description, streams);
  let executor ;
  try { executor = createJavascriptNodeOperation(definition); }
  catch (error) { await emit(caught(error), streams.standardOutput); return Object.freeze({ exitCode: 2, processed: 0, refused: 1 }); }
  return run(executor, streams);
}

/** Select a named operation while reusing the same input, output, and refusal interpreter. */
export async function runJavascriptNodeOperationCatalog(catalog, streams) {
  const [command, ...remaining] = streams.arguments;
  if (command === undefined || command === "--help") return help(catalog.name, `${catalog.description}\n<${Object.keys(catalog.operations).join("|")}>`, streams);
  if (!Object.hasOwn(catalog.operations, command)) {
    await emit(refusal("UnknownOperation", `unknown operation ${command}`), streams.standardOutput);
    return Object.freeze({ exitCode: 2, processed: 0, refused: 1 });
  }
  const executor = catalog.operations[command] ;
  const context = { ...streams, arguments: remaining };
  return remaining.includes("--help") ? help(executor.name, executor.description, context) : run(executor, context);
}

/** Execute an argument-vector command declaration: `run({ argv, stdin, stdout, stderr })`, with an optional
 * `formatResult` written to standard output and `resultExitCode`, the exit status a result settles to (0 by
 * default); on failure `formatError` (written to standard error) and `exitCode`, a number or a function of
 * the error. */
async function runCommand(command, streams) {
  const { run, formatResult, resultExitCode = () => 0, formatError = (error) => `${error?.message ?? error}\n`, exitCode = 2 } = command;
  if (typeof run !== "function") throw new TypeError("command run must be callable");
  try {
    const result = await run({ argv: streams.arguments, stdin: streams.standardInput, stdout: streams.standardOutput, stderr: streams.standardError });
    if (formatResult) await write(formatResult(result), streams.standardOutput);
    return Object.freeze({ exitCode: resultExitCode(result) });
  } catch (error) {
    await write(formatError(error), streams.standardError);
    return Object.freeze({ exitCode: typeof exitCode === "function" ? exitCode(error) : exitCode });
  }
}

/** Execute the one runnable declaration a module exports: an `operation` (the definition
 * `createJavascriptNodeOperation` binds), a `catalog` of them ({ name, description, operations }),
 * or an argument-vector `command`. Modules below the code layer declare; this runtime executes. */
export async function runJavascriptNodeOperationModule(module, streams) {
  const declared = ["operation", "catalog", "command"].filter((kind) => module[kind] !== undefined);
  if (declared.length !== 1) throw new TypeError(`module must declare exactly one of operation, catalog or command; it declares ${declared.join(", ") || "none"}`);
  if (declared[0] === "operation") return runJavascriptNodeOperation(module.operation, streams);
  if (declared[0] === "command") return runCommand(module.command, streams);
  const { name, description, operations } = module.catalog;
  const created = Object.fromEntries(Object.entries(operations).map(([command, definition]) => [command, createJavascriptNodeOperation(definition)]));
  return runJavascriptNodeOperationCatalog({ name, description, operations: created }, streams);
}
