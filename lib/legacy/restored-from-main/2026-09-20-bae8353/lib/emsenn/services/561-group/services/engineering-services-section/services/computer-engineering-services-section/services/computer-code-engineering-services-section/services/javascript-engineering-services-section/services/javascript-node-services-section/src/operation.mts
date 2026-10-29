import { isJsonValue } from "@red-cup-engineering/computer-data-engine/json";
import type { Writable } from "node:stream";
import { admit, defineType, type DataType, type FromJsonSchema, type JsonSchema, type Result } from "@red-cup-engineering/computer-data-engine";

export type OperationRefusal = Readonly<{ reason: string; message: string }>;
export type OperationDefinition<Input extends JsonSchema = true, Output extends JsonSchema = true> = Readonly<{
  name: string;
  description: string;
  operation: (input: FromJsonSchema<Input>) => FromJsonSchema<Output> | Promise<FromJsonSchema<Output>>;
  inputSchema?: Input;
  outputSchema?: Output;
}>;
export type OperationExecutor<Output = unknown> = Readonly<{
  name: string;
  description: string;
  inputType: DataType;
  outputType: DataType;
  invoke(input: unknown): Promise<Result<Output, OperationRefusal>>;
}>;
export type OperationStreams = Readonly<{
  arguments: readonly string[];
  standardInput: AsyncIterable<string | Uint8Array>;
  standardOutput: Writable;
}>;
export type OperationRun = Readonly<{ exitCode: 0 | 2; processed: number; refused: number }>;
export type OperationCatalog = Readonly<{ name: string; description: string; operations: Readonly<Record<string, OperationExecutor>> }>;

function refusal(reason: string, message: string): Result<never, OperationRefusal> {
  return Object.freeze({ ok: false, refusal: Object.freeze({ reason, message }) });
}
function caught(error: unknown): Result<never, OperationRefusal> {
  return refusal(error instanceof Error ? error.name : "OperationError", error instanceof Error ? error.message : String(error));
}

/** Bind one implementation to shared domain and codomain declarations; invalid declarations throw before execution. */
export function createJavascriptNodeOperation<const Input extends JsonSchema = true, const Output extends JsonSchema = true>(definition: OperationDefinition<Input, Output>): OperationExecutor<FromJsonSchema<Output>> {
  const input = defineType({ id: `${definition.name}:input`, name: `${definition.name} input`, description: definition.description, schema: definition.inputSchema ?? true, parents: [] });
  const output = defineType({ id: `${definition.name}:output`, name: `${definition.name} output`, description: definition.description, schema: definition.outputSchema ?? true, parents: [] });
  if (!input.ok) throw new TypeError(input.refusal.message);
  if (!output.ok) throw new TypeError(output.refusal.message);
  const operation = definition.operation;
  if (typeof operation !== "function") throw new TypeError("operation must be callable");
  return Object.freeze({
    name: definition.name, description: definition.description, inputType: input.value, outputType: output.value,
    async invoke(value: unknown): Promise<Result<FromJsonSchema<Output>, OperationRefusal>> {
      const admitted = admit(input.value, value);
      if (!admitted.ok) return refusal("InvalidInput", admitted.refusal.issues.map(issue => `${issue.path || "/"} ${issue.message}`).join("; "));
      try {
        const result = await operation(value as FromJsonSchema<Input>);
        const accepted = admit(output.value, result);
        return accepted.ok ? Object.freeze({ ok: true, value: result }) : refusal("InvalidOutput", accepted.refusal.issues.map(issue => `${issue.path || "/"} ${issue.message}`).join("; "));
      } catch (error) { return caught(error); }
    },
  });
}

async function emit(value: unknown, output: OperationStreams["standardOutput"]): Promise<void> {
  if (!isJsonValue(value)) throw new TypeError("operation output must be a JSON value");
  await write(`${JSON.stringify(value)}\n`, output);
}
function write(text: string, output: OperationStreams["standardOutput"]): Promise<void> {
  return new Promise((resolve, reject) => output.write(text, error => error ? reject(error) : resolve()));
}

/** One NDJSON interpreter shared by individual commands and command catalogs. */
async function run(executor: OperationExecutor, streams: OperationStreams): Promise<OperationRun> {
  let pending = "", processed = 0, refused = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const line = async (text: string) => {
    if (text.endsWith("\r")) text = text.slice(0, -1);
    if (text.length === 0) return;
    processed += 1;
    let result: Result<unknown, OperationRefusal>;
    try { result = await executor.invoke(JSON.parse(text)); } catch (error) { result = caught(error); }
    if (!result.ok) refused += 1;
    if (result.ok && !isJsonValue(result.value)) {
      refused += 1;
      result = refusal("InvalidJsonOutput", "operation output must be a JSON value");
    }
    await emit(result.ok ? result.value : result, streams.standardOutput);
  };
  for await (const chunk of streams.standardInput) {
    pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) { await line(pending.slice(0, end)); pending = pending.slice(end + 1); }
  }
  pending += decoder.decode();
  if (pending.length > 0) await line(pending);
  return Object.freeze({ exitCode: refused > 0 ? 2 : 0, processed, refused });
}

async function help(name: string, description: string, streams: OperationStreams): Promise<OperationRun> {
  await write(`${name} — ${description.replace(/\n/gu, " ")}\n`, streams.standardOutput);
  return Object.freeze({ exitCode: 0, processed: 0, refused: 0 });
}

/** Execute a schema-bound command over explicitly supplied streams; returns process disposition without exiting. */
export async function runJavascriptNodeOperation<const Input extends JsonSchema = true, const Output extends JsonSchema = true>(definition: OperationDefinition<Input, Output>, streams: OperationStreams): Promise<OperationRun> {
  if (streams.arguments.includes("--help")) return help(definition.name, definition.description, streams);
  let executor: OperationExecutor;
  try { executor = createJavascriptNodeOperation(definition); }
  catch (error) { await emit(caught(error), streams.standardOutput); return Object.freeze({ exitCode: 2, processed: 0, refused: 1 }); }
  return run(executor, streams);
}

/** Select a named operation while reusing the same input, output, and refusal interpreter. */
export async function runJavascriptNodeOperationCatalog(catalog: OperationCatalog, streams: OperationStreams): Promise<OperationRun> {
  const [command, ...remaining] = streams.arguments;
  if (command === undefined || command === "--help") return help(catalog.name, `${catalog.description}\n<${Object.keys(catalog.operations).join("|")}>`, streams);
  if (!Object.hasOwn(catalog.operations, command)) {
    await emit(refusal("UnknownOperation", `unknown operation ${command}`), streams.standardOutput);
    return Object.freeze({ exitCode: 2, processed: 0, refused: 1 });
  }
  const executor = catalog.operations[command]!;
  const context = { ...streams, arguments: remaining };
  return remaining.includes("--help") ? help(executor.name, executor.description, context) : run(executor, context);
}
