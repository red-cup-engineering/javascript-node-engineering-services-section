import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { nodeJobsOf, readNodeJobDeclarations } from "../src/node-job.mjs";

const job = (id, extra = {}) => ({ id, summary: `the ${id} job`, directory: "lib", node: ["run.mjs"], maxSeconds: 60, ...extra });

async function deployment(files) {
  const root = await mkdtemp(join(tmpdir(), "node-job-"));
  await mkdir(join(root, "deploy/jobs"), { recursive: true });
  await writeFile(join(root, "deploy/release.json"), JSON.stringify({ host: "local", releaseRoot: ".local/state/x", unit: { name: "x.service" } }));
  for (const [name, value] of Object.entries(files)) await writeFile(join(root, "deploy/jobs", name), JSON.stringify(value));
  return root;
}

test("a directory of well-named files reads as one array sorted by id", async () => {
  const root = await deployment({ "b-job.json": job("b-job"), "a-job.json": job("a-job", { everySeconds: 3600, firstDueAt: "2026-10-03T00:00:00Z" }) });
  try {
    assert.deepEqual(readNodeJobDeclarations(join(root, "deploy/jobs")).map(({ id }) => id), ["a-job", "b-job"]);
    const declared = nodeJobsOf(root);
    assert.deepEqual([...declared.jobs.keys()], ["a-job", "b-job"]);
    assert.equal(declared.jobs.get("a-job").trigger.everySeconds, 3600);
  } finally { await rm(root, { recursive: true }); }
});

test("a file whose name and id differ is refused", async () => {
  const root = await deployment({ "a-job.json": job("other") });
  try { assert.throws(() => readNodeJobDeclarations(join(root, "deploy/jobs")), /differs from its file name/); } finally { await rm(root, { recursive: true }); }
});

test("a second file declaring an id already declared is refused", async () => {
  const root = await deployment({ "a-job.json": job("a-job"), "b-job.json": job("a-job") });
  try { assert.throws(() => readNodeJobDeclarations(join(root, "deploy/jobs")), /duplicate job "a-job"/); } finally { await rm(root, { recursive: true }); }
});

test("a deployment with no jobs directory declares none", async () => {
  const root = await mkdtemp(join(tmpdir(), "node-job-"));
  try { assert.equal(nodeJobsOf(root), undefined); } finally { await rm(root, { recursive: true }); }
});
