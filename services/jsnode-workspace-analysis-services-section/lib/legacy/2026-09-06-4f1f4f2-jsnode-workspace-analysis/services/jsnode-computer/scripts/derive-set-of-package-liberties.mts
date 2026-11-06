#!/usr/bin/env node
/**
 * derive-set-of-package-liberties — CLI: the workspace's package graph read
 * as a board of liberties, one readout per package.
 *
 *   derive-set-of-package-liberties --root <dir> [--registry <url>]
 *     [--offline] [--concurrency <n>] [--exclude <name-pattern>]...
 *
 * --root is required: the tree to walk. `discoverWorkspace` already excludes
 * node_modules, dist, and any `legacy` directory (so `lib/legacy` is dropped
 * without a special case); --exclude (repeatable, exact name or `*`
 * wildcard) drops further packages the same way the jsnode-computer CLI does.
 *
 * --registry defaults to https://registry.561.group, the house canonical
 * registry (CLAUDE.md). For each package, `npm view <name> version --json`
 * against that registry decides `published`: a clean result is `true`, a
 * clean `E404` is a confirmed `false`, and anything else (timeout, network,
 * an unrecognized shape) is `null` (unknown) — never guessed as `false`, so a
 * slow or unreachable registry cannot manufacture a false "captured".
 * --offline skips every check outright (every `published` is `null`).
 * `--concurrency` (default 8) bounds how many `npm view` calls run at once.
 *
 * Reuses jsnode-computer's own manifest walk and dependency graph
 * (`discoverWorkspace`, `derivePackageLiberties` in ../src/package-liberties.mts)
 * rather than re-deriving them; this file is only the registry probe and the
 * CLI shell around that pure computation. Requires the package already built
 * (`npm run build`) — it imports itself by name, resolved to `dist/`.
 *
 * Prints the PackageLibertiesReadout as JSON to stdout. Exit 0 always (the
 * readout itself is the deliverable, not a pass/fail gate); a hard failure to
 * even discover the workspace exits 1 with an error on stderr.
 */
import process from "node:process";
import path from "node:path";
import { execFile } from "node:child_process";
import { discoverWorkspace, derivePackageLiberties } from "@red-cup-engineering/jsnode-computer";

const DEFAULT_REGISTRY = "https://registry.561.group";
const DEFAULT_CONCURRENCY = 8;
const NPM_VIEW_TIMEOUT_MS = 15_000;

interface ParsedArgs {
  readonly root?: string;
  readonly registry: string;
  readonly offline: boolean;
  readonly concurrency: number;
  readonly exclude: readonly string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let root: string | undefined;
  let registry = DEFAULT_REGISTRY;
  let offline = false;
  let concurrency = DEFAULT_CONCURRENCY;
  const exclude: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") root = argv[++i];
    else if (arg === "--registry") registry = argv[++i] ?? registry;
    else if (arg === "--offline") offline = true;
    else if (arg === "--concurrency") concurrency = Number(argv[++i] ?? concurrency) || concurrency;
    else if (arg === "--exclude") { const v = argv[++i]; if (v !== undefined) exclude.push(v); }
    else throw new Error(`unrecognized argument: ${arg}`);
  }
  return { root, registry, offline, concurrency, exclude };
}

/** Run `npm view <name> version --json` against `registry`. Resolves `true`
 *  (published), `false` (a clean E404 — confirmed absent), or `null`
 *  (anything else: timeout, network failure, an unparsed shape). Never
 *  throws. */
function checkRegistryPublished(name: string, registry: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    execFile(
      "npm",
      ["view", name, "version", "--registry", registry, "--json"],
      { timeout: NPM_VIEW_TIMEOUT_MS },
      (err, stdout) => {
        if (!err) {
          resolve(true);
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed?.error?.code === "E404" ? false : null);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

/** A bounded-concurrency memoizing publish checker: each package name is
 *  queried at most once, and no more than `concurrency` `npm view` calls run
 *  at a time. */
function publishChecker(registry: string, concurrency: number, offline: boolean): (name: string) => Promise<boolean | null> {
  if (offline) return async () => null;
  const cache = new Map<string, Promise<boolean | null>>();
  let active = 0;
  const queue: (() => void)[] = [];
  const runNext = (): void => {
    const next = queue.shift();
    if (next !== undefined) next();
  };
  return (name) => {
    const cached = cache.get(name);
    if (cached !== undefined) return cached;
    const promise = new Promise<boolean | null>((resolve) => {
      const run = (): void => {
        active++;
        checkRegistryPublished(name, registry).then((result) => {
          active--;
          runNext();
          resolve(result);
        });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
    cache.set(name, promise);
    return promise;
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.root === undefined) {
    process.stderr.write("usage: derive-set-of-package-liberties --root <dir> [--registry <url>] [--offline] [--concurrency <n>] [--exclude <name-pattern>]...\n");
    process.exitCode = 2;
    return;
  }
  const root = path.resolve(args.root);
  const workspace = await discoverWorkspace(root, { exclude: args.exclude });
  const isPublished = publishChecker(args.registry, args.concurrency, args.offline);
  const readout = await derivePackageLiberties(workspace, isPublished, { offline: args.offline });
  process.stdout.write(`${JSON.stringify(readout, null, 2)}\n`);
}

const invokedDirectly = (() => {
  try {
    return new URL(import.meta.url).pathname === path.resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}

export { parseArgs, checkRegistryPublished, publishChecker, main };
