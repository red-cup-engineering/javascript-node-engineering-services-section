import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { processDataRootConfig } from "../src/config.mjs";

/** A fake checkout: a temp directory bearing a `.git` marker (no real git
 *  needed — the resolver only checks for the marker's presence). */
function fakeCheckout() {
  const root = mkdtempSync(path.join(tmpdir(), "node-process-data-root-config-"));
  mkdirSync(path.join(root, ".git"));
  return root;
}

function configFor(defaultRoot, envRoot) {
  return processDataRootConfig({
    defaultRoot,
    args: [],
    env: envRoot === undefined ? {} : { METROPLAT_DATA_ROOT: envRoot },
    envName: "METROPLAT_DATA_ROOT",
    configFileName: "test.config.json",
    cwd: defaultRoot,
  });
}

test("processDataRootConfig accepts an apps/<name> package directory inside a checkout", () => {
  const checkout = fakeCheckout();
  try {
    const appDir = path.join(checkout, "apps", "some-app");
    mkdirSync(appDir, { recursive: true });
    const result = configFor(appDir);
    assert.equal(result.dataRoot, appDir);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("processDataRootConfig accepts a *-services-section directory inside a checkout", () => {
  const checkout = fakeCheckout();
  try {
    const sectionDir = path.join(checkout, "widget-services-section");
    mkdirSync(sectionDir, { recursive: true });
    const result = configFor(sectionDir);
    assert.equal(result.dataRoot, sectionDir);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("processDataRootConfig refuses the checkout root itself", () => {
  const checkout = fakeCheckout();
  try {
    assert.throws(() => configFor(checkout), /is the checkout root/);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("processDataRootConfig refuses <checkout root>/data", () => {
  const checkout = fakeCheckout();
  try {
    const dataDir = path.join(checkout, "data");
    assert.throws(() => configFor(checkout, dataDir), /is <checkout root>\/data/);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("processDataRootConfig refuses a checkout directory that is neither a services-section nor an apps/<name> package", () => {
  const checkout = fakeCheckout();
  try {
    const strayDir = path.join(checkout, "some-random-directory");
    mkdirSync(strayDir, { recursive: true });
    assert.throws(() => configFor(strayDir), /not a \*-services-section or apps\/<name> package/);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("processDataRootConfig accepts any shape outside a checkout (e.g. a /tmp test fixture)", () => {
  const outside = mkdtempSync(path.join(tmpdir(), "metroplat-data-root-config-outside-"));
  try {
    const result = configFor(outside);
    assert.equal(result.dataRoot, outside);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("processDataRootConfig rejects a relative defaultRoot rather than resolving it against cwd", () => {
  assert.throws(
    () => processDataRootConfig({
      defaultRoot: "relative/data-root",
      args: [],
      env: {},
      envName: "METROPLAT_DATA_ROOT",
      configFileName: "test.config.json",
      cwd: tmpdir(),
    }),
    /must be absolute/,
  );
});
