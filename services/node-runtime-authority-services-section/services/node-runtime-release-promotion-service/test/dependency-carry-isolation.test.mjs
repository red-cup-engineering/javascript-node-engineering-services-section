import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { carryDependencies } from "../src/dependency-reuse.mjs";

test("carried node_modules share the package store but not the metadata an install rewrites", async () => {
  const root = mkdtempSync(join(tmpdir(), "carry-isolation-"));
  try {
    const from = join(root, "from"), to = join(root, "to");
    mkdirSync(join(from, "node_modules", ".pnpm", "left-pad@1.0.0", "node_modules", "left-pad"), { recursive: true });
    writeFileSync(join(from, "node_modules", ".modules.yaml"), "running\n");
    writeFileSync(join(from, "node_modules", ".pnpm", "lock.yaml"), "running\n");
    writeFileSync(join(from, "node_modules", ".pnpm", "left-pad@1.0.0", "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
    mkdirSync(to);
    await carryDependencies({ from, to, method: "hardlink" });
    const inode = (path) => statSync(path).ino;
    // The store is shared (when the method links), the metadata never is.
    assert.notEqual(inode(join(to, "node_modules", ".modules.yaml")), inode(join(from, "node_modules", ".modules.yaml")));
    assert.notEqual(inode(join(to, "node_modules", ".pnpm", "lock.yaml")), inode(join(from, "node_modules", ".pnpm", "lock.yaml")));
    // A later install's write lands only in its own release.
    writeFileSync(join(to, "node_modules", ".modules.yaml"), "later\n");
    assert.equal(readFileSync(join(from, "node_modules", ".modules.yaml"), "utf8"), "running\n");
    assert.equal(readFileSync(join(to, "node_modules", ".pnpm", "left-pad@1.0.0", "node_modules", "left-pad", "index.js"), "utf8"), "module.exports = 1;\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
