import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { gitSync, gitTextSync, commitTreeSync, replaceInTreeSync, writeBlobSync } from "../src/git-objects.mjs";
import { candidateTransportSync, composeCandidates, nameCandidateSync, pendingCandidates } from "../src/integrate.mjs";

test("receiving composes declared multi-commit changes without importing producer ancestry", async () => {
  const repository = mkdtempSync(join(tmpdir(), "source-transformation-"));
  try {
    gitSync(repository, ["init", "--bare", "--quiet"]);
    gitSync(repository, ["config", "user.name", "Controlled producer"]);
    gitSync(repository, ["config", "user.email", "producer@example.invalid"]);
    const blob = (text, mode = "100644") => ({ mode, object: writeBlobSync(repository, text) });
    const empty = gitTextSync(repository, ["mktree"], { input: "" });
    const commonTree = replaceInTreeSync(repository, empty, { "consumer.mjs": blob("export const value = () => 1;\n") });
    const common = commitTreeSync(repository, commonTree, [], "Shared original\n");
    // Historical producer base contains machinery which current receiving source retired.
    const oldTree = replaceInTreeSync(repository, commonTree, { "retired-apparatus.mjs": blob("throw Error('must stay retired');\n") });
    const sourceBase = commitTreeSync(repository, oldTree, [common], "Historical machinery\n");
    const receivingTree = replaceInTreeSync(repository, commonTree, { "receiving-state.json": blob('{"current":true}\n'), "pnpm-lock.yaml": blob("receiver-derived\n") });
    const base = commitTreeSync(repository, receivingTree, [common], "Current receiving source\n");
    const firstTree = replaceInTreeSync(repository, oldTree, { "consumer.mjs": blob("export const value = () => 2;\n") });
    const first = commitTreeSync(repository, firstTree, [sourceBase], "First intended change\n");
    const deliveredTree = replaceInTreeSync(repository, firstTree, {
      "supplier.txt": blob("second intended change\n"),
      "binary.dat": blob(Buffer.from([0, 255, 10])),
      "executable": blob("#!/bin/sh\nexit 0\n", "100755"),
      "link": blob("supplier.txt", "120000"),
      "pnpm-lock.yaml": blob("producer-derived\n"),
    });
    const sourceCommit = commitTreeSync(repository, deliveredTree, [first], "Second intended change\n");
    let implicitTree;
    try { implicitTree = gitTextSync(repository, ["merge-tree", "--write-tree", base, sourceCommit]).split("\n")[0]; }
    catch (error) { assert.equal(error.status, 1); implicitTree = error.stdout.split("\n")[0]; }
    assert.equal(gitTextSync(repository, ["show", `${implicitTree}:retired-apparatus.mjs`]), "throw Error('must stay retired');");
    const named = nameCandidateSync({ repository, name: "controlled/source-delivery", commit: sourceCommit, sourceBase, message: "Explicit delivery scope" });
    const queueRoot = join(repository, "judgments");
    const pending = await pendingCandidates({ repository, queueRoot });
    assert.equal(pending.length, 1);
    const { head, composed, conflicts } = await composeCandidates({ repository, base, candidates: pending, derived: ["pnpm-lock.yaml"] });
    assert.equal(conflicts.length, 0);
    assert.equal(composed.length, 1);
    assert.equal(gitTextSync(repository, ["show", "-s", "--format=%P", head]), base);
    assert.equal(gitTextSync(repository, ["ls-tree", head, "retired-apparatus.mjs"]), "");
    assert.equal(gitTextSync(repository, ["show", `${head}:receiving-state.json`]), '{"current":true}');
    assert.equal(gitTextSync(repository, ["show", `${head}:supplier.txt`]), "second intended change");
    assert.deepEqual(gitSync(repository, ["show", `${head}:binary.dat`]), Buffer.from([0, 255, 10]));
    assert.match(gitTextSync(repository, ["ls-tree", head, "executable"]), /^100755 /u);
    assert.match(gitTextSync(repository, ["ls-tree", head, "link"]), /^120000 /u);
    assert.equal(gitTextSync(repository, ["show", `${head}:pnpm-lock.yaml`]), "receiver-derived");
    const consumer = join(repository, "observed-consumer.mjs");
    writeFileSync(consumer, gitSync(repository, ["show", `${head}:consumer.mjs`]));
    assert.equal((await import(pathToFileURL(consumer))).value(), 2);
    const incompatibleTree = replaceInTreeSync(repository, receivingTree, { "consumer.mjs": blob("export const value = () => 99;\n") });
    const incompatible = commitTreeSync(repository, incompatibleTree, [base], "Independent incompatible receiving change\n");
    const refused = await composeCandidates({ repository, base: incompatible, candidates: [named], derived: ["pnpm-lock.yaml"] });
    assert.equal(refused.head, incompatible);
    assert.deepEqual(refused.conflicts[0].paths, ["consumer.mjs"]);
    const transported = candidateTransportSync({ repository, candidate: named });
    const remote = await composeCandidates({ repository, base, candidates: [{ name: named.name, commit: transported }], derived: ["pnpm-lock.yaml"] });
    assert.equal(gitTextSync(repository, ["rev-parse", `${remote.head}^{tree}`]), gitTextSync(repository, ["rev-parse", `${head}^{tree}`]));
    const undeclared = await composeCandidates({ repository, base, candidates: [{ name: "controlled/legacy", commit: sourceCommit }] });
    assert.equal(undeclared.head, base);
    assert.match(undeclared.conflicts[0].reason, /producer-declared/u);
    const substituted = await composeCandidates({ repository, base, candidates: [{ ...named, commit: first }] });
    assert.equal(substituted.head, base);
    assert.match(substituted.conflicts[0].reason, /differs/u);
    assert.throws(() => nameCandidateSync({ repository, name: "controlled/ambiguous", commit: sourceCommit }), /sourceBase is required/u);
    console.log(JSON.stringify({ controlled: true, previousImplicitAncestryReintroducedRetiredCode: true, declaredMultiCommitEffectObserved: true, unrelatedReceivingStateRetained: true, producerAncestryExcluded: true, remoteTransportSameEffect: true, ambiguousOrSubstitutedSourceRefused: true, externalInferencePurchases: 0 }));
  } finally { rmSync(repository, { recursive: true, force: true }); }
});
