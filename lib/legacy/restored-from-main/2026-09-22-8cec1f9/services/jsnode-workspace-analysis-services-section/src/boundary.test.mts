import { test } from "node:test";
import assert from "node:assert/strict";
import { packageBoundaryFailures } from "./boundary.mjs";

// A package that honours the boundary: dist-only targets, built dist, no src .ts.
const ok = {
  manifest: {
    name: "@x/good",
    main: "./dist/index.mjs",
    types: "./dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs" }, "./package.json": "./package.json" },
    bin: { good: "./dist/cli.mjs" },
  },
  srcFiles: ["index.mts", "index.test.mts"],
  distFiles: ["index.mjs", "index.d.ts", "cli.mjs"],
} as const;

test("a dist-only package with built output has no boundary failures", () => {
  assert.deepEqual(packageBoundaryFailures(ok), []);
});

test("main or exports pointing at src/ or TypeScript is a failure", () => {
  const f = packageBoundaryFailures({
    manifest: { name: "@x/leaky", main: "./src/index.mts", types: "./dist/index.d.ts", exports: { ".": "./src/index.mts" } },
    srcFiles: ["index.mts"],
    distFiles: ["index.mjs", "index.d.ts"],
  });
  assert.ok(f.some((m) => m.includes("main") && m.includes("./src/index.mts")));
  assert.ok(f.some((m) => m.includes(".") && m.includes("exports source target")));
});

test("a src/ holding compiled .ts files is a failure", () => {
  const f = packageBoundaryFailures({ ...ok, srcFiles: ["index.mts", "leaked.ts"] });
  assert.ok(f.some((m) => m.startsWith("src contains .ts files")));
});

test("a dist with no built .mjs/.d.ts is a failure", () => {
  const f = packageBoundaryFailures({ ...ok, distFiles: [] });
  assert.ok(f.some((m) => m === "dist contains no .mjs files"));
  assert.ok(f.some((m) => m === "dist contains no .d.ts files"));
});

test("a bin not pointing at ./dist/*.mjs is a failure", () => {
  const f = packageBoundaryFailures({ ...ok, manifest: { ...ok.manifest, bin: { good: "./src/cli.mts" } } });
  assert.ok(f.some((m) => m.startsWith("bin good")));
});
