import { glob, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

function managerName(value) {
  return typeof value === "string" ? value.split("@")[0] : null;
}

async function workspaceManifests(root, source) {
  if (source === null) {
    const manifests = [];
    for await (const path of glob("**/package.json", {
      cwd: root,
      exclude: ["package.json", "**/node_modules/**", "**/.git/**", "**/data/**", "**/dist/**", "**/.cache/**", "**/.archive/**", "**/.venv/**", "**/venv/**", "**/content/assets/legacy/**", "**/src/content/assets/legacy/**"],
    })) manifests.push(path);
    return manifests.sort();
  }
  const patterns = [...source.matchAll(/^\s*-\s+["']([^"']+)["']\s*$/gmu)].map((match) => match[1]);
  const excluded = ["**/node_modules/**", "**/.git/**", ...patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => `${pattern.slice(1)}/**`)];
  const manifests = new Set();
  for (const pattern of patterns.filter((value) => !value.startsWith("!"))) {
    for await (const match of glob(`${pattern}/package.json`, { cwd: root, exclude: excluded })) manifests.add(match);
  }
  return [...manifests].sort();
}

function buildPolicyValues(source) {
  const values = [];
  let inPolicy = false;
  for (const line of source.split(/\r?\n/u)) {
    if (/^allowBuilds:\s*$/u.test(line)) { inPolicy = true; continue; }
    if (inPolicy && /^\S/u.test(line)) break;
    const match = inPolicy ? /^\s+(['"]?[^:'"]+['"]?):\s*(.+)\s*$/u.exec(line) : null;
    if (match) values.push({ package: match[1].replaceAll(/["']/gu, ""), value: match[2] });
  }
  return values;
}

export async function assayNodePackageAuthority(workspaceRoot) {
  const root = resolve(workspaceRoot);
  let rootManifest = {};
  try { rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  let workspaceSource = null;
  try { workspaceSource = await readFile(join(root, "pnpm-workspace.yaml"), "utf8"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const packages = [];
  const conflicts = [];
  for (const manifestPath of await workspaceManifests(root, workspaceSource)) {
    const directory = dirname(join(root, manifestPath));
    const manifest = JSON.parse(await readFile(join(root, manifestPath), "utf8"));
    const locks = [];
    if (await exists(join(directory, "package-lock.json"))) locks.push("npm");
    if (await exists(join(directory, "pnpm-lock.yaml"))) locks.push("pnpm");
    if (await exists(join(directory, "yarn.lock"))) locks.push("yarn");
    const declared = managerName(manifest.packageManager);
    const authority = declared ?? (locks.length === 1 ? locks[0] : workspaceSource === null ? "independent-package-unmaterialized" : "workspace-pnpm-development");
    const reasons = [];
    if (locks.length > 1) reasons.push("multiple-local-lockfiles");
    if (declared && locks.length === 1 && declared !== locks[0]) reasons.push("declared-manager-disagrees-with-lockfile");
    if (reasons.length > 0) conflicts.push({ package: manifest.name ?? null, path: relative(root, directory), reasons });
    packages.push({
      package: manifest.name ?? null,
      path: relative(root, directory),
      authority,
      declaredManager: declared,
      locks,
      npmInstallMarker: await exists(join(directory, "node_modules", ".package-lock.json")),
    });
  }
  if (Object.hasOwn(rootManifest, "workspaces")) conflicts.push({ package: rootManifest.name ?? null, path: ".", reasons: ["root-npm-workspace-competes-with-pnpm-workspace"] });
  const buildPolicy = workspaceSource === null ? [] : buildPolicyValues(workspaceSource);
  const unresolvedBuildPolicy = buildPolicy.filter(({ value }) => value !== "true" && value !== "false");
  if (unresolvedBuildPolicy.length > 0) conflicts.push({ package: null, path: "pnpm-workspace.yaml", reasons: ["unresolved-build-script-policy"] });
  return {
    type: "NodePackageAuthorityAssayReport",
    version: 1,
    discoveryMode: workspaceSource === null ? "independent-package-tree" : "pnpm-workspace",
    rootManager: rootManifest.packageManager ?? null,
    rootNpmWorkspace: Object.hasOwn(rootManifest, "workspaces"),
    frozenWorkspaceLockPresent: await exists(join(root, "pnpm-lock.yaml")),
    packageCount: packages.length,
    authorityCounts: Object.fromEntries([...new Set(packages.map(({ authority }) => authority))].sort().map((authority) => [authority, packages.filter((entry) => entry.authority === authority).length])),
    npmInstallMarkerCount: packages.filter(({ npmInstallMarker }) => npmInstallMarker).length,
    buildPolicy,
    unresolvedBuildPolicy,
    conflicts,
    packages,
  };
}
