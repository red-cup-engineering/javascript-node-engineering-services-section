import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promoteNodeRuntimeRelease } from "../src/promote-release.mjs";

async function release(root, value) {
  const relativePath = "app/server.mjs";
  const bytes = Buffer.from(`export default ${JSON.stringify(value)};\n`);
  const hash = createHash("sha256").update(relativePath).update("\0").update(bytes).update("\0").digest("hex");
  const directory = join(root, hash);
  await mkdir(join(directory, "app"), { recursive: true });
  await writeFile(join(directory, relativePath), bytes);
  await writeFile(join(directory, "release-receipt.json"), JSON.stringify({ artifactDigest: hash }));
  return hash;
}

test("promotes and rolls back verified releases with retained receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "node-release-promotion-"));
  try {
    const releases = join(root, "releases");
    const receipts = join(root, "receipts");
    await mkdir(releases, { recursive: true });
    const first = await release(releases, "first");
    const second = await release(releases, "second");
    const initial = await promoteNodeRuntimeRelease({ releaseRoot: releases, digest: first, receiptRoot: receipts });
    const advanced = await promoteNodeRuntimeRelease({ releaseRoot: releases, digest: second, receiptRoot: receipts });
    const rolledBack = await promoteNodeRuntimeRelease({ releaseRoot: releases, digest: first, receiptRoot: receipts });
    assert.equal(await readlink(join(releases, "current")), first);
    assert.equal(await readlink(join(releases, "previous")), second);
    assert.equal(initial.fromDigest, null);
    assert.equal(advanced.fromDigest, first);
    assert.equal(rolledBack.fromDigest, second);
    assert.equal(JSON.parse(await readFile(rolledBack.receiptPath, "utf8")).toDigest, first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses a release whose bytes no longer satisfy its digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "node-release-promotion-refusal-"));
  try {
    const releases = join(root, "releases");
    await mkdir(releases, { recursive: true });
    const digest = await release(releases, "admitted");
    await writeFile(join(releases, digest, "app", "server.mjs"), "export default 'mutated';\n");
    await assert.rejects(promoteNodeRuntimeRelease({ releaseRoot: releases, digest, receiptRoot: join(root, "receipts") }), /do not satisfy/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("materializes a staged tree as a verifiable release that installing in place does not change", async () => {
  const { materializeNodeRuntimeRelease } = await import("../src/materialize-release.mjs");
  const root = await mkdtemp(join(tmpdir(), "node-release-materialization-"));
  try {
    const staged = join(root, "stage");
    const releases = join(root, "releases");
    await mkdir(join(staged, "app"), { recursive: true });
    await mkdir(releases, { recursive: true });
    await writeFile(join(staged, "app", "server.mjs"), "export default 1;\n");
    const receipt = await materializeNodeRuntimeRelease({ stagedRoot: staged, releaseRoot: releases, source: { commit: "abc" } });
    assert.equal(receipt.reused, false);
    await mkdir(join(receipt.release, "node_modules", "dep"), { recursive: true });
    await writeFile(join(receipt.release, "node_modules", "dep", "index.js"), "module.exports = 2;\n");
    const promoted = await promoteNodeRuntimeRelease({ releaseRoot: releases, digest: receipt.artifactDigest, receiptRoot: join(root, "receipts") });
    assert.equal(promoted.toDigest, receipt.artifactDigest);
    assert.equal(JSON.parse(await readFile(join(receipt.release, "release-receipt.json"), "utf8")).source.commit, "abc");
    await mkdir(join(staged, "app"), { recursive: true });
    await writeFile(join(staged, "app", "server.mjs"), "export default 1;\n");
    const again = await materializeNodeRuntimeRelease({ stagedRoot: staged, releaseRoot: releases });
    assert.equal(again.reused, true);
    assert.equal(again.artifactDigest, receipt.artifactDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("materializing bytes whose release was edited in place restores them and keeps the edit as evidence", async () => {
  const { materializeNodeRuntimeRelease } = await import("../src/materialize-release.mjs");
  const root = await mkdtemp(join(tmpdir(), "node-release-drift-"));
  try {
    const releases = join(root, "releases");
    await mkdir(releases, { recursive: true });
    const stage = async () => {
      const staged = join(root, "stage");
      await mkdir(join(staged, "app"), { recursive: true });
      await writeFile(join(staged, "app", "server.mjs"), "export default 'committed';\n");
      return staged;
    };
    const first = await materializeNodeRuntimeRelease({ stagedRoot: await stage(), releaseRoot: releases });
    await writeFile(join(first.release, "app", "server.mjs"), "export default 'hand patch';\n");
    const again = await materializeNodeRuntimeRelease({ stagedRoot: await stage(), releaseRoot: releases });
    assert.equal(again.artifactDigest, first.artifactDigest);
    assert.equal(again.reused, false);
    assert.equal(await readFile(join(again.release, "app", "server.mjs"), "utf8"), "export default 'committed';\n");
    assert.equal(await readFile(join(again.drifted, "app", "server.mjs"), "utf8"), "export default 'hand patch';\n");
    const clean = await materializeNodeRuntimeRelease({ stagedRoot: await stage(), releaseRoot: releases });
    assert.equal(clean.reused, true);
    assert.equal(clean.drifted, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("promotes a release named by its git identity on its receipt, and refuses a receipt of another commit or version", async () => {
  const root = await mkdtemp(join(tmpdir(), "node-release-identity-"));
  try {
    const releases = join(root, "releases");
    const digest = "a".repeat(64);
    await mkdir(join(releases, digest), { recursive: true });
    const receipt = { artifactDigest: digest, identityVersion: 1, source: { commit: "c0ffee" }, derived: ["gen/x.mjs"] };
    await writeFile(join(releases, digest, "release-receipt.json"), JSON.stringify(receipt));
    const receipts = join(root, "receipts");
    // No bytes are read: the release holds none of the files, and still promotes.
    const promoted = await promoteNodeRuntimeRelease({ releaseRoot: releases, digest, receiptRoot: receipts, commit: "c0ffee", derived: ["gen/x.mjs"] });
    assert.equal(promoted.identityVersion, 1);
    assert.equal(promoted.observedDigest, null);
    await assert.rejects(promoteNodeRuntimeRelease({ releaseRoot: releases, digest, receiptRoot: receipts, commit: "other" }), /another commit/u);
    await assert.rejects(promoteNodeRuntimeRelease({ releaseRoot: releases, digest, receiptRoot: receipts, derived: [] }), /derives other paths/u);
    await writeFile(join(releases, digest, "release-receipt.json"), JSON.stringify({ ...receipt, identityVersion: 99 }));
    await assert.rejects(promoteNodeRuntimeRelease({ releaseRoot: releases, digest, receiptRoot: receipts }), /identity version 99/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
