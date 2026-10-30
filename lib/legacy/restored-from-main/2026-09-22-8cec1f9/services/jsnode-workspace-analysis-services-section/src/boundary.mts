/**
 * boundary — the package-boundary audit, owned by jsnode-engineering-cli.
 *
 * Every workspace package ships its built `dist/` and keeps `src/` to itself:
 * `main`/`types`/`exports`/`bin` must resolve to `./dist/*.mjs` and `*.d.ts`,
 * never to `./src/` or a raw `.ts`/`.mts`; `src/` must hold no compiled `.ts`;
 * `dist/` must actually contain built `.mjs` and `.d.ts`. That boundary is the
 * contract that lets a consumer import a package without a TypeScript toolchain.
 *
 * This was a loose, untested script under `scripts/package-boundary/`. It now
 * lives here as a tested capability of the workspace computer: the core
 * {@link packageBoundaryFailures} is a *pure* function of already-read values
 * (manifest + the src/dist file lists), and {@link auditPackageBoundary} is the
 * thin filesystem wrapper around it. The root hook re-exports this module's
 * built `dist`, so there is one implementation, owned and covered by tests.
 *
 * Only node builtins are imported, so loading this module pulls in no workspace
 * dependency — the root hook can import it from any package's verify run.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** The already-read inputs the boundary contract is a pure function of. */
export interface PackageBoundaryInput {
  /** The parsed package.json. */
  readonly manifest: Record<string, unknown>;
  /** Paths (any form) of every file under `src/`. */
  readonly srcFiles: readonly string[];
  /** Paths (any form) of every file under `dist/`. */
  readonly distFiles: readonly string[];
}

/** Flatten an `exports` value (string | conditions object, nested) to its
 *  string targets. */
function exportTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(exportTargets);
}

/** The boundary failures of a package, as a pure function of its manifest and
 *  file lists. Empty array ⇔ the package honours the boundary. */
export function packageBoundaryFailures(input: PackageBoundaryInput): string[] {
  const { manifest, srcFiles, distFiles } = input;
  const failures: string[] = [];
  const exports = (manifest["exports"] ?? {}) as Record<string, unknown>;

  for (const [field, expected] of [
    ["main", { prefix: "./dist/", suffix: ".mjs" }],
    ["types", { prefix: "./dist/", suffix: ".d.ts" }],
  ] as const) {
    const target = manifest[field];
    if (target === undefined) continue;
    if (typeof target !== "string") {
      failures.push(`${field} must be a string when present`);
      continue;
    }
    if (target.startsWith("./src/")) failures.push(`${field} points to source target ${target}`);
    if ((target.endsWith(".ts") && !target.endsWith(".d.ts")) || target.endsWith(".mts")) {
      failures.push(`${field} points to TypeScript target ${target}`);
    }
    if (!target.startsWith(expected.prefix) || !target.endsWith(expected.suffix)) {
      failures.push(`${field} points to ${target}, expected ${expected.prefix}*${expected.suffix}`);
    }
  }

  for (const [key, value] of Object.entries(exports)) {
    if (key === "./package.json" || key.startsWith("./schema/")) continue;
    for (const target of exportTargets(value)) {
      if (target.startsWith("./src/")) failures.push(`${key} exports source target ${target}`);
      if ((target.endsWith(".ts") && !target.endsWith(".d.ts")) || target.endsWith(".mts")) {
        failures.push(`${key} exports TypeScript target ${target}`);
      }
    }
  }

  const tsFiles = srcFiles.filter((file) => file.endsWith(".ts"));
  if (tsFiles.length > 0) failures.push(`src contains .ts files: ${tsFiles.join(", ")}`);

  if (!distFiles.some((file) => file.endsWith(".mjs"))) failures.push("dist contains no .mjs files");
  if (!distFiles.some((file) => file.endsWith(".d.ts"))) failures.push("dist contains no .d.ts files");

  const bin = manifest["bin"];
  if (bin !== undefined && bin !== null && typeof bin === "object") {
    for (const [name, target] of Object.entries(bin as Record<string, unknown>)) {
      if (typeof target !== "string" || !target.startsWith("./dist/") || !target.endsWith(".mjs")) {
        failures.push(`bin ${name} points to ${String(target)}, expected ./dist/*.mjs`);
      }
    }
  }

  return failures;
}

/** The result of auditing one package directory. */
export interface PackageBoundaryResult {
  readonly name: string;
  readonly ok: boolean;
  readonly failures: readonly string[];
}

async function listFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** Read a package directory and audit its dist/src boundary. Throws when no
 *  package.json is present (the caller named a non-package). */
export async function auditPackageBoundary(packageDir: string): Promise<PackageBoundaryResult> {
  const dir = path.resolve(packageDir);
  const manifestPath = path.join(dir, "package.json");
  if (!existsSync(manifestPath)) throw new Error(`No package.json found at ${manifestPath}`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const [srcFiles, distFiles] = await Promise.all([
    listFiles(path.join(dir, "src")).then((fs) => fs.map((f) => path.relative(dir, f))),
    listFiles(path.join(dir, "dist")).then((fs) => fs.map((f) => path.relative(dir, f))),
  ]);
  const failures = packageBoundaryFailures({ manifest, srcFiles, distFiles });
  const name = typeof manifest["name"] === "string" ? (manifest["name"] as string) : dir;
  return { name, ok: failures.length === 0, failures };
}
