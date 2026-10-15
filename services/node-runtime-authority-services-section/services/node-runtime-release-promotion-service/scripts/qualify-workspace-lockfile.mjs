#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { planWorkspaceLockfile, qualifyWorkspaceLockfile } from "../src/workspace-lockfile.mjs";

const usage = "qualify-workspace-lockfile --repository <checkout> --commit <source> --spec-in-commit <release-spec> [--state-dir <outside-source>] [--plan-only | --rederive]";
const options = {}, args = process.argv.slice(2);
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan-only") { options.planOnly = true; continue; }
    if (args[i] === "--rederive") { options.rederive = true; continue; }
    if (!["--repository", "--commit", "--spec-in-commit", "--state-dir"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new TypeError(usage);
    options[args[i].slice(2)] = args[++i];
  }
  if (!options.repository || !options.commit || !options["spec-in-commit"]) throw new TypeError(usage);
  if (!options.planOnly && !options["state-dir"]) throw new TypeError("qualification requires --state-dir to retain the received lockfile");
  const plan = planWorkspaceLockfile({ repository: options.repository, commit: options.commit });
  if (options.planOnly) {
    process.stdout.write(JSON.stringify({ commit: plan.commit, inputs: plan.inputs }, null, 2) + "\n");
  } else {
    const spec = JSON.parse(execFileSync("git", ["show", `${plan.commit}:${options["spec-in-commit"]}`], { cwd: plan.repository, encoding: "utf8" }));
    const result = await qualifyWorkspaceLockfile({ repository: plan.repository, commit: plan.commit,
      derive: spec.lockfile?.derive, install: spec.dependencies ?? spec.install, stateDirectory: options["state-dir"], rederive: options.rederive });
    const { lockfile, ...reading } = result;
    process.stdout.write(JSON.stringify({ ...reading, lockfileBytes: lockfile.length }, null, 2) + "\n");
  }
} catch (error) {
  process.stderr.write((error.stack ?? String(error)) + "\n");
  process.exitCode = 1;
}
