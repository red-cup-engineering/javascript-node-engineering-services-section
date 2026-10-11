import assert from "node:assert/strict";
import test from "node:test";
import { prunedSnapshots, retainedSnapshots, snapshotInstantOf } from "../src/snapshot-retention.mjs";

const name = (iso, digest = "abc") => `${iso.replaceAll(":", "-")}-${digest}.tar.gz`;

test("a snapshot's name carries its instant", () => {
  assert.equal(snapshotInstantOf("2026-10-03T17-21-44.830Z-03ebee1e424d.tar.gz"), "2026-10-03T17:21:44.830Z");
  assert.equal(snapshotInstantOf("notes.txt"), undefined);
});

test("the newest few and the newest of each day are kept, older days pruned", () => {
  const names = [
    name("2026-10-03T17:21:44.830Z"), name("2026-10-03T18:24:05.074Z"), name("2026-10-03T23:56:54.930Z"),
    name("2026-10-04T00:12:01.751Z"), name("2026-10-04T00:33:34.701Z"),
    name("2026-10-02T09:00:00.000Z"), name("2026-10-02T21:00:00.000Z"), name("2026-09-01T12:00:00.000Z"),
  ];
  const kept = retainedSnapshots(names, { keep: 2, keepDays: 14, now: "2026-10-04T01:00:00.000Z" });
  assert.deepEqual(new Set(kept), new Set([
    name("2026-10-04T00:33:34.701Z"), name("2026-10-04T00:12:01.751Z"), // the two newest
    name("2026-10-03T23:56:54.930Z"), name("2026-10-02T21:00:00.000Z"), // the newest of each earlier day in range
  ]));
  assert.ok(prunedSnapshots(names, { keep: 2, keepDays: 14, now: "2026-10-04T01:00:00.000Z" }).includes(name("2026-09-01T12:00:00.000Z")));
});

test("names without an instant are never pruned", () => {
  assert.deepEqual(prunedSnapshots(["README", name("2026-10-04T00:00:00.000Z")], { keep: 1 }), []);
});
