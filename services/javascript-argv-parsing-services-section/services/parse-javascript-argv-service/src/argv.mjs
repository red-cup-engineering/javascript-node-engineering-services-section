import { parseArgs } from "node:util";
import { readFlagValue, readRequiredFlagValue, readRepeatedFlagValues } from "@red-cup-engineering/computer-text-content-engineering-services-section/read-flag-token-values";

export const javascriptArgumentVectorSchema = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["type", "version", "arguments"],
  properties: { type: { const: "JavascriptArgumentVector" }, version: { const: 1 }, arguments: { type: "array", minItems: 2, items: { type: "string" } } },
});

export const javascriptArgvTailSchema = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["type", "version", "arguments"],
  properties: { type: { const: "JavascriptArgvTail" }, version: { const: 1 }, arguments: { type: "array", items: { type: "string" } } },
});

export const javascriptArgvParsingRequestSchema = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["type", "version", "argumentVector", "options", "allowPositionals", "strict"],
  properties: {
    type: { const: "JavascriptArgvParsingRequest" }, version: { const: 1 }, argumentVector: javascriptArgumentVectorSchema,
    options: { type: "object", additionalProperties: true }, allowPositionals: { type: "boolean" }, strict: { type: "boolean" },
  },
});

export const javascriptArgvParseReadSchema = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["type", "version", "argumentVector", "options", "positionals"],
  properties: {
    type: { const: "JavascriptArgvParseRead" }, version: { const: 1 }, argumentVector: javascriptArgumentVectorSchema,
    options: { type: "object", additionalProperties: true }, positionals: { type: "array", items: { type: "string" } },
  },
});

function exactRecord(value, name, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new TypeError(`${name} must carry exactly ${keys.join(", ")}`);
  return value;
}

function assertArgumentVector(value) {
  const vector = exactRecord(value, "vector", ["arguments", "type", "version"]);
  if (vector.type !== "JavascriptArgumentVector" || vector.version !== 1) throw new TypeError("vector type and version must be JavascriptArgumentVector@1");
  if (!Array.isArray(vector.arguments) || vector.arguments.length < 2 || vector.arguments.some((entry) => typeof entry !== "string")) throw new TypeError("vector.arguments must contain string runtime and program addresses followed by user arguments");
  return vector;
}

/** Reads one token value from an argument vector. Process state is used only when no carrier is supplied by an existing process adapter. */
export function argument(name, argumentVector = process.argv) {
  return readFlagValue(name, argumentVector);
}

export function requiredArgument(name, argumentVector = process.argv) {
  return readRequiredFlagValue(name, argumentVector);
}

export function repeatedArgument(name, argumentVector = process.argv) {
  return readRepeatedFlagValues(name, argumentVector);
}

/** Maps one complete JavaScript argument-vector carrier to its user-supplied argument-tail carrier. */
export function projectJavascriptArgvTail(value) {
  const vector = assertArgumentVector(value);
  return Object.freeze({ type: "JavascriptArgvTail", version: 1, arguments: Object.freeze(vector.arguments.slice(2)) });
}

/** Maps a schematized vector and Node option grammar to one parsed JSON carrier. */
export function parseJavascriptArgv(value) {
  const request = exactRecord(value, "input", ["allowPositionals", "argumentVector", "options", "strict", "type", "version"]);
  if (request.type !== "JavascriptArgvParsingRequest" || request.version !== 1) throw new TypeError("request type and version must be JavascriptArgvParsingRequest@1");
  if (request.options === null || typeof request.options !== "object" || Array.isArray(request.options)) throw new TypeError("options must be an option grammar record");
  if (typeof request.allowPositionals !== "boolean" || typeof request.strict !== "boolean") throw new TypeError("allowPositionals and strict must be booleans");
  const tail = projectJavascriptArgvTail(request.argumentVector);
  const parsed = parseArgs({ args: [...tail.arguments], options: request.options, allowPositionals: request.allowPositionals, strict: request.strict });
  return Object.freeze({ type: "JavascriptArgvParseRead", version: 1, argumentVector: request.argumentVector, options: Object.freeze({ ...parsed.values }), positionals: Object.freeze([...parsed.positionals]) });
}

function pushValue(values, key, value) {
  const prior = values[key];
  if (prior === undefined) {
    values[key] = value;
    return;
  }
  values[key] = Array.isArray(prior) ? [...prior, String(value)] : [String(prior), String(value)];
}

/**
 * A second, simpler argv reading: no schema carrier, no option grammar declared up front. Any
 * `--flag` not named in `valuedOptions` is a boolean switch; any name in `valuedOptions` consumes
 * the next token as its string value; `--flag=value` always carries an explicit value; a bare `-`
 * or a token after `--` is a positional. Options repeated more than once collect into an array.
 * This is the CLI dispatch shape shared by the relationality faculties' own command entry
 * points, distinct from `parseJavascriptArgv`'s schema-validated request/read carriers above.
 */
export function parseArgv(argv, valuedOptions) {
  const positionals = [];
  const values = {};
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (positionalOnly || !token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      positionalOnly = true;
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const raw = token.slice(2);
    const equals = raw.indexOf("=");
    const key = equals < 0 ? raw : raw.slice(0, equals);
    if (key === "") throw new TypeError("empty option name");
    if (equals >= 0) {
      pushValue(values, key, raw.slice(equals + 1));
      continue;
    }
    if (valuedOptions.has(key)) {
      const next = argv[index + 1];
      if (next === undefined) throw new TypeError(`Option '--${key}' argument missing`);
      index += 1;
      pushValue(values, key, next);
      continue;
    }
    pushValue(values, key, true);
  }
  return Object.freeze({ positionals: Object.freeze(positionals), values: Object.freeze(values) });
}
