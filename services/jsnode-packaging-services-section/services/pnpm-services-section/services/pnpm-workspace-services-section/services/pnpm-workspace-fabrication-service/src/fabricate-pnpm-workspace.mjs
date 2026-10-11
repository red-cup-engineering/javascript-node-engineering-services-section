import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

function text(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be non-empty text`);
  return value.trim();
}

function relativePath(value) {
  const path = text(value, "package path").replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
  if (path.startsWith("/") || path === ".." || path.startsWith("../") || path.includes("/../") || path.includes("\0")) throw new TypeError(`package path escapes customer territory: ${value}`);
  return path;
}

function exactVersion(value, name) {
  const version = text(value, `${name} version`);
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new TypeError(`${name} version must be exact semver`);
  return version;
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function projectPnpmWorkspace(specification) {
  if (!specification || typeof specification !== "object" || Array.isArray(specification)) throw new TypeError("workspace specification must be an object");
  const packages = (specification.packages ?? []).map((item) => ({
    path: relativePath(item.path),
    manifest: { ...item.manifest, name: text(item.manifest?.name, "package name"), version: exactVersion(item.manifest?.version, item.manifest?.name ?? "package") },
  })).sort((left, right) => left.path.localeCompare(right.path));
  const duplicatePaths = Object.entries(Object.groupBy(packages, ({ path }) => path)).filter(([, rows]) => rows.length > 1);
  const duplicateNames = Object.entries(Object.groupBy(packages, ({ manifest }) => manifest.name)).filter(([, rows]) => rows.length > 1);
  if (duplicatePaths.length || duplicateNames.length) throw new TypeError("workspace package paths and identities must be unique");
  const internal = new Map(packages.map(({ manifest }) => [manifest.name, manifest.version]));
  const files = new Map();
  const root = {
    name: text(specification.root?.name, "root name"),
    version: exactVersion(specification.root?.version, "root"),
    private: true,
    packageManager: `pnpm@${exactVersion(specification.pnpmVersion, "pnpm")}`,
  };
  files.set("package.json", json(root));
  const buildPolicy = specification.buildPolicy ?? {};
  const policyLines = Object.entries(buildPolicy).sort(([left], [right]) => left.localeCompare(right)).map(([name, admitted]) => `  ${JSON.stringify(name)}: ${admitted === true ? "true" : "false"}`);
  files.set("pnpm-workspace.yaml", `packages:\n${packages.map(({ path }) => `  - ${JSON.stringify(path)}`).join("\n")}\n${policyLines.length ? `allowBuilds:\n${policyLines.join("\n")}\n` : ""}`);
  for (const item of packages) {
    const manifest = structuredClone(item.manifest);
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      if (!manifest[field]) continue;
      manifest[field] = Object.fromEntries(Object.entries(manifest[field]).map(([name, version]) => internal.has(name) ? [name, `workspace:${internal.get(name)}`] : [name, version]));
    }
    files.set(`${item.path}/package.json`, json(manifest));
  }
  const digest = createHash("sha256");
  for (const [path, body] of [...files].sort(([left], [right]) => left.localeCompare(right))) digest.update(path).update("\0").update(body).update("\0");
  return Object.freeze({ type: "PnpmWorkspaceProjection", version: 1, files, digest: digest.digest("hex"), packages: packages.map(({ path, manifest }) => ({ path, name: manifest.name, version: manifest.version })) });
}

export async function fabricatePnpmWorkspace({ specification, outputDirectory }) {
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error("customer workspace output territory must be empty");
  const projection = projectPnpmWorkspace(specification);
  for (const [path, body] of projection.files) {
    const target = resolve(output, path);
    const rel = relative(output, target);
    if (!rel || rel.startsWith(`..${sep}`) || rel === "..") throw new Error(`projected path escapes output territory: ${path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body, { flag: "wx" });
  }
  return Object.freeze({ type: "PnpmWorkspaceFabricationReceipt", version: 1, outputDirectory: output, digest: projection.digest, packages: projection.packages, files: [...projection.files.keys()].sort() });
}
