#!/usr/bin/env node
/**
 * cli — bind the documentation cycle to the filesystem, a provider, and stdout.
 *
 * `document <pkg> --symbol <name>` reads the package surface, runs one
 * documentation cycle for the named symbol over a keyed provider, prints the
 * rendered entry and the gate verdict, and (with --write) projects the entry
 * into <pkg>/dev/docs/reference/ and appends the run to the package's trace.
 *
 * Time and the provider enter as values: the clock is read once here, the
 * provider is chosen from the keyed environment.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { makeAsk, pickProvider } from "@emsenn/content-computer/ask";

import { readPackageSurface } from "./surface.mts";
import { documentSymbol, documentPackage, documentReadme } from "./cycle.mts";
import type { SymbolDocResult } from "./cycle.mts";
import { auditPackageDocs } from "./audit.mts";

const STRATA = ["lib", "apps", "services", "sites", "ops"] as const;

function workspaceRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

/** Resolve a package argument to its directory. Accepts a path, a directory
 *  basename, or a declared package name across the workspace strata. */
function resolvePackageDir(root: string, pkg: string): string {
  const asPath = path.resolve(pkg);
  if (existsSync(path.join(asPath, "package.json"))) return asPath;
  for (const stratum of STRATA) {
    const base = path.join(root, stratum);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      const manifestPath = path.join(dir, "package.json");
      if (!existsSync(manifestPath)) continue;
      if (entry.name === pkg) return dir;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string };
        if (manifest.name === pkg) return dir;
      } catch {
        continue;
      }
    }
  }
  throw new Error(`cannot resolve package "${pkg}" — not a directory and no workspace package by that name`);
}

interface ParsedArgs {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { command: positionals[0] ?? "", positionals: positionals.slice(1), flags };
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function gateLine(result: SymbolDocResult): string {
  return result.gates.map((g) => `${g.charge === "pass" ? "✔" : "✗"} ${g.gate}`).join("  ");
}

/** Choose a keyed provider and close over the ask morphism, or report the
 *  absence and return null. Shared by every command that calls the model. */
function configureAsk(args: ParsedArgs): { ask: (prompt: string) => Promise<string>; provider: string } | null {
  const provider = typeof args.flags["provider"] === "string"
    ? args.flags["provider"]
    : pickProvider(["nim", "groq"], { env: process.env });
  if (provider === null) {
    process.stderr.write("no keyed provider: set NVIDIA_API_KEY (nim) or GROQ_API_KEY (groq)\n");
    return null;
  }
  const ask = makeAsk({
    provider,
    ...(typeof args.flags["model"] === "string" ? { model: args.flags["model"] } : {}),
    temperature: 0.3,
    maxTokens: 900,
    env: process.env,
  });
  return { ask, provider };
}

function toInt(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function runDocument(args: ParsedArgs): Promise<number> {
  const pkg = args.positionals[0];
  if (pkg === undefined) {
    process.stderr.write("usage: jsnode-content-computer document <pkg> --symbol <name> [--write] [--provider nim|groq] [--model <id>]\n");
    return 2;
  }
  const root = workspaceRoot(process.cwd());
  const dir = resolvePackageDir(root, pkg);
  const surface = readPackageSurface(dir);

  const symbolName = typeof args.flags["symbol"] === "string" ? args.flags["symbol"] : undefined;
  if (symbolName === undefined) {
    // No symbol named: list the documentable surface, most load-bearing first.
    process.stdout.write(`${surface.name} — ${surface.symbols.length} exported symbols:\n`);
    for (const sym of surface.symbols) {
      process.stdout.write(`  ${sym.rank > 0 ? `(${sym.rank}) ` : ""}[${sym.kind}] ${sym.name}\n`);
    }
    process.stdout.write(`\nname one to document:  jsnode-content-computer document ${pkg} --symbol <name>\n`);
    return 0;
  }

  const configured = configureAsk(args);
  if (configured === null) return 3;
  const { ask, provider } = configured;

  const result = await documentSymbol(surface, symbolName, { ask });

  process.stdout.write(`\n${result.entry}\n\n`);
  process.stdout.write(`— ${result.shipped ? "SHIPPED" : "WITHHELD"} after ${result.attempts} call(s)\n`);
  process.stdout.write(`  ${gateLine(result)}\n`);
  for (const gate of result.gates) {
    if (gate.charge === "fail") process.stdout.write(`    ${gate.gate}: ${gate.evidence}\n`);
  }

  if (args.flags["write"] === true) {
    const refDir = path.join(dir, "dev", "docs", "reference");
    mkdirSync(refDir, { recursive: true });
    const file = path.join(refDir, `${result.symbol.name}.md`);
    writeFileSync(file, `${result.entry}\n`, "utf8");

    const planningDir = path.join(dir, "dev", "planning");
    mkdirSync(planningDir, { recursive: true });
    appendFileSync(
      path.join(planningDir, "runs.jsonl"),
      `${JSON.stringify({
        kind: "doc-symbol",
        symbol: result.symbol.name,
        shipped: result.shipped,
        attempts: result.attempts,
        gates: result.gates.map((g) => ({ gate: g.gate, charge: g.charge, evidence: g.evidence })),
        provider,
        t: todayStamp(),
      })}\n`,
      "utf8",
    );
    process.stdout.write(`  wrote ${path.relative(process.cwd(), file)}\n`);
  }
  return result.shipped ? 0 : 1;
}

async function runReference(args: ParsedArgs): Promise<number> {
  const pkg = args.positionals[0];
  if (pkg === undefined) {
    process.stderr.write("usage: jsnode-content-computer reference <pkg> [--limit N] [--write] [--provider nim|groq]\n");
    return 2;
  }
  const root = workspaceRoot(process.cwd());
  const dir = resolvePackageDir(root, pkg);
  const surface = readPackageSurface(dir);
  if (surface.symbols.length === 0) {
    process.stderr.write(`${surface.name} exports no documentable symbols (is it built / does it have src/?)\n`);
    return 1;
  }

  const configured = configureAsk(args);
  if (configured === null) return 3;
  const { ask, provider } = configured;

  const limit = toInt(args.flags["limit"]);
  const result = await documentPackage(surface, {
    ask,
    ...(limit === undefined ? {} : { limit }),
    onSymbol: (symbolResult, index, total) => {
      process.stderr.write(`  [${index + 1}/${total}] ${symbolResult.shipped ? "✔" : "✗"} ${symbolResult.symbol.name}\n`);
    },
  });

  const shippedCount = result.symbols.filter((s) => s.shipped).length;
  process.stdout.write(`\n${result.document}\n`);
  process.stderr.write(`— ${shippedCount}/${result.symbols.length} symbols cleared every gate\n`);
  if (result.skipped.length > 0) process.stderr.write(`  ${result.skipped.length} skipped past --limit: ${result.skipped.join(", ")}\n`);
  if (result.failed.length > 0) process.stderr.write(`  ${result.failed.length} unformattable, omitted: ${result.failed.map((f) => f.name).join(", ")}\n`);

  if (args.flags["write"] === true) {
    const docsDir = path.join(dir, "dev", "docs");
    mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "reference.md");
    writeFileSync(file, result.document, "utf8");
    const planningDir = path.join(dir, "dev", "planning");
    mkdirSync(planningDir, { recursive: true });
    appendFileSync(
      path.join(planningDir, "runs.jsonl"),
      `${JSON.stringify({
        kind: "doc-reference",
        documented: result.symbols.map((s) => ({ symbol: s.symbol.name, shipped: s.shipped, attempts: s.attempts })),
        skipped: result.skipped,
        provider,
        t: todayStamp(),
      })}\n`,
      "utf8",
    );
    process.stderr.write(`  wrote ${path.relative(process.cwd(), file)}\n`);
  }
  return shippedCount === result.symbols.length ? 0 : 1;
}

/** A usage snippet from the manifest's `bin`, for the README's Usage block. */
function readUsage(dir: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { name?: string; bin?: Record<string, string> | string };
    const bins = typeof manifest.bin === "string" ? [manifest.name ?? ""] : Object.keys(manifest.bin ?? {});
    return bins.length > 0 ? bins.map((b) => `${b} --help`).join("\n") : undefined;
  } catch {
    return undefined;
  }
}

async function runReadme(args: ParsedArgs): Promise<number> {
  const pkg = args.positionals[0];
  if (pkg === undefined) {
    process.stderr.write("usage: jsnode-content-computer readme <pkg> [--limit N] [--write] [--provider nim|groq]\n");
    return 2;
  }
  const root = workspaceRoot(process.cwd());
  const dir = resolvePackageDir(root, pkg);
  const surface = readPackageSurface(dir);
  if (surface.symbols.length === 0) {
    process.stderr.write(`${surface.name} exports no documentable symbols\n`);
    return 1;
  }

  const configured = configureAsk(args);
  if (configured === null) return 3;
  const { ask, provider } = configured;

  const limit = toInt(args.flags["limit"]);
  const usage = readUsage(dir);
  const result = await documentReadme(surface, {
    ask,
    ...(limit === undefined ? {} : { limit }),
    ...(usage === undefined ? {} : { usage }),
    ...(args.flags["write"] === true ? { referencePath: "dev/docs/reference.md" } : {}),
    onSymbol: (symbolResult, index, total) => {
      process.stderr.write(`  [${index + 1}/${total}] ${symbolResult.shipped ? "✔" : "✗"} ${symbolResult.symbol.name}\n`);
    },
  });

  process.stdout.write(`\n${result.readme}\n`);
  process.stderr.write(`— overview ${result.overviewShipped ? "cleared" : "WITHHELD on"} ${result.overviewGates.map((g) => `${g.charge === "pass" ? "✔" : "✗"}${g.gate}`).join(" ")}\n`);
  for (const gate of result.overviewGates) {
    if (gate.charge === "fail") process.stderr.write(`    ${gate.gate}: ${gate.evidence}\n`);
  }
  if (result.reference.failed.length > 0) process.stderr.write(`  ${result.reference.failed.length} symbol(s) unformattable, omitted from API: ${result.reference.failed.map((f) => f.name).join(", ")}\n`);

  if (args.flags["write"] === true) {
    writeFileSync(path.join(dir, "README.md"), result.readme, "utf8");
    const docsDir = path.join(dir, "dev", "docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(path.join(docsDir, "reference.md"), result.reference.document, "utf8");
    const planningDir = path.join(dir, "dev", "planning");
    mkdirSync(planningDir, { recursive: true });
    appendFileSync(
      path.join(planningDir, "runs.jsonl"),
      `${JSON.stringify({ kind: "doc-readme", overviewShipped: result.overviewShipped, symbols: result.reference.symbols.map((s) => s.symbol.name), skipped: result.reference.skipped, provider, t: todayStamp() })}\n`,
      "utf8",
    );
    process.stderr.write(`  wrote README.md and dev/docs/reference.md\n`);
  }
  return result.overviewShipped ? 0 : 1;
}

function runAudit(args: ParsedArgs): number {
  const pkg = args.positionals[0];
  if (pkg === undefined) {
    process.stderr.write("usage: jsnode-content-computer audit <pkg> [--format text|json]\n");
    return 2;
  }
  const root = workspaceRoot(process.cwd());
  const surface = readPackageSurface(resolvePackageDir(root, pkg));
  const audit = auditPackageDocs(surface);

  if (args.flags["format"] === "json") {
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`${audit.packageName} — ${audit.documented}/${audit.total} symbols documented\n`);
  for (const sym of audit.symbols) {
    process.stdout.write(`  ${sym.documented ? "✔" : "·"} ${sym.rank > 0 ? `(${sym.rank}) ` : ""}[${sym.kind}] ${sym.name}\n`);
  }
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "document":
      return runDocument(args);
    case "reference":
      return runReference(args);
    case "readme":
      return runReadme(args);
    case "audit":
      return runAudit(args);
    default:
      process.stderr.write([
        "usage:",
        "  jsnode-content-computer document <pkg> --symbol <name> [--write]",
        "  jsnode-content-computer reference <pkg> [--limit N] [--write]",
        "  jsnode-content-computer readme <pkg> [--limit N] [--write]",
        "  jsnode-content-computer audit <pkg> [--format text|json]",
        "",
        "common flags: --provider nim|groq, --model <id>",
      ].join("\n") + "\n");
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
