import { parseArgs } from "node:util";
import type { JsonRecord } from "../../../../../../computer-data-engineering-services-section/services/serialized-computer-data-engineering-services-section/services/json-services-section/src/index.mjs";

export type JavascriptArgumentVector = Readonly<{ type: "JavascriptArgumentVector"; version: 1; arguments: readonly string[] }>;
export type JavascriptArgvTail = Readonly<{ type: "JavascriptArgvTail"; version: 1; arguments: readonly string[] }>;
export type JavascriptArgvParsingRequest = Readonly<{
  type: "JavascriptArgvParsingRequest";
  version: 1;
  argumentVector: JavascriptArgumentVector;
  options: JsonRecord;
  allowPositionals: boolean;
  strict: boolean;
}>;
export type JavascriptArgvParseRead = Readonly<{
  type: "JavascriptArgvParseRead";
  version: 1;
  argumentVector: JavascriptArgumentVector;
  options: Readonly<Record<string, unknown>>;
  positionals: readonly string[];
}>;

/** Returns the value following the first occurrence of one named token in an argument vector. */
export function argument(name: string, argumentVector: readonly string[] = process.argv): string | undefined {
  const index = argumentVector.indexOf(name);
  return index === -1 ? undefined : argumentVector[index + 1];
}

/** Returns the value following the first occurrence of one named token in an argument vector, refusing when absent. */
export function requiredArgument(name: string, argumentVector: readonly string[] = process.argv): string {
  const value = argument(name, argumentVector);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

/** Returns the value following every occurrence of one named token in an argument vector, in order. */
export function repeatedArgument(name: string, argumentVector: readonly string[] = process.argv): string[] {
  return argumentVector.flatMap((value, index) => (value === name && argumentVector[index + 1] !== undefined ? [argumentVector[index + 1] as string] : []));
}

/** Projects one complete JavaScript argument-vector carrier to its user-supplied argument tail. */
export function projectJavascriptArgvTail(vector: JavascriptArgumentVector): JavascriptArgvTail {
  if (vector === null || typeof vector !== "object" || Array.isArray(vector)) throw new TypeError("input must be a JavascriptArgumentVector");
  if (Object.keys(vector).sort().join(",") !== "arguments,type,version") throw new TypeError("vector must carry exactly arguments, type, and version");
  if (vector.type !== "JavascriptArgumentVector" || vector.version !== 1) throw new TypeError("vector type and version must be JavascriptArgumentVector@1");
  if (!Array.isArray(vector.arguments) || vector.arguments.length < 2 || vector.arguments.some((entry) => typeof entry !== "string")) throw new TypeError("vector.arguments must contain string runtime and program addresses followed by user arguments");
  return Object.freeze({ type: "JavascriptArgvTail", version: 1, arguments: Object.freeze(vector.arguments.slice(2)) });
}

/** Parses one explicit JavaScript argument-vector carrier against one explicit Node-compatible option grammar. */
export function parseJavascriptArgv(request: JavascriptArgvParsingRequest): JavascriptArgvParseRead {
  if (request === null || typeof request !== "object" || Array.isArray(request)) throw new TypeError("input must be a JavascriptArgvParsingRequest");
  if (Object.keys(request).sort().join(",") !== "allowPositionals,argumentVector,options,strict,type,version") throw new TypeError("request must carry exactly allowPositionals, argumentVector, options, strict, type, and version");
  if (request.type !== "JavascriptArgvParsingRequest" || request.version !== 1) throw new TypeError("request type and version must be JavascriptArgvParsingRequest@1");
  if (request.options === null || typeof request.options !== "object" || Array.isArray(request.options)) throw new TypeError("options must be an option grammar record");
  if (typeof request.allowPositionals !== "boolean" || typeof request.strict !== "boolean") throw new TypeError("allowPositionals and strict must be booleans");
  const tail = projectJavascriptArgvTail(request.argumentVector);
  const parsed = parseArgs({ args: [...tail.arguments], options: request.options as never, allowPositionals: request.allowPositionals, strict: request.strict }) as { values: Record<string, unknown>; positionals: string[] };
  return Object.freeze({ type: "JavascriptArgvParseRead", version: 1, argumentVector: request.argumentVector, options: Object.freeze({ ...parsed.values }), positionals: Object.freeze([...parsed.positionals]) });
}
