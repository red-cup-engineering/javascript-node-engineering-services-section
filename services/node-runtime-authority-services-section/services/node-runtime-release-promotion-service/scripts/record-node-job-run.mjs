#!/usr/bin/env node
/**
 * A node job's run records its own receipt as it ends (the ExecStopPost runNodeJob gives its unit):
 * how systemd says it ended, the release it ran, and the tail of what the job itself wrote (its
 * own journal lines, not the service manager's about it).
 * Usage: record-node-job-run <receipt path>.
 */
import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";

const [receipt] = process.argv.slice(2);
if (receipt === undefined) throw new TypeError("usage: record-node-job-run <receipt path>");
const environment = process.env;
const TAIL_LINES = 30;

function tail() {
  try {
    return execFileSync("journalctl", ["--user", `_SYSTEMD_USER_UNIT=${environment.NODE_JOB_UNIT}`, "--since", `@${Math.floor(Date.parse(environment.NODE_JOB_STARTED_AT) / 1000)}`, "-o", "cat", "--no-pager", "-n", String(TAIL_LINES)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n").filter((line) => line !== "");
  } catch {
    return [];
  }
}

const result = environment.SERVICE_RESULT ?? "unknown";
const record = {
  kind: "node-job-run.v1",
  job: environment.NODE_JOB_ID,
  unit: environment.NODE_JOB_UNIT,
  release: environment.NODE_JOB_RELEASE || null,
  startedAt: environment.NODE_JOB_STARTED_AT,
  endedAt: new Date().toISOString(),
  ok: result === "success",
  result,
  exit: { code: environment.EXIT_CODE ?? null, status: environment.EXIT_STATUS ?? null },
  tail: tail(),
};
writeFileSync(`${receipt}.part`, `${JSON.stringify(record, null, 2)}\n`);
renameSync(`${receipt}.part`, receipt);
