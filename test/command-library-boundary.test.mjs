import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { admitJavascriptNodeCommandExecutionRequest } from "../scripts/admit-javascript-node-command-execution-request.mjs";
import { isolateJavascriptNodeCommandExecutionRequest } from "../scripts/isolate-javascript-node-command-execution-request.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const command = { type: "JavascriptNodeCommandExecutionRequest", version: 1, command: "node", arguments: ["--version"], directory: "/tmp", environment: { LANG: "C.UTF-8" }, input: null };
const isolation = { type: "JavascriptNodeCommandIsolationRequest", version: 1, hidden: ["/"], readable: ["/gnu/store/example"], writable: ["/tmp/work"], request: command };

// The actual public package exports and schemas, without the CLI interpreter or
// an installed dependency graph. No implementation is replaced in this carrier.
function libraryCarrier(t) {
  const directory = mkdtempSync(join(tmpdir(), "node-command-library-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const relative of ["package.json",
    "scripts/admit-javascript-node-command-execution-request.mjs",
    "scripts/isolate-javascript-node-command-execution-request.mjs",
    "data/records/admit-javascript-node-command-execution-request.input.schema.json",
    "data/records/admit-javascript-node-command-execution-request.output.schema.json"]) {
    const destination = join(directory, relative);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, relative), destination);
  }
  return directory;
}

test("command admission imports as a library without its CLI interpreter closure", async t => {
  const directory = libraryCarrier(t);
  const { admitJavascriptNodeCommandExecutionRequest: admit } = await import(pathToFileURL(join(directory, "scripts/admit-javascript-node-command-execution-request.mjs")));
  assert.equal(admit(command), command);
  assert.throws(() => admit({ ...command, input: undefined }), TypeError);
});

test("isolation projection imports as a library without its CLI interpreter closure", async t => {
  const directory = libraryCarrier(t);
  const { isolateJavascriptNodeCommandExecutionRequest: isolate } = await import(pathToFileURL(join(directory, "scripts/isolate-javascript-node-command-execution-request.mjs")));
  assert.deepEqual(isolate(isolation), isolateJavascriptNodeCommandExecutionRequest(isolation));
  assert.throws(() => isolate({ ...isolation, hidden: ["relative"] }), TypeError);
});

function cli(name, input, arguments_ = []) {
  const result = spawnSync(process.execPath, [join(root, "scripts", `${name}.mjs`), ...arguments_],
    { input: input === undefined ? undefined : JSON.stringify(input) + "\n", encoding: "utf8", timeout: 15000 });
  assert.ifError(result.error);
  return result;
}

test("admission CLI retains the genuine schema interpreter for acceptance and refusal", () => {
  const accepted = cli("admit-javascript-node-command-execution-request", command);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(JSON.parse(accepted.stdout), admitJavascriptNodeCommandExecutionRequest(command));
  const { input, ...missingInput } = command;
  const refused = cli("admit-javascript-node-command-execution-request", missingInput);
  assert.equal(refused.status, 2, refused.stderr);
  const reading = JSON.parse(refused.stdout);
  assert.equal(reading.ok, false);
  assert.equal(reading.refusal.reason, "TypeError");
  const schemaRefused = cli("admit-javascript-node-command-execution-request", null);
  assert.equal(schemaRefused.status, 2, schemaRefused.stderr);
  assert.equal(JSON.parse(schemaRefused.stdout).refusal.reason, "InvalidInput");
});

test("isolation CLI retains the genuine operation interpreter and exact projection", () => {
  const accepted = cli("isolate-javascript-node-command-execution-request", isolation);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(JSON.parse(accepted.stdout), isolateJavascriptNodeCommandExecutionRequest(isolation));
  const refused = cli("isolate-javascript-node-command-execution-request", { ...isolation, hidden: ["relative"] });
  assert.equal(refused.status, 2, refused.stderr);
  const reading = JSON.parse(refused.stdout);
  assert.equal(reading.ok, false);
  assert.equal(reading.refusal.reason, "TypeError");
});

test("both command CLIs retain their documented help entrypoints", () => {
  for (const name of ["admit-javascript-node-command-execution-request", "isolate-javascript-node-command-execution-request"]) {
    const result = cli(name, undefined, ["--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.startsWith(name + " — "));
  }
});
