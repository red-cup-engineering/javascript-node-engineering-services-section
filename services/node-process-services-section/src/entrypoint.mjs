import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Node argv and direct-entrypoint process boundary reads.
 */
const realOrResolved = (file) => {
    try {
        return realpathSync(file);
    }
    catch {
        return resolve(file);
    }
};
/**
 * STD-ENTRY, the house entry-point guard: true when the module at `importMetaUrl` is the script Node was
 * asked to run (`argv1`, by default `process.argv[1]`). Both sides are compared by their real paths, because
 * Node resolves `import.meta.url` to the real path while `argv[1]` keeps every symbolic link it was given: a
 * script run as `node_modules/@scope/pkg/x.mjs` (a pnpm link), or under a symlinked top-level directory, is
 * still the entry. A module imported by another one is not. Never throws: a missing `argv1`, a URL that is not
 * a file, or a path that does not exist answers false or compares unresolved.
 *
 *     if (isEntryModule(import.meta.url)) main();
 */
export function isEntryModule(importMetaUrl, argv1 = process.argv[1]) {
    if (typeof argv1 !== "string" || argv1 === "")
        return false;
    let modulePath;
    try {
        modulePath = fileURLToPath(importMetaUrl);
    }
    catch {
        return false;
    }
    return realOrResolved(modulePath) === realOrResolved(argv1);
}
/** True when `moduleUrl` names the script Node was asked to execute (`isEntryModule` with an explicit argv slot). */
export function isDirectEntrypoint(moduleUrl, argvPath) {
    return argvPath !== undefined && isEntryModule(moduleUrl, argvPath);
}
/** Read service arguments after Node's executable and script slots. */
export function processArguments(argv = process.argv) {
    return Object.freeze(argv.slice(2));
}
/** Resolve this package root from a source or built service entrypoint URL. */
export function processPackageRoot(moduleUrl) {
    let current = dirname(fileURLToPath(moduleUrl));
    while (true) {
        if (existsSync(resolve(current, "package.json")))
            return current;
        const parent = dirname(current);
        if (parent === current) {
            const serviceRoot = resolve(dirname(fileURLToPath(moduleUrl)), "../..");
            return basename(serviceRoot) === "dist" ? resolve(serviceRoot, "..") : serviceRoot;
        }
        current = parent;
    }
}
/** Read Node's script argument slot for direct-entrypoint checks. */
export function processEntrypointArgument(argv = process.argv) {
    return argv[1];
}
