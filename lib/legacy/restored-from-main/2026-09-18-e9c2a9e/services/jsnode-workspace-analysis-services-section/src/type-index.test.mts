import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { workspaceTypeIndex } from "./type-index.mjs";
import { workspaceTypeFlow } from "./type-flow.mjs";

let root: string;

function pkg(dir: string, name: string, declarations: Record<string, string>): void {
  const packageDir = path.join(root, "packages", dir);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name, version: "0.0.0" }),
    "utf8",
  );
  for (const [relative, source] of Object.entries(declarations)) {
    const file = path.join(packageDir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source, "utf8");
  }
}

before(() => {
  root = mkdtempSync(path.join(tmpdir(), "workspace-type-index-"));
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
  pkg("module", "@x/module", {
    "dist/types/module.d.mts": `
      export interface ModuleInput { value: string; }
      export interface ModuleOutput { value: string; }
      export declare function moduleTransform(input: ModuleInput): ModuleOutput;
    `,
  });
  pkg("commonjs", "@x/commonjs", {
    "dist/types/commonjs.d.cts": `
      export interface CommonInput { value: number; }
      export interface CommonOutput { value: number; }
      export declare function commonTransform(input: CommonInput): CommonOutput;
    `,
  });
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workspaceTypeIndex declaration discovery", () => {
  it("includes .d.mts and .d.cts exported APIs in the workspace type graph", () => {
    const index = workspaceTypeIndex(root);
    assert.deepEqual(
      index.types.map((type) => type.name).sort(),
      ["CommonInput", "CommonOutput", "ModuleInput", "ModuleOutput"],
    );
    assert.deepEqual(
      index.functions.map((fn) => fn.name).sort(),
      ["commonTransform", "moduleTransform"],
    );

    const graph = workspaceTypeFlow(index);
    assert.ok(graph.edges.some((edge) => edge.from === "ModuleInput" && edge.to === "ModuleOutput"));
    assert.ok(graph.edges.some((edge) => edge.from === "CommonInput" && edge.to === "CommonOutput"));
  });
});
