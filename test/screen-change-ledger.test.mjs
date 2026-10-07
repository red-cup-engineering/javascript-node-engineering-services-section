import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyChangeState, expandEntries, expandEntry, nestedPackageOwner, normalizeLedgerLine, omittedUntrackedFiles, readHeldAreas, readLedgerEntries, screenChangeLedger,
} from "../scripts/screen-change-ledger.mjs";

const HOUSE_HELD_AREAS_PATH = join(dirname(fileURLToPath(import.meta.url)), "../data/records/house-held-areas.json");

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "screen-ledger-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("kept-changed.mjs", "old\n");
  mk("unchanged.mjs", "same\n");
  mk("to-delete.mjs", "gone\n");
  mk("held/area/file.mjs", "held\n");
  mk("codex-tracked.mjs", "import { x } from \"./safe.mjs\";\n");
  mk("package-dir/a.mjs", "a\n");
  mk("package-dir/b.mjs", "b\n");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");

  writeFileSync(join(root, "kept-changed.mjs"), "new\n");
  rmSync(join(root, "to-delete.mjs"));
  mk("brand-new.mjs", "import { y } from \"./safe.mjs\";\n");
  mk("node_modules/pkg/index.mjs", "module.exports = {};\n");
  writeFileSync(join(root, "held/area/file.mjs"), "held changed\n");
  rmSync(join(root, "package-dir"), { recursive: true });
  writeFileSync(join(root, "codex-tracked.mjs"), "import { x } from \"./safe.mjs\";\nimport { z } from \"../reachin-section/thing.mjs\";\n");
  mk("codex-untracked.mjs", "import { z } from \"../reachin-section/thing.mjs\";\n");
  return { root, git };
}

const heldAreas = { areas: [{ pattern: "held/area", holder: "test-holder", reason: "test", since: "2026-09-21" }], reachInSections: ["reachin-section"] };

test("normalizeLedgerLine trims, drops blanks, strips a trailing slash, and normalizes an absolute path under root", () => {
  const root = "/repo";
  assert.equal(normalizeLedgerLine("  a/b.mjs  ", root), "a/b.mjs");
  assert.equal(normalizeLedgerLine("", root), undefined);
  assert.equal(normalizeLedgerLine("   ", root), undefined);
  assert.equal(normalizeLedgerLine("a/dir/", root), "a/dir");
  assert.equal(normalizeLedgerLine("/repo/a/b.mjs", root), "a/b.mjs");
});

test("readLedgerEntries drops blanks and duplicates, keeping order", () => {
  const { root } = makeRepo();
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "a.mjs\n\nb.mjs\na.mjs\n  \nc.mjs\n");
  assert.deepEqual(readLedgerEntries(ledgerFile, root), ["a.mjs", "b.mjs", "c.mjs"]);
});

test("classifyChangeState reports all five states", () => {
  const { root } = makeRepo();
  assert.equal(classifyChangeState("kept-changed.mjs", root), "changed");
  assert.equal(classifyChangeState("unchanged.mjs", root), "unchanged");
  assert.equal(classifyChangeState("to-delete.mjs", root), "deleted");
  assert.equal(classifyChangeState("brand-new.mjs", root), "new");
  assert.equal(classifyChangeState("does/not/exist.mjs", root), "absent-both");
});

test("expandEntry returns a file entry as itself, a directory as its disk files union its HEAD-tracked files, and an absent-both entry as itself", () => {
  const { root } = makeRepo();
  assert.deepEqual(expandEntry("kept-changed.mjs", root), ["kept-changed.mjs"]);
  assert.deepEqual(expandEntry("does/not/exist.mjs", root), ["does/not/exist.mjs"]);
  const packageFiles = expandEntry("package-dir", root).sort();
  assert.deepEqual(packageFiles, ["package-dir/a.mjs", "package-dir/b.mjs"], "the directory is gone on disk, so expansion falls back to what HEAD tracked there");
});

test("expandEntries flattens and deduplicates across entries", () => {
  const { root } = makeRepo();
  const expanded = expandEntries(["kept-changed.mjs", "package-dir", "package-dir/a.mjs"], root).sort();
  assert.deepEqual(expanded, ["kept-changed.mjs", "package-dir/a.mjs", "package-dir/b.mjs"]);
});

test("screenChangeLedger keeps real changes and drops unchanged, ignored, held, and hand-carrying paths, each with a reason", () => {
  const { root } = makeRepo();
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, [
    "kept-changed.mjs", "unchanged.mjs", "to-delete.mjs", "brand-new.mjs", "node_modules/pkg/index.mjs",
    "held/area/file.mjs", "package-dir", "codex-tracked.mjs", "codex-untracked.mjs", "does/not/exist.mjs",
  ].join("\n"));
  const { kept, dropped, summary } = screenChangeLedger({ ledgerFile, root, allow: [], heldAreas });
  assert.deepEqual(kept.sort(), ["brand-new.mjs", "kept-changed.mjs", "package-dir/a.mjs", "package-dir/b.mjs", "to-delete.mjs"]);
  const reasonOf = (path) => dropped.find((d) => d.path === path)?.reason;
  assert.equal(reasonOf("unchanged.mjs"), "unchanged");
  assert.equal(reasonOf("does/not/exist.mjs"), "unchanged");
  assert.equal(reasonOf("node_modules/pkg/index.mjs"), "ignored");
  assert.equal(reasonOf("held/area/file.mjs"), "held:test-holder:held/area");
  assert.equal(reasonOf("codex-tracked.mjs"), "codex");
  assert.equal(reasonOf("codex-untracked.mjs"), "codex");
  assert.equal(summary.input, 10);
  assert.equal(summary.kept, 5);
  assert.equal(summary.held, 1);
  assert.equal(summary.codex, 2);
  assert.equal(summary.ignored, 1);
  assert.equal(summary.unchanged, 2);
});

test("carriesReachInHunk (via screenChangeLedger) masks a comment holding a reach-in-shaped import line before scanning, in both a changed tracked file and a brand-new untracked one", () => {
  const { root, git } = makeRepo();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };

  // Tracked, changed: the only line added is a comment shaped like a reach-in import. The
  // diff-line scan SPECIFIER replaced used to test `from ["']` against the raw added line, which a
  // "// import ... from ..." comment still satisfies; masked first, the comment contributes no
  // specifier at all, so nothing new reaches in and the file is kept.
  mk("codex-tracked-comment-only.mjs", "import { x } from \"./safe.mjs\";\n");
  git("add", "-A");
  git("commit", "-q", "-m", "add codex-tracked-comment-only.mjs with a safe import");
  writeFileSync(join(root, "codex-tracked-comment-only.mjs"), "import { x } from \"./safe.mjs\";\n// import { z } from \"../reachin-section/thing.mjs\"; (doc example only)\n");

  // Untracked, brand-new: SPECIFIER's dynamic-import alternative is unanchored, so it still reads
  // inside a "//" comment when the text is not masked first. The real import here is "./safe.mjs".
  mk("codex-untracked-comment.mjs", "// import(\"../reachin-section/thing.mjs\") -- doc example only\nimport { safe } from \"./safe.mjs\";\n");

  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "codex-tracked-comment-only.mjs\ncodex-untracked-comment.mjs\n");
  const { kept, dropped } = screenChangeLedger({ ledgerFile, root, allow: [], heldAreas });
  assert.deepEqual(kept.sort(), ["codex-tracked-comment-only.mjs", "codex-untracked-comment.mjs"], "the reach-in text lives only in a comment in each file; the real imports beside it are not held, so both are kept");
  assert.deepEqual(dropped, []);
});

test("an --allow regex releases a held path for the run", () => {
  const { root } = makeRepo();
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "held/area/file.mjs\n");
  const held = screenChangeLedger({ ledgerFile, root, allow: [], heldAreas });
  assert.deepEqual(held.kept, []);
  const released = screenChangeLedger({ ledgerFile, root, allow: ["held/area"], heldAreas });
  assert.deepEqual(released.kept, ["held/area/file.mjs"]);
});

test("the CLI prints kept paths on stdout and a JSON summary plus drop reasons on stderr, exiting 0", () => {
  const { root } = makeRepo();
  const ledgerFile = join(root, "ledger.txt");
  writeFileSync(ledgerFile, "kept-changed.mjs\nunchanged.mjs\n");
  const scriptPath = fileURLToPath(new URL("../scripts/screen-change-ledger.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, "--ledger", ledgerFile, "--root", root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "kept-changed.mjs\n");
  const [summaryLine, ...rest] = result.stderr.trim().split("\n");
  assert.deepEqual(JSON.parse(summaryLine), { input: 2, kept: 1, unchanged: 1, held: 0, codex: 0, ignored: 0, expanded: 2 });
  assert.equal(rest[0], "unchanged: unchanged.mjs");
});

test("omittedUntrackedFiles names an untracked source file the ledger left out, with the tracked files under its package that already name it by basename, and ignores an untracked file the ledger does cover or that is not a source extension", () => {
  const { root, git } = makeRepo();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  // package.json (tracked) already names "helper.mjs" in a scripts entry, but nobody ever `git add`ed it.
  mk("package-dir/package.json", JSON.stringify({ scripts: { build: "node helper.mjs" } }));
  git("add", "-A");
  git("commit", "-q", "-m", "add package.json naming a helper that was never added");
  mk("package-dir/helper.mjs", "export const helper = 1;\n"); // untracked, referenced by basename above
  mk("package-dir/orphan.mjs", "export const orphan = 1;\n"); // untracked, referenced by nothing
  mk("package-dir/ledgered.mjs", "export const ledgered = 1;\n"); // untracked, but the ledger names it
  mk("package-dir/notes.txt", "not a source file\n"); // untracked, wrong extension, ignored regardless

  const omitted = omittedUntrackedFiles({ root, packages: ["package-dir"], ledgerPaths: ["package-dir/ledgered.mjs"] });
  const byPath = Object.fromEntries(omitted.map((entry) => [entry.path, entry]));
  assert.deepEqual(byPath["package-dir/helper.mjs"], { package: "package-dir", path: "package-dir/helper.mjs", importedBy: ["package-dir/package.json"] });
  assert.deepEqual(byPath["package-dir/orphan.mjs"], { package: "package-dir", path: "package-dir/orphan.mjs", importedBy: [] });
  assert.equal(byPath["package-dir/ledgered.mjs"], undefined, "the ledger already names it, so it is not omitted");
  assert.equal(byPath["package-dir/notes.txt"], undefined, "not a .mjs/.cjs/.js/.json source file");
});

test("nestedPackageOwner finds the deepest directory under a package that has its own package.json, and undefined when nothing between the path and the package does", () => {
  const { root } = makeRepo();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  mk("section/package.json", JSON.stringify({}));
  mk("section/nested/package.json", JSON.stringify({}));
  mk("section/nested/deep/package.json", JSON.stringify({}));
  assert.equal(nestedPackageOwner("section/nested/file.mjs", "section", root), "section/nested");
  assert.equal(nestedPackageOwner("section/nested/deep/file.mjs", "section", root), "section/nested/deep", "the deepest package wins");
  assert.equal(nestedPackageOwner("section/file.mjs", "section", root), undefined, "directly under the package itself, with no intervening package.json");
  assert.equal(nestedPackageOwner("section/plain/file.mjs", "section", root), undefined, "a plain subdirectory with no package.json of its own");
});

test("omittedUntrackedFiles excludes an untracked path matching heldAreas, and an untracked path that belongs to a nested package unless that nested package is itself one of the ledger's owning packages", () => {
  const { root, git } = makeRepo();
  const mk = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  // A ledger that only edits section/package.json "owns" section, but must not be blamed for
  // another hand's untracked work sitting in a held sub-area, nor for a nested package's own
  // untracked files — those are that nested package's business, not this ledger's, unless the
  // ledger also owns that nested package.
  mk("section/package.json", JSON.stringify({}));
  git("add", "-A");
  git("commit", "-q", "-m", "add section package.json");
  mk("section/held-area/ghost.mjs", "export const ghost = 1;\n"); // untracked, sits in a held area
  mk("section/nested-pkg/package.json", JSON.stringify({})); // untracked nested package.json itself
  mk("section/nested-pkg/src/thing.mjs", "export const thing = 1;\n"); // untracked, belongs to the nested package
  mk("section/direct.mjs", "export const direct = 1;\n"); // untracked, directly under section, nobody's nested package

  const heldAreas = { areas: [{ pattern: "section/held-area", holder: "codex", reason: "test", since: "2026-09-21" }] };

  const notOwningNested = omittedUntrackedFiles({ root, packages: ["section"], ledgerPaths: [], heldAreas });
  const pathsNotOwning = notOwningNested.map((entry) => entry.path).sort();
  assert.deepEqual(pathsNotOwning, ["section/direct.mjs"], "the held path and the whole nested package are excluded; only the file directly under section remains");

  // Scoped to the nested package alone (not also "section"), so each untracked file is scanned once.
  const owningNested = omittedUntrackedFiles({ root, packages: ["section/nested-pkg"], ledgerPaths: [], heldAreas });
  const pathsOwning = owningNested.map((entry) => entry.path).sort();
  assert.deepEqual(pathsOwning, ["section/nested-pkg/package.json", "section/nested-pkg/src/thing.mjs"], "once the ledger owns the nested package itself, its untracked files are reported");

  const withoutHeldAreas = omittedUntrackedFiles({ root, packages: ["section"], ledgerPaths: [] });
  assert.deepEqual(withoutHeldAreas.map((entry) => entry.path).sort(), ["section/direct.mjs", "section/held-area/ghost.mjs"], "heldAreas is optional; omitting it applies only the nested-package rule, so the held path is reported too");
});

test("the house's own held-areas record parses, and every area's pattern compiles as a RegExp", () => {
  const record = readHeldAreas(HOUSE_HELD_AREAS_PATH);
  assert.equal(record.type, "HouseHeldAreas");
  assert.ok(Array.isArray(record.areas) && record.areas.length > 0);
  for (const area of record.areas) {
    assert.equal(typeof area.pattern, "string", `${JSON.stringify(area)} has a string pattern`);
    assert.doesNotThrow(() => new RegExp(area.pattern, "u"), `pattern ${area.pattern} compiles as a RegExp`);
    assert.equal(typeof area.holder, "string");
    assert.equal(typeof area.reason, "string");
    assert.equal(typeof area.since, "string");
  }
  assert.ok(Array.isArray(record.reachInSections));
});

test("the house's held-areas record holds the Founder's in-progress l-space.561.group site, matching its site directory", () => {
  const record = readHeldAreas(HOUSE_HELD_AREAS_PATH);
  const area = record.areas.find((entry) => entry.holder === "founder");
  assert.ok(area, "a founder-held area is recorded");
  assert.match(
    "lib/emsenn/services/561-group/services/science-services-section/sites/l-space.561.group/static-site-publisher.config.mjs",
    new RegExp(area.pattern, "u"),
  );
  assert.equal(area.reason, "the Founder's in-progress site; its untracked config is imported by tracked files");
});
