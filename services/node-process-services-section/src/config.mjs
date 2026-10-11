import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { processArguments } from "./entrypoint.mjs";
import { processEnvironment } from "./environment.mjs";
// @red-cup-engineering/computer-file-engineering-services-section (computer-file-engineering-services-section)
// is this house's real file-read primitive, but its readFileText is async
// (node:fs/promises) and every read below is a synchronous CLI-boundary
// config resolution that must complete before the caller's event loop does
// anything else -- forcing it async would cascade through every process
// entrypoint that calls processDataRootConfig. Using node:fs directly here
// until file-services carries a synchronous variant; recorded as a finding,
// not routed around silently.
const pathExists = existsSync;
function readFileUtf8(filePath) {
    return readFileSync(filePath, "utf8");
}
/** Resolve the canonical settlement data root for a process boundary.
 *
 *  `defaultRoot` must already be absolute (every caller derives it from
 *  {@link processPackageRoot}) — the default settlement root never depends
 *  on the invoking shell's working directory. `cwd` only interprets a
 *  user-supplied relative override (`--data-root`, an env var, or a config
 *  file's `dataRoot`), the normal CLI convention.
 *  @throws {Error} when `defaultRoot` is not absolute, or the resolved root
 *   would place `data/` at the checkout root, at `<checkout root>/data`, or
 *   anywhere inside the checkout other than a `*-services-section` or
 *   `apps/<name>` package directory. */
export function processDataRootConfig(options) {
    if (!isAbsolute(options.defaultRoot)) {
        throw new Error(`process data root default must be absolute, got ${options.defaultRoot}`);
    }
    const args = options.args ?? processArguments();
    const env = options.env ?? processEnvironment();
    const cwd = options.cwd ?? process.cwd();
    const dataRootFlag = options.dataRootFlag ?? "--data-root";
    const configFlag = options.configFlag ?? "--config";
    rejectLegacyDataRootEnv(env, options.legacyEnvNames ?? [], options.envName);
    let dataRoot = resolve(cwd, options.defaultRoot);
    let source = "default";
    const configPath = resolveConfigPath({
        args,
        env,
        cwd,
        configFlag,
        ...(options.configEnvName === undefined ? {} : { configEnvName: options.configEnvName }),
        defaultConfigPath: resolve(dataRoot, options.configFileName),
    });
    if (configPath !== undefined) {
        const configured = readDataRootConfig(configPath);
        if (configured !== undefined) {
            dataRoot = resolve(dirname(configPath), configured);
            source = "config";
        }
    }
    const envRoot = trimmed(env[options.envName]);
    if (envRoot !== undefined) {
        dataRoot = resolve(cwd, envRoot);
        source = "env";
    }
    const argvRoot = readFlagValue(args, dataRootFlag, "process data root");
    if (argvRoot.value !== undefined) {
        dataRoot = resolve(cwd, argvRoot.value);
        source = "argv";
    }
    rejectDataTierRoot(dataRoot, source);
    refuseCheckoutDataRoot(dataRoot, source);
    return Object.freeze({
        dataRoot,
        source,
        ...(configPath === undefined ? {} : { configPath }),
    });
}
/** Remove process config flags before forwarding argv to a domain dispatcher. */
export function processArgumentsWithoutConfigFlags(args, flags = ["--data-root", "--config"]) {
    const kept = [];
    for (let index = 0; index < args.length; index += 1) {
        const value = args[index];
        const flag = flags.find((candidate) => value === candidate || value.startsWith(`${candidate}=`));
        if (flag === undefined) {
            kept.push(value);
        }
        else if (value === flag) {
            index += 1;
        }
    }
    return Object.freeze(kept);
}
function resolveConfigPath(options) {
    const argvConfig = readFlagValue(options.args, options.configFlag, "process config");
    if (argvConfig.value !== undefined)
        return resolve(options.cwd, argvConfig.value);
    const envConfig = options.configEnvName === undefined ? undefined : trimmed(options.env[options.configEnvName]);
    if (envConfig !== undefined)
        return resolve(options.cwd, envConfig);
    return pathExists(options.defaultConfigPath) ? options.defaultConfigPath : undefined;
}
function readDataRootConfig(configPath) {
    let parsed;
    try {
        parsed = JSON.parse(readFileUtf8(configPath));
    }
    catch (error) {
        throw new Error(`invalid process config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`invalid process config ${configPath}: expected a JSON object`);
    }
    const dataRoot = parsed.dataRoot;
    if (dataRoot === undefined)
        return undefined;
    if (typeof dataRoot !== "string" || dataRoot.trim() === "") {
        throw new Error(`invalid process config ${configPath}: dataRoot must be a non-empty string`);
    }
    return dataRoot.trim();
}
function rejectLegacyDataRootEnv(env, legacyEnvNames, envName) {
    for (const name of legacyEnvNames) {
        if (name === envName)
            continue;
        if (trimmed(env[name]) !== undefined) {
            throw new Error(`${name} is no longer a data-root input; use ${envName}, --data-root, or the process config file`);
        }
    }
}
/** Walk upward from `startDir` for the nearest `.git` entry (directory or,
 *  for a worktree, file); `undefined` when `startDir` lies outside any git
 *  checkout — a resolved root outside a checkout (e.g. a `/tmp` test
 *  fixture, or a real production data path) is this law's non-concern. */
function gitTopLevelOf(startDir) {
    let current = resolve(startDir);
    while (true) {
        if (existsSync(resolve(current, ".git")))
            return current;
        const parent = dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
}
/** A `*-services-section` directory, or an `apps/<name>` package directory
 *  (its own parent literally named `apps`) — the two shapes the org-layering
 *  law allows a `data/` directory to live beside. */
function isServicesSectionOrAppDirectory(dir) {
    if (basename(dir).endsWith("-services-section"))
        return true;
    return basename(dirname(dir)) === "apps";
}
/** Refuse a resolved settlement root that would place `data/` inside a git
 *  checkout anywhere but a `*-services-section` or `apps/<name>` package
 *  directory — the checkout root and `<checkout root>/data` named
 *  explicitly (working-discipline: "the checkout is not a runtime"). */
function refuseCheckoutDataRoot(dataRoot, source) {
    const checkoutRoot = gitTopLevelOf(dataRoot);
    if (checkoutRoot === undefined)
        return;
    if (dataRoot === checkoutRoot) {
        throw new Error(`process data root from ${source} is the checkout root (${checkoutRoot}); `
            + "the checkout must carry no data/ — pass a *-services-section or apps/<name> package directory instead");
    }
    if (dataRoot === resolve(checkoutRoot, "data")) {
        throw new Error(`process data root from ${source} is <checkout root>/data (${dataRoot}); `
            + "pass the settlement root this would itself be the data/ subdirectory of, never the data directory itself");
    }
    const dataDir = resolve(dataRoot, "data");
    if (basename(dataDir) !== "data" || !isServicesSectionOrAppDirectory(dataRoot)) {
        throw new Error(`process data root from ${source} (${dataRoot}) is not a *-services-section or apps/<name> package `
            + `directory inside the checkout (${checkoutRoot}); refusing to create ${dataDir}`);
    }
}
function rejectDataTierRoot(dataRoot, source) {
    if (basename(dataRoot) !== "data")
        return;
    const hasDataTierShape = pathExists(resolve(dataRoot, "logs")) ||
        pathExists(resolve(dataRoot, "state")) ||
        pathExists(resolve(dataRoot, "records")) ||
        pathExists(resolve(dataRoot, "record"));
    if (!hasDataTierShape)
        return;
    throw new Error(`process data root from ${source} names a data tier (${dataRoot}); pass the settlement root instead (${dirname(dataRoot)})`);
}
function readFlagValue(args, flag, label) {
    let found = false;
    let value;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === flag) {
            if (found)
                throw new Error(`${label}: ${flag} must be supplied once`);
            const next = trimmed(args[index + 1]);
            if (next === undefined || next.startsWith("--"))
                throw new Error(`${label}: ${flag} requires a non-empty value`);
            found = true;
            value = next;
            index += 1;
        }
        else if (arg.startsWith(`${flag}=`)) {
            if (found)
                throw new Error(`${label}: ${flag} must be supplied once`);
            const next = trimmed(arg.slice(flag.length + 1));
            if (next === undefined)
                throw new Error(`${label}: ${flag} requires a non-empty value`);
            found = true;
            value = next;
        }
    }
    return Object.freeze({ found, ...(value === undefined ? {} : { value }) });
}
function trimmed(value) {
    const text = value?.trim();
    return text === undefined || text === "" ? undefined : text;
}
