/**
 * A node's jobs: the programs a deployment declares (one file each in deploy/jobs/, beside its release.json), each
 * run by the node from its running release in a transient user unit of its own. The standard is
 * Kubernetes' CronJob: one declaration holds the trigger (`schedule` in a `timeZone`, or
 * `everySeconds` from `firstDueAt`) and the template it starts, and the Job's pod reports its own
 * completion. The node reads the trigger as a clock schedule (`nodeJobSchedulesOf`); nothing else
 * declares it. The run is a transient unit that outlives the node that started it, since every
 * release restarts the node, and its ExecStopPost writes the run's receipt
 * (<releaseRoot>/jobs/<job>.json). A job is changed, added or retired only by a commit, and runs
 * only released bytes.
 *
 * One file per job, <id>.json, holding exactly one declaration: the drop-in directory standard
 * (Kubernetes manifests directory, systemd drop-ins, cron.d), so two concurrent additions never edit
 * the same bytes. `readNodeJobDeclarations` is the one reader.
 *
 * A declaration is { id, summary, directory, node, environment?, maxSeconds, successExitStatus?,
 * finally?, workingTree?, priority?, schedule? | everySeconds?, timeZone?, firstDueAt?,
 * startingDeadlineSeconds?, maxAttempts?, retryAfterSeconds? }: directory is release-relative,
 * node the arguments the node's own runtime runs there, finally the arguments of a program run
 * there after the job whatever its result (its retention, say), and "{release}" in an argument or
 * environment value stands for the release tree the run uses. `priority: "idle"` runs it in
 * systemd's idle CPU and I/O classes, so housekeeping never competes with the node. A job with no trigger runs only when
 * asked (`node-job-run`).
 *
 * A job that writes the repository declares its working-tree custody: `workingTree.custody`, the
 * repository-relative paths it holds (none, for a job that only reads the working tree). It still runs released bytes; the node names its working tree
 * (NODE_JOB_WORKING_TREE) and the custody (NODE_JOB_CUSTODY, a JSON array) to the run, and the
 * program reads and writes its data there (computer-code-development-engine `git/working-tree`).
 * No two jobs of a deployment hold overlapping custody, so no two runs write the same path.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RECORDER = fileURLToPath(new URL("../scripts/record-node-job-run.mjs", import.meta.url));
const JOB_ID = /^[a-z0-9][a-z0-9-]*$/;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/;
// A unit that has not ended holds the job's turn: one run of a job at a time (concurrencyPolicy: Forbid).
const HOLDING = new Set(["active", "activating", "deactivating", "reloading", "refreshing"]);

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined);
const isArgv = (value) => Array.isArray(value) && value.length > 0 && value.every((argument) => typeof argument === "string");
const positiveInteger = (value, max) => Number.isInteger(value) && value >= 1 && value <= max;

// The trigger, in the clock's own schedule terms (organizing work/recurring): a cron calendar rule
// or an interval, never both; a job may have neither and run only when asked. This package runs
// bare (release tools carry no installed dependencies), so the rule's reading is the clock's: the
// deployment's verify step reads every derived schedule through the clock's assertTrigger before
// a release is promoted.
function triggerOf(job, where) {
  if (job.schedule !== undefined && job.everySeconds !== undefined) throw new TypeError(`${where} declares both a cron schedule and everySeconds`);
  const trigger = {};
  if (job.schedule !== undefined) {
    if (typeof job.schedule !== "string" || job.schedule.trim() === "") throw new TypeError(`${where} has a schedule that is not a cron rule`);
    trigger.schedule = job.schedule;
    if (job.timeZone !== undefined) {
      if (typeof job.timeZone !== "string" || job.timeZone === "") throw new TypeError(`${where} has a timeZone that is not an IANA zone name`);
      trigger.timeZone = job.timeZone;
    }
  } else if (job.timeZone !== undefined) {
    throw new TypeError(`${where} names a timeZone but no cron schedule`);
  }
  if (job.everySeconds !== undefined) {
    if (!positiveInteger(job.everySeconds, 31_536_000) || job.everySeconds < 60) throw new TypeError(`${where} needs everySeconds between 60 and 31536000`);
    if (typeof job.firstDueAt !== "string" || !Number.isFinite(Date.parse(job.firstDueAt))) throw new TypeError(`${where} needs a firstDueAt instant for its interval`);
    trigger.everySeconds = job.everySeconds;
  }
  if (job.firstDueAt !== undefined) {
    if (!Number.isFinite(Date.parse(job.firstDueAt))) throw new TypeError(`${where} has an invalid firstDueAt`);
    trigger.firstDueAt = job.firstDueAt;
  }
  for (const [key, max] of [["startingDeadlineSeconds", 31_536_000], ["maxAttempts", 10], ["retryAfterSeconds", 86_400]]) {
    if (job[key] === undefined) continue;
    if (!positiveInteger(job[key], max)) throw new TypeError(`${where} has an invalid ${key}`);
    if (trigger.schedule === undefined && trigger.everySeconds === undefined) throw new TypeError(`${where} has ${key} but no trigger`);
    trigger[key] = job[key];
  }
  return Object.freeze(trigger);
}

// Custody paths are repository-relative and never leave the repository. A job that only reads the
// working tree holds none: `custody: []`.
function custodyOf(workingTree, where) {
  if (workingTree === undefined) return undefined;
  const custody = workingTree?.custody;
  if (!Array.isArray(custody)) throw new TypeError(`${where} declares a workingTree without its custody paths`);
  return Object.freeze(custody.map((entry) => {
    if (typeof entry !== "string" || entry === "" || isAbsolute(entry) || normalize(entry).startsWith("..")) throw new TypeError(`${where} has custody path ${JSON.stringify(entry)} outside the repository`);
    return normalize(entry).replace(/\/+$/, "");
  }));
}

const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

function declarationOf(job, source) {
  const where = `${source}: job ${JSON.stringify(job?.id)}`;
  if (typeof job?.id !== "string" || !JOB_ID.test(job.id)) throw new TypeError(`${where} needs an id of lowercase letters, digits and hyphens`);
  if (typeof job.summary !== "string" || job.summary === "") throw new TypeError(`${where} needs a summary`);
  if (typeof job.directory !== "string" || isAbsolute(job.directory) || normalize(job.directory).startsWith("..")) {
    throw new TypeError(`${where} needs a release-relative directory`);
  }
  if (!isArgv(job.node)) throw new TypeError(`${where} needs node, the arguments its runtime runs`);
  if (job.finally !== undefined && !isArgv(job.finally)) throw new TypeError(`${where} has a finally that is not the arguments of a program`);
  const environment = job.environment ?? {};
  for (const [name, value] of Object.entries(environment)) {
    if (!ENVIRONMENT_NAME.test(name) || typeof value !== "string") throw new TypeError(`${where} has an invalid environment entry ${name}`);
  }
  if (!Number.isInteger(job.maxSeconds) || job.maxSeconds < 1 || job.maxSeconds > 86_400) throw new TypeError(`${where} needs maxSeconds between 1 and 86400`);
  const successExitStatus = job.successExitStatus ?? [];
  if (!Array.isArray(successExitStatus) || !successExitStatus.every((status) => Number.isInteger(status) && status > 0 && status < 256)) {
    throw new TypeError(`${where} has an invalid successExitStatus`);
  }
  const custody = custodyOf(job.workingTree, where);
  if (job.priority !== undefined && job.priority !== "idle") throw new TypeError(`${where} has a priority other than idle`);
  return Object.freeze({
    id: job.id, summary: job.summary, directory: normalize(job.directory), node: Object.freeze([...job.node]),
    ...(job.finally === undefined ? {} : { finally: Object.freeze([...job.finally]) }),
    environment: Object.freeze({ ...environment }), maxSeconds: job.maxSeconds, successExitStatus: Object.freeze([...successExitStatus]),
    ...(custody === undefined ? {} : { workingTree: Object.freeze({ custody }) }),
    ...(job.priority === undefined ? {} : { priority: job.priority }),
    trigger: triggerOf(job, where),
  });
}

/**
 * The job declarations in a deployment's jobs directory, as one array sorted by id. A declaration
 * lives in `<id>.json` and holds one job object; a file whose name and `id` differ, a second file
 * declaring an id already declared, or anything in the directory that is not a `.json` file is
 * refused. This is the only reader of the declarations on disk.
 */
export function readNodeJobDeclarations(directory) {
  const declared = [];
  const files = new Map();
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const file = resolve(directory, entry.name);
    if (!entry.isFile() || !entry.name.endsWith(".json")) throw new TypeError(`${file} is not a job declaration file (<id>.json)`);
    const job = JSON.parse(readFileSync(file, "utf8"));
    if (job === null || typeof job !== "object" || Array.isArray(job)) throw new TypeError(`${file} must hold exactly one job object`);
    if (files.has(job.id)) throw new TypeError(`${file}: duplicate job ${JSON.stringify(job.id)}, already declared by ${files.get(job.id)}`);
    if (job.id !== basename(entry.name, ".json")) throw new TypeError(`${file}: job id ${JSON.stringify(job.id)} differs from its file name`);
    files.set(job.id, file);
    declared.push(job);
  }
  return declared.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The jobs a deployment declares, with where the node keeps them: { releaseRoot (home-relative),
 * unitPrefix, jobs: Map<id, declaration> }, or undefined for a deployment that declares none.
 */
export function nodeJobsOf(deploymentRoot) {
  const jobsFile = resolve(deploymentRoot, "deploy/jobs");
  if (!existsSync(jobsFile)) return undefined;
  const spec = JSON.parse(readFileSync(resolve(deploymentRoot, "deploy/release.json"), "utf8"));
  if (spec.host !== "local") throw new TypeError(`${jobsFile}: jobs run only on the node the deployment releases to locally`);
  if (typeof spec.releaseRoot !== "string" || spec.releaseRoot === "") throw new TypeError(`${jobsFile}: its release.json names no releaseRoot`);
  if (typeof spec.unit?.name !== "string" || !spec.unit.name.endsWith(".service")) throw new TypeError(`${jobsFile}: its release.json names no service unit`);
  const declared = readNodeJobDeclarations(jobsFile);
  const jobs = new Map();
  for (const job of declared) {
    const declaration = declarationOf(job, jobsFile);
    if (jobs.has(declaration.id)) throw new TypeError(`${jobsFile}: duplicate job ${declaration.id}`);
    for (const other of jobs.values()) {
      const shared = (declaration.workingTree?.custody ?? []).find((path) => (other.workingTree?.custody ?? []).some((held) => overlaps(path, held)));
      if (shared !== undefined) throw new TypeError(`${jobsFile}: jobs ${other.id} and ${declaration.id} both hold custody of ${shared}`);
    }
    jobs.set(declaration.id, declaration);
  }
  return Object.freeze({ releaseRoot: spec.releaseRoot, unitPrefix: spec.unit.name.slice(0, -".service".length), jobs });
}

const receiptOf = (home, releaseRoot, id) => resolve(home, releaseRoot, "jobs", `${id}.json`);

/**
 * The clock schedules a deployment's jobs declare: one `node-job-run` schedule per job with a
 * trigger, run as `account`, in the clock's admission shape (organizing work/recurring).
 */
export function nodeJobSchedulesOf({ deploymentRoot, deployment, account }) {
  if (typeof deployment !== "string" || deployment === "") throw new TypeError("node-job schedules name their deployment");
  if (typeof account !== "string" || account === "") throw new TypeError("node-job schedules name the account they run as");
  const declared = nodeJobsOf(deploymentRoot);
  if (declared === undefined) return Object.freeze([]);
  return Object.freeze([...declared.jobs.values()]
    .filter((job) => job.trigger.schedule !== undefined || job.trigger.everySeconds !== undefined)
    .map((job) => Object.freeze({ id: `node-job-${job.id}`, verb: "node-job-run", input: { deployment, job: job.id }, account, ...job.trigger })));
}

/** Each declared job with its last run's receipt (undefined before its first run ends). */
export function nodeJobReadings({ deploymentRoot, home = homedir() }) {
  const declared = nodeJobsOf(deploymentRoot);
  if (declared === undefined) return [];
  return [...declared.jobs.values()].map((job) => {
    const receipt = receiptOf(home, declared.releaseRoot, job.id);
    return Object.freeze({ job, receipt, last: readJson(receipt) });
  });
}

function run(command, args) {
  return new Promise((resolvePromise) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => resolvePromise({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }));
  });
}

const expand = (value, release) => value.replaceAll("{release}", release);

/**
 * Start the job's next run from the node's running release, unless a run of it has not ended.
 * Returns { kind, job, unit, state: running | started, release?, startedAt?, last }, where last is
 * the receipt of the job's last run to end. A run's outcome is its receipt, not this call's.
 */
export async function runNodeJob({ deploymentRoot, job: id, workingTree, home = homedir(), node = process.execPath, now = () => new Date() }) {
  const declared = nodeJobsOf(deploymentRoot);
  const job = declared?.jobs.get(id);
  if (job === undefined) throw new TypeError(`node-job: ${deploymentRoot} declares no job ${JSON.stringify(id)}`);
  if (job.workingTree !== undefined && (typeof workingTree !== "string" || !isAbsolute(workingTree) || !existsSync(workingTree))) {
    throw new TypeError(`node-job: ${job.id} holds working-tree custody, and this node names no working tree to run it in`);
  }
  const unit = `${declared.unitPrefix}-job-${job.id}.service`;
  const receipt = receiptOf(home, declared.releaseRoot, job.id);
  const last = readJson(receipt);
  const shown = await run("systemctl", ["--user", "show", "--property=ActiveState", "--value", unit]);
  if (shown.code !== 0) throw new Error(`node-job: systemctl could not read ${unit}: ${shown.stderr.trim()}`);
  if (HOLDING.has(shown.stdout.trim())) return Object.freeze({ kind: "node-job-run.v1", job: job.id, unit, state: "running", last });
  // The run keeps the release it started on, whatever the node promotes while it runs.
  const release = await realpath(resolve(home, declared.releaseRoot, "current"));
  const commit = readJson(resolve(release, "release-receipt.json"))?.source?.commit ?? null;
  const startedAt = now().toISOString();
  mkdirSync(dirname(receipt), { recursive: true });
  const environment = {
    PATH: `${dirname(node)}:/usr/local/bin:/usr/bin:/bin`,
    METROPLAT_REPOSITORY_ROOT: release,
    ...Object.fromEntries(Object.entries(job.environment).map(([name, value]) => [name, expand(value, release)])),
    NODE_JOB_ID: job.id,
    NODE_JOB_UNIT: unit,
    NODE_JOB_RELEASE: commit ?? "",
    NODE_JOB_STARTED_AT: startedAt,
    ...(job.workingTree === undefined ? {} : { NODE_JOB_WORKING_TREE: workingTree, NODE_JOB_CUSTODY: JSON.stringify(job.workingTree.custody) }),
  };
  const started = await run("systemd-run", [
    "--user", "--quiet", "--collect", `--unit=${unit}`, `--description=${job.summary}`,
    "--property=Type=exec",
    `--property=WorkingDirectory=${resolve(release, job.directory)}`,
    `--property=RuntimeMaxSec=${job.maxSeconds}`,
    "--property=UMask=0077",
    ...(job.priority === "idle" ? ["--property=Nice=19", "--property=CPUSchedulingPolicy=idle", "--property=IOSchedulingClass=idle"] : []),
    "--property=NoNewPrivileges=yes",
    ...(job.successExitStatus.length === 0 ? [] : [`--property=SuccessExitStatus=${job.successExitStatus.join(" ")}`]),
    // ExecStopPost commands run in order: the job's own finally, then the receipt of the whole run.
    ...(job.finally === undefined ? [] : [`--property=ExecStopPost=${node} ${job.finally.map((argument) => expand(argument, release)).join(" ")}`]),
    `--property=ExecStopPost=${node} ${RECORDER} ${receipt}`,
    ...Object.entries(environment).map(([name, value]) => `--setenv=${name}=${value}`),
    "--", node, ...job.node.map((argument) => expand(argument, release)),
  ]);
  if (started.code !== 0) throw new Error(`node-job: ${unit} did not start: ${started.stderr.trim() || started.stdout.trim()}`);
  return Object.freeze({ kind: "node-job-run.v1", job: job.id, unit, state: "started", release: commit, startedAt, last });
}
