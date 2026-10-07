#!/usr/bin/env node
// Runs each named package's own `node --test`, one package at a time (writers found the tree
// flaky under parallel runs), with the house resolver on NODE_OPTIONS and a ten-minute timeout per
// package, and classifies every failure: an external dependency, a phantom house import, an import
// that reaches into a held area, a missing relative file, a SyntaxError (a mismatched named export
// among them), an assertion, a broken test script, or something else. Failures
// are read from node's own TAP output (`--test-reporter=tap`), taking each failing test's YAML
// diagnostic block on its own terms rather than the terse subtest summary line, which for a
// load-time crash is just the useless placeholder "test failed". This is the house's replacement
// for a writer hand-running `node --test` package by package and eyeballing the crash dumps.
//
// What actually runs is governed by the package's own package.json "test" script (report field
// "script"): a plain `node --test ...` script has its own file arguments run, globs resolved by this
// script itself since there is no shell here to do it ("script": "used"); no script at all falls back
// to walking test/ as before ("script": "absent"); a script present but not runnable this way — a
// bare directory argument (Node 24 refuses `node --test test/` with ERR_UNSUPPORTED_DIR_IMPORT,
// unlike `node --test` with no arguments), an unresolvable glob, or a runner other than a bare `node
// --test` — still walks test/ so the real tests are counted, but adds one suite failure with cause
// "test-script:<detail>" so the broken script is never silently tolerated by this script's own,
// more permissive file-finding.
//
// `--ref <git ref>` runs each package from a read-only export of that ref instead of the working
// tree (`git archive <ref> -- <dir> | tar -x`, no worktree, no checkout), so a caller can compare a
// package's suite now against its suite at HEAD (or any other ref) without touching the working
// tree; house names still resolve through the working tree's map, which is the approximation this
// accepts. A package that does not exist at the ref reports an empty (untested) suite. Exporting
// only the package's own directory stranded a package whose test files reach a sibling section by a
// relative import: that import 404s inside the lone export, and every test using it reported as
// newly "fixed" once the working tree had the file the ref-export never got. So the export instead
// covers the smallest common ancestor of the package and every relative-import target its own .mjs
// files (walked at `ref`, not the working tree) reach outside the package — capped at
// lib/emsenn/services/561-group so one stray reach cannot force exporting most of the house — and,
// within one `runPackageSuites` call, the same (ref, ancestor) export is reused across every package
// that needs it rather than re-archived per package.
//
//   node run-package-suites.mjs --packages <dir>... [--root /home/emsenn/info] [--ref <git ref>]
//   node run-package-suites.mjs --ledger <file> [--root /home/emsenn/info] [--ref <git ref>] [--out <file>]
//
// JSON (one record per package) prints to stdout, and to --out when given; one summary line per
// package prints to stderr.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { SPECIFIER, stripCommentsAndLiterals } from "./audit-layer-imports.mjs";
import { owningPackage } from "./measure-house-tree.mjs";
import { readHeldAreas, readLedgerEntries } from "./screen-change-ledger.mjs";
import { argument } from "../src/argv.mjs";
import { discoverHousePackages } from "../src/discover-house-packages.mjs";

const HOUSE_SCOPE = /^@(red-cup-engineering|lenticule-science|561-group|emsenn|causeway-services|coesite-operations)\//u;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const CAUSE_MARKERS = /(Error:|TypeError:|AssertionError|ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module)/u;
export const EXPORT_ANCESTOR_CAP = "lib/emsenn/services/561-group";

function walkTestFiles(directory) {
  const out = [];
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walkTestFiles(path));
    else if (entry.isFile() && /\.test\.mjs$/u.test(entry.name)) out.push(path);
  }
  return out;
}

/** The package's test files: everything under test/ recursively, or (failing that) the files its own package.json "test" script names. */
export function findPackageTestFiles(packageDir) {
  const fromTestDirectory = walkTestFiles(join(packageDir, "test")).sort();
  if (fromTestDirectory.length > 0) return fromTestDirectory;
  let pkg;
  try { pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")); } catch { return []; }
  const script = pkg.scripts?.test;
  if (typeof script !== "string") return [];
  const files = new Set();
  for (const token of script.split(/\s+/u)) {
    if (!token || token.startsWith("-") || token === "node" || token === "--test") continue;
    if (token.includes("*")) {
      const starAt = token.indexOf("*");
      const directory = join(packageDir, dirname(token.slice(0, starAt + 1)));
      const suffix = token.slice(token.lastIndexOf("/") + 1).replace("*", "");
      let entries;
      try { entries = readdirSync(directory); } catch { entries = []; }
      for (const name of entries) if (name.endsWith(suffix)) files.add(join(directory, name));
    } else if (existsSync(join(packageDir, token))) files.add(join(packageDir, token));
  }
  return [...files].sort();
}

const TEST_SCRIPT_SHELL = /[;&|`\n\r]|\$\(/u;

/** A token wrapped in a single matching pair of quotes (the quoting a script author uses to keep a shell from expanding "**" itself) with those quotes removed; any other token is returned unchanged. */
function unquoteToken(token) {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return token.slice(1, -1);
  }
  return token;
}

/**
 * Every path under `baseDir` matching a glob pattern's "/"-split `segments`: a literal segment must
 * name a real directory (or, as the last segment, a real file) exactly; "**" matches zero or more
 * intervening directories, at any depth; and a segment holding one "*" matches any entry at that one
 * level sharing its fixed prefix and suffix. This is the same shape of pattern `node --test` itself
 * accepts as a bare CLI argument (a package.json test script's "test/**\/*.test.mjs", say) — resolved
 * here instead of by a shell, since there is none.
 */
function matchGlobPattern(baseDir, segments) {
  if (segments.length === 0) return existsSync(baseDir) ? [baseDir] : [];
  const [head, ...rest] = segments;
  if (head === "**") {
    let entries;
    try { entries = readdirSync(baseDir, { withFileTypes: true }); } catch { entries = []; }
    const deeper = entries.filter((entry) => entry.isDirectory()).flatMap((entry) => matchGlobPattern(join(baseDir, entry.name), segments));
    return [...matchGlobPattern(baseDir, rest), ...deeper];
  }
  if (!head.includes("*")) {
    return rest.length === 0
      ? (existsSync(join(baseDir, head)) ? [join(baseDir, head)] : [])
      : matchGlobPattern(join(baseDir, head), rest);
  }
  const starAt = head.indexOf("*");
  const prefix = head.slice(0, starAt);
  const suffix = head.slice(starAt + 1);
  let entries;
  try { entries = readdirSync(baseDir, { withFileTypes: true }); } catch { entries = []; }
  const matches = entries.filter((entry) => entry.name.startsWith(prefix) && entry.name.endsWith(suffix) && entry.name.length >= prefix.length + suffix.length);
  return rest.length === 0
    ? matches.map((entry) => join(baseDir, entry.name))
    : matches.filter((entry) => entry.isDirectory()).flatMap((entry) => matchGlobPattern(join(baseDir, entry.name), rest));
}

/**
 * Extracts the file arguments a package.json "test" script would hand `node --test` — resolving any
 * "*"/"**" glob ourselves (see matchGlobPattern), since there is no shell here to expand one, and
 * unquoting a token a script author wrapped in quotes to keep a shell from touching it — without ever
 * running anything: {ok: true, files} when the script is a plain `node --test ...` invocation whose
 * every file argument resolves to at least one real file, or {ok: false, detail} when it is composed
 * with shell syntax, names a runner other than a bare `node --test` (an external runner: vitest,
 * jest, npm run-script, ...), a glob matches nothing (an unresolvable glob), or a plain argument names
 * a directory rather than a file (a directory argument — the exact shape Node 24's test runner refuses
 * with ERR_UNSUPPORTED_DIR_IMPORT rather than walking, unlike `node --test` with no arguments at
 * all). runPackageSuite runs `ok: true`'s files as the package's real test run and reports a
 * `test-script:<detail>` suite failure for `ok: false`, so a script broken in one of these ways is
 * caught even though this repository's own file-finding (findPackageTestFiles) would have tolerated
 * it by walking test/ itself.
 */
export function resolveTestScriptArgs(packageDir, command) {
  const trimmed = command.trim();
  if (TEST_SCRIPT_SHELL.test(trimmed)) return { ok: false, detail: `shell-composed test script: ${trimmed}` };
  const tokens = trimmed.split(/\s+/u).filter(Boolean).map(unquoteToken);
  if (tokens[0] !== "node" || !tokens.includes("--test")) return { ok: false, detail: `external test runner: ${trimmed}` };
  const files = [];
  for (const token of tokens.slice(1)) {
    if (token === "--test" || token.startsWith("-")) continue; // a flag, not a file argument
    if (token.includes("*")) {
      const matches = matchGlobPattern(packageDir, token.split("/")).sort();
      if (matches.length === 0) return { ok: false, detail: `unresolvable glob in test script: ${token}` };
      files.push(...matches);
      continue;
    }
    const resolved = join(packageDir, token);
    if (existsSync(resolved) && statSync(resolved).isDirectory()) return { ok: false, detail: `directory argument in test script: ${token}` };
    files.push(resolved);
  }
  if (files.length === 0) return { ok: false, detail: `test script names no files: ${trimmed}` };
  return { ok: true, files };
}

/** Reads the aggregate `# tests / pass / fail / skipped` counters node's TAP reporter prints at the end of a run. */
export function parseNodeTestSummary(output) {
  const read = (label) => {
    const matches = [...output.matchAll(new RegExp(`^(?:ℹ|#)\\s*${label}\\s+(\\d+)`, "gmu"))];
    return matches.length ? Number(matches.at(-1)[1]) : 0;
  };
  return { tests: read("tests"), pass: read("pass"), fail: read("fail"), skipped: read("skipped") };
}

// A load-time crash (the whole file fails to import) prints Node's own uncaught-exception dump as
// plain text before the TAP output; under --test-reporter=tap every line of it is a "# "-prefixed
// TAP comment. The dump names whatever file actually wrote the bad import, which for a transitive
// dependency is not the crashed test file itself, so it cannot be looked up by that file's path;
// instead this returns each crash's stream position, and the caller pairs it with the very next
// failing test's diagnostic block (a crash dump is always immediately followed by the "not ok" line
// for the file it crashed, with nothing else in between). A mismatched named export ("does not
// provide an export named") is also a load-time crash, but Node prints it as a bare `SyntaxError:`
// line rather than the `Error [ERR_MODULE_NOT_FOUND]: Cannot find ...` shape the other alternative
// matches, and its own diagnostic block never gets more than the placeholder "error: 'test failed'"
// either — so without this second alternative it fell all the way through to cause "other".
function findCrashOccurrences(output) {
  const re = /^#?\s*(?:Error(?:\s*\[\w+\])?: (Cannot find (?:package|module) '[^']+' imported from \S+)|(SyntaxError: .+))$/gmu;
  return [...output.matchAll(re)].map((match) => ({ index: match.index, line: match[1] ?? match[2] }));
}

/** Extracts a YAML-ish field's value from one TAP diagnostic block: a quoted scalar, a `|-` block scalar, or a bare value. */
export function extractYamlField(yaml, field) {
  const quoted = new RegExp(`^ {2}${field}: (?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")\\s*$`, "mu").exec(yaml);
  if (quoted) return (quoted[1] ?? quoted[2]).replace(/\\(['"])/gu, "$1");
  const blockScalar = new RegExp(`^ {2}${field}: \\|-\\n((?: {4}.*\\n?)*)`, "mu").exec(yaml);
  if (blockScalar) return blockScalar[1].split("\n").map((line) => line.replace(/^ {4}/u, "")).join("\n").replace(/\n+$/u, "");
  const bare = new RegExp(`^ {2}${field}: (.+)$`, "mu").exec(yaml);
  return bare ? bare[1].trim() : undefined;
}

function parseTapFailureBlocks(output) {
  const re = /^not ok \d+ - (.*)\n(?: {2}---\n([\s\S]*?)\n {2}\.\.\.)?/gmu;
  return [...output.matchAll(re)].map((match) => ({ name: match[1], yaml: match[2] ?? "", index: match.index }));
}

/** Classifies one error line the way a writer reads a crash: what kind of missing or wrong import it names, that it is a SyntaxError (a mismatched named export among them), an assertion, or something else. */
export function classifyErrorLine(line, { root, heldAreas } = {}) {
  const packageMatch = /Cannot find package '([^']+)'/u.exec(line);
  if (packageMatch) return HOUSE_SCOPE.test(packageMatch[1]) ? `phantom:${packageMatch[1]}` : `external:${packageMatch[1]}`;
  const moduleMatch = /Cannot find module '([^']+)'/u.exec(line);
  if (moduleMatch) {
    const missing = moduleMatch[1];
    const relativeToRoot = root && missing.startsWith(`${root}/`) ? missing.slice(root.length + 1) : missing;
    const heldArea = heldAreas?.areas?.find((area) => new RegExp(area.pattern, "u").test(relativeToRoot));
    return heldArea ? `held:${heldArea.pattern}` : `missing-file:${relativeToRoot}`;
  }
  const syntaxMatch = /SyntaxError: (.+)/u.exec(line);
  if (syntaxMatch) return `syntax:${syntaxMatch[1]}`;
  if (/AssertionError/u.test(line) || /\bERR_ASSERTION\b/u.test(line)) return "assertion";
  return "other";
}

/** Extracts {file, cause, detail} for every failing test in one node --test --test-reporter=tap run's combined output. */
export function parseNodeTestFailures(output, { root, heldAreas }) {
  const crashes = findCrashOccurrences(output);
  const blocks = parseTapFailureBlocks(output);
  return blocks.map((block, position) => {
    const location = /^ {2}location: '(.+):(\d+):(\d+)'$/mu.exec(block.yaml);
    const file = location ? relative(root, location[1]).split("\\").join("/") : undefined;

    const causeLine = block.yaml.split("\n").find((line) => CAUSE_MARKERS.test(line))?.trim();
    if (causeLine !== undefined) {
      const errorField = extractYamlField(block.yaml, "error");
      const detail = errorField?.split("\n").find((line) => line.trim() !== "")?.trim() ?? causeLine;
      return { file, cause: classifyErrorLine(causeLine, { root, heldAreas }), detail };
    }

    // No cause line inside this block's own diagnostics (a load-time crash's block is just the
    // placeholder "error: 'test failed'"): fall back to the crash dump immediately before it, the
    // way a writer reads the transcript today — nothing else "not ok" comes between a crash and the
    // failure it caused, so the nearest preceding crash after the previous block is the right one.
    const previousBlockIndex = position > 0 ? blocks[position - 1].index : -1;
    const crash = [...crashes].reverse().find((candidate) => candidate.index > previousBlockIndex && candidate.index < block.index);
    if (crash) return { file, cause: classifyErrorLine(crash.line, { root, heldAreas }), detail: crash.line };

    const name = extractYamlField(block.yaml, "name");
    const message = (extractYamlField(block.yaml, "error") ?? "test failed").split("\n")[0];
    const synthesized = name ? `${name}: ${message}` : message;
    return { file, cause: classifyErrorLine(synthesized, { root, heldAreas }), detail: synthesized };
  });
}

function posixDirname(path) {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/** A relative specifier resolved against `fromDir` (both "/"-joined, no leading "./"), `..` popping a segment. */
function resolveRelativeSpecifier(fromDir, specifier) {
  const stack = fromDir === "" ? [] : fromDir.split("/");
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") stack.pop();
    else stack.push(segment);
  }
  return stack.join("/");
}

/** The deepest directory that is an ancestor of (or equal to) every one of `paths`. */
function commonAncestorOf(paths) {
  let common = paths[0].split("/");
  for (const path of paths.slice(1)) {
    const segments = path.split("/");
    let i = 0;
    while (i < common.length && i < segments.length && common[i] === segments[i]) i++;
    common = common.slice(0, i);
  }
  return common.join("/");
}

/**
 * The smallest directory a read-only export of `packageDir` at `ref` must cover for every relative
 * import the package's own .mjs files (source and test alike) reach to resolve too: `packageDir`
 * itself, widened to the common ancestor of every relative-import target those files reach outside
 * it — walked at `ref` via `git show`, not the working tree, so the export matches what that
 * ref actually needs — and capped at EXPORT_ANCESTOR_CAP so one reach outside the house tree cannot
 * force exporting most of it. Each file's text is masked with stripCommentsAndLiterals before
 * SPECIFIER runs over it, so a comment or string holding an import-shaped line never widens (or
 * narrows) the export. Undefined when the package does not exist at `ref`.
 */
export function packageExportAncestor(root, packageDir, ref) {
  const listing = spawnSync("git", ["ls-tree", "-r", "--name-only", ref, "--", packageDir], { cwd: root, maxBuffer: 1 << 28 });
  if (listing.status !== 0) return undefined;
  const allFiles = listing.stdout.toString("utf8").split("\n").filter(Boolean);
  if (allFiles.length === 0) return undefined;
  const externalTargets = [];
  for (const file of allFiles) {
    if (!file.endsWith(".mjs")) continue;
    const show = spawnSync("git", ["show", `${ref}:${file}`], { cwd: root, maxBuffer: 1 << 28 });
    if (show.status !== 0) continue;
    const importerDir = posixDirname(file);
    const text = stripCommentsAndLiterals(show.stdout.toString("utf8"));
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveRelativeSpecifier(importerDir, specifier);
      if (resolved === packageDir || resolved.startsWith(`${packageDir}/`)) continue; // stays inside the package
      externalTargets.push(resolved);
    }
  }
  if (externalTargets.length === 0) return packageDir;
  let ancestor = commonAncestorOf([packageDir, ...externalTargets]);
  const underCap = ancestor === EXPORT_ANCESTOR_CAP || ancestor.startsWith(`${EXPORT_ANCESTOR_CAP}/`);
  const packageUnderCap = packageDir === EXPORT_ANCESTOR_CAP || packageDir.startsWith(`${EXPORT_ANCESTOR_CAP}/`);
  if (!underCap && packageUnderCap) ancestor = EXPORT_ANCESTOR_CAP;
  return ancestor;
}

/** Exports one repository-relative directory (`git archive` piped straight into `tar -x`, read-only, no worktree, no checkout) into a fresh temp directory. */
function exportDirectoryAtRef(root, directory, ref) {
  const tempRoot = mkdtempSync(join(tmpdir(), "package-at-ref-"));
  const archive = spawnSync("git", ["archive", ref, "--", directory], { cwd: root, maxBuffer: 1 << 30 });
  if (archive.status !== 0 || !archive.stdout || archive.stdout.length === 0) { rmSync(tempRoot, { recursive: true, force: true }); return undefined; }
  const extract = spawnSync("tar", ["-x", "-C", tempRoot], { input: archive.stdout, maxBuffer: 1 << 30 });
  if (extract.status !== 0) { rmSync(tempRoot, { recursive: true, force: true }); return undefined; }
  return tempRoot;
}

/**
 * Exports the directory one package needs at `ref` for its own relative imports to resolve (see
 * packageExportAncestor) into a fresh temp directory, read-only. `cache`, when given, is a
 * `Map` keyed by `ref` + the computed ancestor directory: within one caller-supplied cache the same
 * (ref, ancestor) pair is exported once and reused by every package that needs it, rather than
 * re-archived per package; without one, this call gets its own cache, used and torn down here.
 * @returns {{dir: string, root: string, cleanup: () => void} | undefined} undefined when the directory does not exist at that ref.
 */
export function exportPackageAtRef(root, relativeDir, ref, { cache } = {}) {
  const ancestor = packageExportAncestor(root, relativeDir, ref);
  if (ancestor === undefined) return undefined;
  const ownCache = cache ?? new Map();
  const key = `${ref}\u0000${ancestor}`;
  if (!ownCache.has(key)) ownCache.set(key, exportDirectoryAtRef(root, ancestor, ref));
  const tempRoot = ownCache.get(key);
  if (tempRoot === undefined) return undefined;
  const cleanup = cache
    ? () => {} // shared across packages in this run; the owner of `cache` tears every entry down once
    : () => { for (const value of ownCache.values()) if (value) rmSync(value, { recursive: true, force: true }); };
  return { dir: join(tempRoot, relativeDir), root: tempRoot, cleanup };
}

/**
 * Runs one package's test files in a single `node --test`, ten minutes maximum, with the house
 * resolver active. `refExportCache`, when given, is shared with sibling calls from the same
 * `runPackageSuites` run (see exportPackageAtRef).
 *
 * What actually runs depends on the package's own package.json "test" script, so a broken script
 * (one `npm test` itself could not run) is caught here rather than silently tolerated by walking
 * test/ regardless of what the script says: with a plain `node --test ...` script whose file
 * arguments all resolve (see resolveTestScriptArgs), those exact files are run and the report carries
 * `script: "used"`; with no test script at all, test/ is walked as before and the report carries
 * `script: "absent"`; with a script present but not runnable this way (a directory argument, an
 * unresolvable glob, an external runner, or shell composition), the report still carries
 * `script: "used"`, test/ is walked anyway so the real tests are still counted, and one synthetic
 * failure with cause `test-script:<detail>` is added so the broken script itself does not pass
 * unnoticed.
 */
export function runPackageSuite(packageDir, { root, heldAreas, resolverImportPath, timeoutMs = DEFAULT_TIMEOUT_MS, ref, refExportCache } = {}) {
  const packageName = relative(root, packageDir).split("\\").join("/");
  let effectiveDir = packageDir;
  let effectiveRoot = root;
  let cleanup;
  if (ref) {
    const exported = exportPackageAtRef(root, packageName, ref, { cache: refExportCache });
    if (exported === undefined) return { package: packageName, pass: 0, fail: 0, skipped: 0, failures: [], script: "absent" };
    effectiveDir = exported.dir;
    effectiveRoot = exported.root;
    cleanup = exported.cleanup;
  }
  try {
    let pkg;
    try { pkg = JSON.parse(readFileSync(join(effectiveDir, "package.json"), "utf8")); } catch { pkg = {}; }
    const testScript = pkg.scripts?.test;
    let script;
    let testFiles;
    let scriptFailureDetail;
    if (typeof testScript === "string") {
      script = "used";
      const resolved = resolveTestScriptArgs(effectiveDir, testScript);
      if (resolved.ok) {
        testFiles = resolved.files;
      } else {
        scriptFailureDetail = resolved.detail;
        testFiles = walkTestFiles(join(effectiveDir, "test")).sort(); // still counted, even though the declared script could not run
      }
    } else {
      script = "absent";
      testFiles = walkTestFiles(join(effectiveDir, "test")).sort();
    }

    if (testFiles.length === 0 && scriptFailureDetail === undefined) {
      return { package: packageName, pass: 0, fail: 0, skipped: 0, failures: [], script };
    }

    let summary = { pass: 0, fail: 0, skipped: 0 };
    let failures = [];
    if (testFiles.length > 0) {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT; // a child test runner inherits this and would report to it instead of running standalone
      if (resolverImportPath) env.NODE_OPTIONS = `--import ${resolverImportPath}`;
      const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...testFiles], { cwd: effectiveDir, env, encoding: "utf8", maxBuffer: 1 << 28, timeout: timeoutMs, killSignal: "SIGKILL" });
      if (result.error?.code === "ETIMEDOUT" || (result.signal && result.error)) {
        return { package: packageName, pass: 0, fail: testFiles.length, skipped: 0, failures: [{ file: packageName, cause: "other", detail: `timed out after ${timeoutMs}ms` }], script };
      }
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      summary = parseNodeTestSummary(output);
      failures = parseNodeTestFailures(output, { root: effectiveRoot, heldAreas });
    }
    if (scriptFailureDetail !== undefined) {
      failures = [{ file: packageName, cause: `test-script:${scriptFailureDetail}`, detail: scriptFailureDetail }, ...failures];
      summary = { ...summary, fail: summary.fail + 1 };
    }
    return { package: packageName, pass: summary.pass, fail: summary.fail, skipped: summary.skipped, failures, script };
  } finally {
    if (cleanup) cleanup();
  }
}

/**
 * Runs every named package's suite in turn (never in parallel), returning one report per package in
 * the given order. When `ref` is given, every package shares one ref-export cache for this call
 * (see exportPackageAtRef) so packages needing the same ancestor export at that ref reuse it instead
 * of each re-archiving it, and every entry the cache accumulated is torn down once, here, after the
 * whole run — this is the "once per ref per run" the cache exists for.
 */
export function runPackageSuites({ packages, root, heldAreas, resolverImportPath, timeoutMs, ref } = {}) {
  const refExportCache = ref ? new Map() : undefined;
  try {
    return packages.map((packageDir) => runPackageSuite(packageDir, { root, heldAreas, resolverImportPath, timeoutMs, ref, refExportCache }));
  } finally {
    if (refExportCache) for (const tempRoot of refExportCache.values()) if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  }
}

/** The distinct packages (repository-relative directories) that own the paths in `entries`. */
export function packagesForPaths(entries, map) {
  const directories = new Set(Object.values(map.packages));
  const owners = new Set();
  for (const entry of entries) {
    const owner = directories.has(entry) ? entry : owningPackage(entry, directories);
    if (owner) owners.add(owner);
  }
  return [...owners];
}

/** The distinct packages (repository-relative directories) that own a ledger's normalized paths. */
export function packagesForLedger(ledgerFile, root, map) {
  return packagesForPaths(readLedgerEntries(ledgerFile, root), map);
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const collect = (name) => { const values = []; for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) values.push(args[i + 1]); return values; };
  const root = resolve(argument("--root", args) || process.cwd());
  const here = dirname(new URL(import.meta.url).pathname);
  const heldAreas = readHeldAreas(join(here, "../data/records/house-held-areas.json"));
  const resolverImportPath = join(here, "register-house-resolver.mjs");
  let packageDirs = collect("--packages").map((directory) => resolve(directory));
  const ledgerFile = argument("--ledger", args);
  if (packageDirs.length === 0 && ledgerFile) {
    const map = discoverHousePackages(root);
    packageDirs = packagesForLedger(ledgerFile, root, map).map((directory) => join(root, directory));
  }
  if (packageDirs.length === 0) {
    process.stderr.write("usage: run-package-suites.mjs --packages <dir>... | --ledger <file> [--root <repo>] [--ref <git ref>] [--out <file>]\n");
    process.exit(2);
  }
  const reports = runPackageSuites({ packages: packageDirs, root, heldAreas, resolverImportPath, ref: argument("--ref", args) });
  const json = `${JSON.stringify(reports, null, 2)}\n`;
  process.stdout.write(json);
  const outFile = argument("--out", args);
  if (outFile) writeFileSync(outFile, json);
  for (const report of reports) process.stderr.write(`${report.package}: pass=${report.pass} fail=${report.fail} skipped=${report.skipped} script=${report.script}\n`);
}
