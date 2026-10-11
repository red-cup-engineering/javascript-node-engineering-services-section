/**
 * Node process environment boundary reads.
 */
import path from "node:path";

/** Read the host process environment object. */
export function processEnvironment() {
    return process.env;
}
/** Read one named variable from the host process environment. */
export function processEnvValue(name, env = process.env) {
    return env[name];
}
/** Read one named process environment variable as a number, with the service fallback supplied by the caller. */
export function processEnvNumber(name, fallback, env = process.env) {
    return Number(processEnvValue(name, env) ?? fallback);
}
/** `environment` with the directory of the Node.js running this process first on PATH: an inherited
 *  PATH can find an older system node first, and a `#!/usr/bin/env node` program started from this
 *  process (pnpm, say) then runs on, or refuses, the wrong one. */
export function nodeFirstEnvironment(environment = process.env) {
    const own = path.dirname(process.execPath);
    const rest = (environment.PATH ?? "").split(path.delimiter).filter((entry) => entry !== "" && entry !== own);
    return { ...environment, PATH: [own, ...rest].join(path.delimiter) };
}
