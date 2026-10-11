#!/usr/bin/env node
// Claims the paths a slice will touch before work starts (src/claims.mjs), and says which open
// claims of other slices overlap them; the claim is released when the slice's candidate integrates.
//   node claim-paths.mjs --name <owner>/<slice> --path <path>... [--by <who>] [--spec <release.json path>]
//   node claim-paths.mjs --list
//   node claim-paths.mjs --release --name <owner>/<slice>
// Exit status: 0 claimed with no overlap, 3 claimed with overlaps (agree an order with their owners).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { claimPaths, readClaims, releaseClaim } from "../src/claims.mjs";
import { gitTextSync } from "../src/git-objects.mjs";
import { candidateNameOk } from "../src/integrate.mjs";

const DEFAULT_SPEC = "lib/emsenn/services/561-group/services/561-group-services-section/services/561-group-operations-services-section/services/bare-cedar-fog-services-section/data/records/machine-deployment-service-records/metroplat/deployments/bare-cedar-fog-host/deploy/release.json";

if (import.meta.main) {
  const { values } = parseArgs({ options: { name: { type: "string" }, path: { type: "string", multiple: true, default: [] }, by: { type: "string" }, list: { type: "boolean", default: false }, release: { type: "boolean", default: false }, spec: { type: "string", default: DEFAULT_SPEC }, repository: { type: "string", default: process.cwd() } } });
  const spec = JSON.parse((() => { try { return gitTextSync(values.repository, ["show", `refs/remotes/origin/main:${values.spec}`]); } catch { return readFileSync(resolve(values.repository, values.spec), "utf8"); } })());
  const queueRoot = resolve(homedir(), spec.releaseRoot, "queue");
  if (values.list) {
    process.stdout.write(`${JSON.stringify(readClaims(queueRoot), null, 2)}\n`);
  } else {
    if (!values.name || !candidateNameOk(values.name)) throw new Error("--name <owner>/<slice> is required, in lowercase letters, digits, '.', '_' and '-'");
    if (values.release) {
      releaseClaim(queueRoot, values.name);
      process.stdout.write(`released ${values.name}\n`);
    } else {
      if (values.path.length === 0) throw new Error("--path is required at least once");
      const { claim, overlaps } = claimPaths(queueRoot, { name: values.name, paths: values.path.map((path) => path.replace(/^\.\//u, "")), by: values.by ?? null });
      process.stdout.write(`${JSON.stringify({ claim, overlaps }, null, 2)}\n`);
      process.exitCode = overlaps.length ? 3 : 0;
    }
  }
}
