import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { projectSelectedWorkspaceLock } from "../src/install-workspace-selection.mjs";

function fixture() {
  return {
    lockfileVersion: "9.0",
    settings: { autoInstallPeers: true, excludeLinksFromLockfile: false },
    importers: {
      ".": {},
      "packages/host": { specifiers: { library: "1.0.0" }, dependencies: { library: "link:../library" } },
      "packages/library": { specifiers: { registry: "1.2.3" }, dependencies: { registry: "1.2.3(peer@2.0.0)" } },
      "packages/unselected": { specifiers: { unavailable: "1.0.0" }, dependencies: { unavailable: "1.0.0" } },
    },
    packages: {
      "registry@1.2.3(peer@2.0.0)": { resolution: { integrity: "sha512-retained" }, dependencies: { peer: "2.0.0" } },
      "peer@2.0.0": { resolution: { integrity: "sha512-peer" } },
      "unavailable@1.0.0": { resolution: { integrity: "sha512-unselected" } },
    },
  };
}
function project(lockfile = fixture(), overrides = {}) {
  return projectSelectedWorkspaceLock({
    lockfile, importerIds: [".", "packages/host", "packages/library"],
    workspace: "/source/checkout", lockfileDirectory: "/state/selection",
    filterLockfileByImporters: (source, ids, options) => {
      assert.deepEqual(ids, [".", "packages/host", "packages/library"]);
      assert.deepEqual(options.include, { dependencies: true, devDependencies: true, optionalDependencies: true });
      assert.equal(options.failOnMissingDependencies, true);
      assert.equal(options.skipped.size, 0);
      return { ...source, packages: Object.fromEntries(Object.entries(source.packages).filter(([key]) => !key.startsWith("unavailable@"))) };
    },
    ...overrides,
  });
}
test("delegates closure selection and preserves locked integrity, peers and original source", () => {
  const source = fixture();
  const before = structuredClone(source);
  const result = project(source);
  assert.deepEqual(source, before);
  assert.deepEqual(result.settings, source.settings);
  assert.deepEqual(Object.keys(result.packages), ["registry@1.2.3(peer@2.0.0)", "peer@2.0.0"]);
  assert.deepEqual(result.packages["registry@1.2.3(peer@2.0.0)"], source.packages["registry@1.2.3(peer@2.0.0)"]);
  const rebased = "../../source/checkout/packages/host";
  assert.equal(resolve("/state/selection", rebased, result.importers[rebased].dependencies.library.slice(5)), "/source/checkout/packages/library");
  assert.equal(Object.keys(result.importers).length, 3);
});
test("refuses a selected workspace whose source links escape its scope", () => {
  assert.throws(() => project(fixture(), { importerIds: [".", "packages/host"] }), /not closed over workspace link/u);
});
test("refuses missing importer records rather than resolving new versions", () => {
  assert.throws(() => project(fixture(), { importerIds: ["missing"] }), /absent from the committed lock/u);
});
test("refuses hook and patch relocation instead of dropping source behavior", () => {
  assert.throws(() => project({ ...fixture(), pnpmfileChecksum: "hash" }), /cannot relocate pnpm hooks or patches/u);
  assert.throws(() => project({ ...fixture(), patchedDependencies: { package: { path: "patches/package.patch", hash: "hash" } } }), /cannot relocate pnpm hooks or patches/u);
});
test("refuses local file dependencies and package-local references", () => {
  const direct = fixture();
  direct.importers["packages/library"].dependencies.registry = "file:../../local";
  assert.throws(() => project(direct), /cannot relocate local file dependencies/u);
  const nested = fixture();
  nested.packages["peer@2.0.0"].dependencies = { local: "link:../../local" };
  assert.throws(() => project(nested), /cannot relocate a package-local source reference/u);
});
test("refuses a changed locked resolution returned by the filtering tool", () => {
  assert.throws(() => project(fixture(), { filterLockfileByImporters: (source) => ({ ...source, packages: { "peer@2.0.0": { resolution: { integrity: "sha512-changed" } } } }) }), /pnpm changed locked package/u);
});
test("refuses changed lockfile settings returned by the filtering tool", () => {
  assert.throws(() => project(fixture(), { filterLockfileByImporters: (source) => ({ ...source, settings: { autoInstallPeers: false } }) }), /pnpm changed lockfile metadata/u);
});
test("refuses unsupported lockfile formats and relative tarballs", () => {
  assert.throws(() => project({ ...fixture(), lockfileVersion: "6.0" }), /requires a pnpm v9 lockfile/u);
  const local = fixture();
  local.packages["peer@2.0.0"].resolution = { tarball: "../local.tgz", integrity: "sha512-retained" };
  assert.throws(() => project(local), /cannot relocate local package resolution/u);
});
