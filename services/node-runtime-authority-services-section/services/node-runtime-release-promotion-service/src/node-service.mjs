/**
 * A node's long-running service, declared as data (deploy/service.json beside its release.json):
 * what runs, from which release-relative directory, with which environment. The live unit file and
 * a release candidate's probe are both derived from it, so how the node starts has one source. The
 * standard is a Kubernetes container spec read onto systemd: `node` is the container's args against
 * the release's own runtime, `environmentFile` and `environment` its env, and the rest the unit's
 * restart and resource policy. "{release}" in a value stands for the release tree the unit runs.
 *
 * A probe (METROPLAT_PROBE=1, feltos-enterprise-host) boots the same args from a candidate tree on
 * a side port with scratch state, before anything is promoted. It runs no clock and sends nothing
 * outward, so it never doubles the live node's work.
 *
 * A declaration is { unit, description, runtime, directory, node, environmentFile?, environment?,
 * socket?, after?, oomScoreAdjust?, oomScoreAdjustBecause?, restart?, restartSeconds?,
 * startTimeoutSeconds?, wantedBy? }; `runtime` is the absolute path of the node runtime it runs on. An
 * environment entry is a value, or { value, because } when the reason it is set belongs beside it.
 * This package runs bare (release tools carry no installed dependencies), so it imports nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";

const UNIT = /^[a-z0-9][a-z0-9-]*\.service$/;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/;
const isArgv = (value) => Array.isArray(value) && value.length > 0 && value.every((argument) => typeof argument === "string" && argument !== "");
const relative = (value) => typeof value === "string" && value !== "" && !isAbsolute(value) && !normalize(value).startsWith("..");

/** The service a deployment declares, checked, or undefined when it declares none. */
export function nodeServiceOf(deploymentRoot) {
  const file = resolve(deploymentRoot, "deploy/service.json");
  if (!existsSync(file)) return undefined;
  const service = JSON.parse(readFileSync(file, "utf8"));
  const where = `${file}:`;
  if (typeof service.unit !== "string" || !UNIT.test(service.unit)) throw new TypeError(`${where} unit names a .service`);
  if (typeof service.description !== "string" || service.description === "") throw new TypeError(`${where} needs a description`);
  if (typeof service.runtime !== "string" || !isAbsolute(service.runtime)) throw new TypeError(`${where} runtime is the absolute path of its node runtime`);
  if (!relative(service.directory)) throw new TypeError(`${where} directory is release-relative`);
  if (!isArgv(service.node)) throw new TypeError(`${where} node is the arguments the release's runtime runs`);
  if (service.environmentFile !== undefined && (typeof service.environmentFile !== "string" || !isAbsolute(service.environmentFile))) throw new TypeError(`${where} environmentFile is an absolute path`);
  for (const [name, entry] of Object.entries(service.environment ?? {})) {
    const value = typeof entry === "string" ? entry : entry?.value;
    if (!ENVIRONMENT_NAME.test(name) || typeof value !== "string") throw new TypeError(`${where} environment ${name} is a value or { value, because }`);
  }
  if (service.socket !== undefined && (typeof service.socket !== "string" || !service.socket.endsWith(".socket"))) throw new TypeError(`${where} socket names a .socket`);
  return Object.freeze(service);
}

const expand = (value, release) => value.replaceAll("{release}", release);
const valueOf = (entry) => (typeof entry === "string" ? entry : entry.value);
const quoteEnvironment = (name, value) => (/[\s"\\]/u.test(value) ? `"${name}=${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : `${name}=${value}`);
const commentLines = (because) => (because === undefined ? [] : String(because).split("\n").map((line) => `# ${line}`));

/**
 * The live unit file's text for a declared service, run from the release tree at `release` (the
 * deployment's `current` pointer, absolute) by its runtime.
 */
export function serviceUnitTextOf(service, { release, node = service.runtime }) {
  if (!isAbsolute(release) || !isAbsolute(node)) throw new TypeError("a service unit names its release tree and runtime absolutely");
  const after = [...(service.after ?? ["network-online.target"]), ...(service.socket === undefined ? [] : [service.socket])];
  const environment = Object.entries(service.environment ?? {}).flatMap(([name, entry]) => [
    ...commentLines(typeof entry === "string" ? undefined : entry.because),
    `Environment=${quoteEnvironment(name, expand(valueOf(entry), release))}`,
  ]);
  return [
    "# Derived from this deployment's deploy/service.json (node-runtime-release-promotion-service serviceUnitTextOf); edit that, not this.",
    "[Unit]",
    `Description=${service.description}`,
    `After=${after.join(" ")}`,
    `Wants=${after.join(" ")}`,
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${resolve(release, service.directory)}`,
    `ExecStart=${[node, ...service.node.map((argument) => expand(argument, release))].join(" ")}`,
    ...(service.environmentFile === undefined ? [] : [`EnvironmentFile=${service.environmentFile}`]),
    ...environment,
    ...(service.oomScoreAdjust === undefined ? [] : [...commentLines(service.oomScoreAdjustBecause), `OOMScoreAdjust=${service.oomScoreAdjust}`]),
    `Restart=${service.restart ?? "on-failure"}`,
    `RestartSec=${service.restartSeconds ?? 5}`,
    `TimeoutStartSec=${service.startTimeoutSeconds ?? 600}`,
    "UMask=0077",
    "",
    "[Install]",
    `WantedBy=${service.wantedBy ?? "default.target"}`,
    "",
  ].join("\n");
}

/**
 * How a release candidate's probe boots the declared service: the same arguments from the
 * candidate tree, its environment file, its environment with every path the probe must not share
 * (state, data, data root, ledger, the inference market's book, ASSIST's journal) replaced by scratch, and the probe switch. Returns { directory, argv, environmentFile?,
 * environment }; the release tool runs it in a transient unit of its own and reads /healthz at
 * `listen`.
 */
export function probeCommandOf(service, { tree, node = service.runtime, listen, scratch }) {
  if (![tree, node, scratch].every((path) => typeof path === "string" && isAbsolute(path))) throw new TypeError("a probe names its candidate tree, runtime and scratch directory absolutely");
  if (!/^[^:\s]+:\d{1,5}$/u.test(listen ?? "")) throw new TypeError("a probe listens on host:port");
  const [host, port] = listen.split(":");
  const declared = Object.fromEntries(Object.entries(service.environment ?? {}).map(([name, entry]) => [name, expand(valueOf(entry), tree)]));
  return Object.freeze({
    directory: resolve(tree, service.directory),
    argv: Object.freeze([node, ...service.node.map((argument) => expand(argument, tree))]),
    ...(service.environmentFile === undefined ? {} : { environmentFile: service.environmentFile }),
    environment: Object.freeze({
      ...declared,
      METROPLAT_PROBE: "1",
      METROPLAT_PROBE_LISTEN: listen,
      HOST: host,
      PORT: port,
      METROPLAT_WEB_STATE_DIR: resolve(scratch, "state"),
      METROPLAT_WEB_DATA_DIR: resolve(scratch, "data"),
      METROPLAT_DATA_ROOT: resolve(scratch, "data-root"),
      METROPLAT_LEDGER_JOURNAL: resolve(scratch, "ledger.beancount"),
      // The inference market's book is live state; a probe dispatches nothing, but never shares it.
      EXPECTED_RESOLUTION_PRICING_ROOT: resolve(scratch, "inference-pricing"),
      // ASSIST's journal is live state; a probe that installs ASSIST journals into scratch.
      ...(declared.ASSIST_STATE_ROOT === undefined ? {} : { ASSIST_STATE_ROOT: resolve(scratch, "assist-state") }),
      METROPLAT_REPOSITORY_ROOT: tree,
    }),
  });
}
