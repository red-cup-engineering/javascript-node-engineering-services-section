#!/usr/bin/env node
// One release-reconciliation pass for a host, run by its supervisor rather than by the service it
// releases: a node too saturated to run its own pass must still be released the commit that
// relieves it. The pass is level-triggered, idempotent and lock-guarded (reconcile-release.mjs),
// so this and the node's own pass converge on one release.
//   node reconcile-node-release.mjs --repository <checkout> --spec <repository-relative release.json>
//     [--remote origin] [--branch main] [--settle-seconds 120] [--verify-drift]
import process from "node:process";
import { reconcileNodeRelease } from "../src/reconcile-release.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
}

const settle = option("--settle-seconds");
const readout = await reconcileNodeRelease({
  repository: option("--repository"),
  spec: option("--spec"),
  remote: option("--remote"),
  branch: option("--branch"),
  ...(settle === undefined ? {} : { settleSeconds: Number(settle) }),
  verifyDrift: process.argv.includes("--verify-drift"),
});
process.stdout.write(`${JSON.stringify(readout)}\n`);
