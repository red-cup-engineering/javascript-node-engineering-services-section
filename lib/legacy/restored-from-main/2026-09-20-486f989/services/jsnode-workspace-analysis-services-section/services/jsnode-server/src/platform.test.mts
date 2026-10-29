import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWebApplication } from "@red-cup-engineering/web-application";
import { mcpResource } from "@red-cup-engineering/serve-model-context-protocol-over-http-service";
import { createJsnodeWorkspacePlatform } from "./service.mjs";

test("workspace tools and former HTTP reports execute on one retained platform", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "jsnode-platform-"));
  mkdirSync(path.join(root, "services", "alpha"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@test/root", version: "1.0.0" }));
  writeFileSync(path.join(root, "services", "alpha", "package.json"), JSON.stringify({ name: "@test/alpha", version: "1.0.0", exports: "./index.mjs" }));
  const definition = path.join(root, "services", "alpha", "index.mjs");
  writeFileSync(definition, "export function readCurrentEvidence(value) { return value; }\n" + Array.from({ length: 60 }, (_, index) => `export function sample${index}() {}`).join("\n"));
  const platform = createJsnodeWorkspacePlatform({ name: "test", root, journalRoot: root });
  const invoke = async (id: string, args: unknown) => {
    const operation = platform.operation(id)!;
    const result = await platform.execute(id, args, { allowedEffects: operation.effects });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.value;
  };
  try {
    const denied = await platform.execute("jsnode_search", { query: "alpha" });
    assert.equal(denied.ok, false);
    const invalid = await platform.execute("jsnode_search", { query: 42 }, { allowedEffects: platform.operation("jsnode_search")!.effects });
    assert.equal(invalid.ok, false);
    const status = await invoke("jsnode_status", {}) as { packages: number };
    assert.ok(status.packages >= 1);
    for (const kind of ["workspace", "graph", "grid", "quotient", "spectrum", "roles", "dependencies", "consistency", "build-order", "lifecycle", "workspace-turtle", "workspace-jsonld", "graph-svg"]) {
      assert.notEqual(await invoke("jsnode_report", { kind }), undefined, kind);
    }
    for (const kind of ["package-graph", "package-graph-svg", "package-symbols", "package-symbols-svg", "package-spectrum", "package-turtle", "package-jsonld"]) {
      assert.notEqual(await invoke("jsnode_report", { kind, name: "@test/alpha" }), undefined, kind);
    }
    for (const kind of ["domain-turtle", "domain-jsonld"]) assert.equal(typeof await invoke("jsnode_report", { kind, name: "alpha" }), "string");
    const searched = await invoke("jsnode_search", { query: "alpha" }) as { count: number };
    assert.equal(searched.count, 1);
    const functions = await invoke("jsnode_functions", { match: "readCurrentEvidence" }) as { count: number; functions: { source: { path: string; line: number }; imports: { specifier: string; name: string }[] }[] };
    assert.equal(functions.count, 1);
    assert.equal(functions.functions[0]?.source.path, definition);
    assert.equal(functions.functions[0]?.source.line, 1);
    assert.deepEqual(functions.functions[0]?.imports, [{ specifier: "@test/alpha", name: "readCurrentEvidence" }]);
    const page = await invoke("jsnode_functions", {}) as { count: number; functions: unknown[]; truncated: boolean };
    assert.equal(page.count, 61);
    assert.equal(page.functions.length, 50);
    assert.equal(page.truncated, true);
    const context = await invoke("jsnode_context", { prompt: "read current evidence", limit: 1, maxBytes: 12000 }) as { functions: { source: { path: string }; import: string }[] };
    assert.equal(context.functions[0]?.source.path, definition);
    assert.equal(context.functions[0]?.import, "@test/alpha");
    const app = createWebApplication({ platform, resources: [mcpResource({ serverInfo: { name: "fixture", version: "1" }, operations: platform.operations() })] });
    const response = await app.fetch(new Request("http://localhost/mcp", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "jsnode_search", arguments: { query: "alpha" } } }),
    }));
    assert.equal(response.status, 200);
    const wire = await response.text();
    assert.match(wire, /alpha/);
    assert.doesNotMatch(wire, /"isError":true/);
    const refreshed = await invoke("jsnode_refresh", {}) as { status: string };
    assert.equal(refreshed.status, "ok");
  } finally { await platform.close(); rmSync(root, { recursive: true, force: true }); }
});
