import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, request, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { type AddressInfo } from "node:net";

import { handler } from "@red-cup-engineering/http-server/server";

import { createJSNodeServer } from "./service.mjs";
import { JSNODE_TOOLS, jsnodeInstructions } from "./mcp.mjs";

function findRepositoryRoot(start: string): string {
  let current = path.resolve(start);
  while (!existsSync(path.join(current, ".git"))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("repository root not found");
    current = parent;
  }
  return current;
}

const REPO_ROOT = findRepositoryRoot(path.dirname(fileURLToPath(import.meta.url)));

/** Loopback request (no x-forwarded-for) → the bearer gate is skipped. Use
 *  node:http directly: bundled fetch/undici intermittently refuses a proven
 *  reachable IPv4 loopback listener in this WSL runtime. A freshly bound
 *  ephemeral listener can also briefly ECONNREFUSED right after `listening`
 *  fires in this WSL2 runtime (observed directly: `server.listening` true,
 *  `server.address()` correct, yet the very next connect is refused) — bound
 *  retries absorb that startup race for a server with no prior traffic. */
function rpcOnce(port: number, body: unknown): Promise<any> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port,
      path: "/mcp",
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

function rpcClient(port: number): (body: unknown) => Promise<any> {
  return async (body: unknown): Promise<any> => {
    const attempts = 10;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await rpcOnce(port, body);
      } catch (error) {
        const refused = error instanceof Error && (error as NodeJS.ErrnoException).code === "ECONNREFUSED";
        if (!refused || attempt === attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
      }
    }
    throw new Error("unreachable");
  };
}

let sharedServer: Server | undefined;
let sharedRpc: ((body: unknown) => Promise<any>) | undefined;
let sharedHasRoute: ((m: string) => boolean) | undefined;

async function ensureMcpServer(): Promise<void> {
  if (sharedServer !== undefined) return;
  const service = createJSNodeServer({ name: "jsnode", root: REPO_ROOT, port: 0, mcp: {} });
  await service.refresh();
  sharedHasRoute = (m: string): boolean => (service.app.resources ?? []).some((r) => r.match === m);
  const server: Server = createServer(handler(service.app));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  sharedServer = server;
  sharedRpc = rpcClient(port);
}

/** Builds jsnode-computer's own duplication-migration happy-path fixture
 *  shape (an owner exporting `canonical`, one consumer redeclaring it
 *  byte-differently with no declared dependency, one consumer redeclaring it
 *  exported and already depending on the owner — the existing dependency is
 *  what makes the candidate cross-package, consumer-backed, and thus
 *  `rank`-eligible) and a dedicated, non-shared MCP server over it, torn down
 *  after `fn` runs. */
async function withTempWorkspaceMcpServer(fn: (rpc: (body: unknown) => Promise<any>) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "jsnode-server-duplication-migration-"));
  let server: Server | undefined;
  try {
    const ownerDir = path.join(root, "owner");
    mkdirSync(path.join(ownerDir, "src"), { recursive: true });
    writeFileSync(path.join(ownerDir, "package.json"), JSON.stringify({
      name: "@fixture/owner", version: "1.2.3", exports: { ".": "./src/index.mts" }, dependencies: {},
    }, null, 2) + "\n");
    writeFileSync(path.join(ownerDir, "src/index.mts"), "export function canonical(x) { return x + 1; }\n");

    const consumerADir = path.join(root, "consumer-a");
    mkdirSync(path.join(consumerADir, "src"), { recursive: true });
    writeFileSync(path.join(consumerADir, "package.json"), JSON.stringify({
      name: "@fixture/consumer-a", version: "1.0.0", dependencies: {},
    }, null, 2) + "\n");
    writeFileSync(path.join(consumerADir, "src/index.mts"), "function canonical(value) { return value + 1; }\n");

    const consumerBDir = path.join(root, "consumer-b");
    mkdirSync(path.join(consumerBDir, "src"), { recursive: true });
    writeFileSync(path.join(consumerBDir, "package.json"), JSON.stringify({
      name: "@fixture/consumer-b", version: "1.0.0", dependencies: { "@fixture/owner": "1.2.3" },
    }, null, 2) + "\n");
    writeFileSync(path.join(consumerBDir, "src/index.mts"), "export function canonical(x) { return x + 1; }\n");

    const service = createJSNodeServer({ name: "jsnode", root, port: 0, mcp: {} });
    await service.refresh();
    server = createServer(handler(service.app));
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await fn(rpcClient(port));
  } finally {
    if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}

async function withQueryFixtureMcpServer(fn: (rpc: (body: unknown) => Promise<any>) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "jsnode-server-query-fixture-"));
  let server: Server | undefined;
  try {
    const site = path.join(root, "lib/fixture/sites/ledger-site");
    const library = path.join(root, "lib/fixture/lib/ordinary-library");
    for (const [directory, name, dependencies] of [[site, "@fixture/ledger-site", { "@red-cup-engineering/web-tufte-gui-services-section": "0.11.0" }], [library, "@fixture/ordinary-library", {}]] as const) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0", dependencies }, null, 2));
    }
    const service = createJSNodeServer({ name: "jsnode", root, port: 0, mcp: {} });
    await service.refresh();
    server = createServer(handler(service.app));
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    await fn(rpcClient((server.address() as AddressInfo).port));
  } finally {
    if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}

/** A temp workspace exercising jsnode_term/jsnode_section/jsnode_fabrication_records
 *  together: one section with a modern glossary term, a narrower child
 *  section (to rank above a broader cousin), and a fabrication work order
 *  plus receipt joined to a real workspace package. */
async function withGlossarySectionFabricationFixtureMcpServer(fn: (rpc: (body: unknown) => Promise<any>) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "jsnode-server-discovery-fixture-"));
  let server: Server | undefined;
  try {
    const scienceSection = path.join(root, "lib/emsenn/services/561-group/services/fixture-science-services-section");
    mkdirSync(path.join(scienceSection, "content/text/glossary/terms"), { recursive: true });
    writeFileSync(path.join(scienceSection, "README.md"), "# Fixture Science Services Section\n\nFixture theory, for tests only.\n");
    writeFileSync(
      path.join(scienceSection, "content/text/glossary/terms/glossary-fixture-term.md"),
      ["---", "identity: glossary-fixture-term", "name: glossary fixture term", "aliases:", "  - gft", "---", "", "Body.", ""].join("\n"),
    );

    const childSection = path.join(scienceSection, "services/fixture-glossary-science-services-section");
    mkdirSync(childSection, { recursive: true });
    writeFileSync(path.join(childSection, "README.md"), "# Fixture Glossary Science Services Section\n\nA narrow fixture section about glossary science.\n");

    const broaderSection = path.join(root, "lib/emsenn/services/561-group/services/fixture-science-broader-cousin-services-section");
    mkdirSync(broaderSection, { recursive: true });
    writeFileSync(path.join(broaderSection, "README.md"), "# Fixture Science Broader Cousin Services Section\n\nA cousin section.\n");

    const fabSection = path.join(root, "lib/emsenn/services/561-group/services/fixture-fab-services-section");
    const specDir = path.join(fabSection, "content/text/documents/articles/specifications");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(path.join(specDir, "fixture-op.md"), "# fixture-op\n## Requirements\n- test: a fixture requirement.\n");
    const recordsDir = path.join(fabSection, "data/records");
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(
      path.join(recordsDir, "2026-09-04-fixture-op-fabrication-receipt.json"),
      JSON.stringify({
        jsnodeOperationPackageCreationReceipt: { packageName: "@fixture/fixture-op-service", packageVersion: "0.1.0" },
      }, null, 2),
    );
    const opServiceDir = path.join(fabSection, "services/fixture-op-service");
    mkdirSync(opServiceDir, { recursive: true });
    writeFileSync(path.join(opServiceDir, "package.json"), JSON.stringify({ name: "@fixture/fixture-op-service", version: "0.1.0" }, null, 2) + "\n");

    const service = createJSNodeServer({ name: "jsnode", root, port: 0, mcp: {} });
    await service.refresh();
    server = createServer(handler(service.app));
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await fn(rpcClient(port));
  } finally {
    if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}

async function withMcpServer(fn: (rpc: (body: unknown) => Promise<any>, hasRoute: (m: string) => boolean) => Promise<void>): Promise<void> {
  await ensureMcpServer();
  await fn(sharedRpc!, sharedHasRoute!);
}

after(async () => {
  if (sharedServer !== undefined) {
    await new Promise<void>((resolve) => sharedServer!.close(() => resolve()));
  }
});

describe("jsnode-server MCP capability", () => {
  it("is absent unless config.mcp is set", () => {
    const without = createJSNodeServer({ name: "jsnode", root: REPO_ROOT, port: 0 });
    assert.ok(!(without.app.resources ?? []).some((r) => r.match === "/mcp"), "no /mcp without config.mcp");
    const withMcp = createJSNodeServer({ name: "jsnode", root: REPO_ROOT, port: 0, mcp: {} });
    assert.ok((withMcp.app.resources ?? []).some((r) => r.match === "/mcp"), "/mcp present with config.mcp");
  });

  it("initialize advertises the jsnode server and instructions", async () => {
    await withMcpServer(async (rpc) => {
      const { status, json } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" });
      assert.equal(status, 200);
      assert.equal(json.result.serverInfo.name, "jsnode");
      assert.equal(json.result.serverInfo.version, "0.4.0");
      assert.match(json.result.instructions, /workspace package graph/);
    });
  });

  it("tools/list exposes the jsnode tool surface", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      const names = (json.result.tools as { name: string }[]).map((t) => t.name);
      for (const expected of ["jsnode_search", "jsnode_package", "jsnode_atlas", "jsnode_typeflow_type", "jsnode_duplication", "jsnode_duplication_migration", "jsnode_query", "jsnode_status", "jsnode_refresh"]) {
        assert.ok(names.includes(expected), `expected tool ${expected}`);
      }
    });
  });

  it("tools/call jsnode_duplication returns consumer-aware semantic candidates", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 32, method: "tools/call", params: { name: "jsnode_duplication", arguments: { scope: "jsnode-workspace-analysis", minimumBytes: 80, limit: 2 } } });
      assert.notEqual(json.result.isError, true);
      const payload = JSON.parse(json.result.content[0].text) as { candidateCount: number; candidates: Array<{ classification: string; consumers: string[]; ownerEvidence: Array<{ verification: string }> }> };
      assert.equal(typeof payload.candidateCount, "number");
      assert.ok(payload.candidates.length <= 2);
      assert.ok(payload.candidates.every((candidate) => candidate.classification === "semantic-duplication" && Array.isArray(candidate.consumers)));
      assert.ok(payload.candidates.length > 0, "the actual workspace provides a nonempty downstream assay");
      assert.ok(payload.candidates.every((candidate) => Array.isArray(candidate.ownerEvidence)
        && candidate.ownerEvidence.every((evidence) => evidence.verification === "source-manifest-only")));
    });
  });

  it("tools/call jsnode_duplication pages ranked candidates with limit/offset while candidateCount stays the full total", async () => {
    await withMcpServer(async (rpc) => {
      const all = await rpc({ jsonrpc: "2.0", id: 38, method: "tools/call", params: { name: "jsnode_duplication", arguments: { scope: "jsnode-workspace-analysis", minimumBytes: 80, limit: 1000 } } });
      const allPayload = JSON.parse(all.json.result.content[0].text) as { candidateCount: number; candidates: Array<{ semanticFingerprint: string }> };
      assert.ok(allPayload.candidateCount >= 2, "this scope should have at least 2 candidates to page over");

      const firstPage = await rpc({ jsonrpc: "2.0", id: 39, method: "tools/call", params: { name: "jsnode_duplication", arguments: { scope: "jsnode-workspace-analysis", minimumBytes: 80, limit: 1 } } });
      const firstPayload = JSON.parse(firstPage.json.result.content[0].text) as { candidateCount: number; candidates: Array<{ semanticFingerprint: string }> };
      assert.equal(firstPayload.candidateCount, allPayload.candidateCount, "candidateCount reports the full total regardless of limit");
      assert.deepEqual(firstPayload.candidates.map((c) => c.semanticFingerprint), allPayload.candidates.slice(0, 1).map((c) => c.semanticFingerprint));

      const secondPage = await rpc({ jsonrpc: "2.0", id: 40, method: "tools/call", params: { name: "jsnode_duplication", arguments: { scope: "jsnode-workspace-analysis", minimumBytes: 80, limit: 1, offset: 1 } } });
      const secondPayload = JSON.parse(secondPage.json.result.content[0].text) as { candidateCount: number; candidates: Array<{ semanticFingerprint: string }> };
      assert.equal(secondPayload.candidateCount, allPayload.candidateCount, "offset does not change the reported total");
      assert.deepEqual(secondPayload.candidates.map((c) => c.semanticFingerprint), allPayload.candidates.slice(1, 2).map((c) => c.semanticFingerprint));
    });
  });

  it("tools/call jsnode_duplication caps a candidate's implementations by default and lifts the cap with detail:true", async () => {
    await withMcpServer(async (rpc) => {
      const compact = await rpc({ jsonrpc: "2.0", id: 41, method: "tools/call", params: { name: "jsnode_duplication", arguments: { scope: "jsnode-workspace-analysis", minimumBytes: 80 } } });
      const compactPayload = JSON.parse(compact.json.result.content[0].text) as {
        candidates: Array<{ semanticFingerprint: string; implementations: unknown[]; implementationCount: number }>;
      };
      assert.ok(compactPayload.candidates.length > 0, "the actual workspace provides a nonempty downstream assay");
      for (const candidate of compactPayload.candidates) {
        assert.ok(candidate.implementations.length <= 5, "default detail:false caps implementations");
        assert.ok(candidate.implementationCount >= candidate.implementations.length, "implementationCount is never smaller than the (possibly capped) array");
      }

      const full = await rpc({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "jsnode_duplication", arguments: { scope: "jsnode-workspace-analysis", minimumBytes: 80, detail: true } } });
      const fullPayload = JSON.parse(full.json.result.content[0].text) as {
        candidates: Array<{ semanticFingerprint: string; implementations: unknown[]; implementationCount: number }>;
      };
      for (const candidate of fullPayload.candidates) {
        assert.equal(candidate.implementations.length, candidate.implementationCount, "detail:true reports every implementation site");
      }
    });
  });

  it("tools/call jsnode_duplication_migration refuses with a datum, not a thrown error, when neither fingerprint nor rank is given", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 33, method: "tools/call", params: { name: "jsnode_duplication_migration", arguments: {} } });
      assert.notEqual(json.result.isError, true, JSON.stringify(json.result));
      const payload = JSON.parse(json.result.content[0].text) as { kind: string; reason: string };
      assert.equal(payload.kind, "jsnode.duplication-migration.refusal");
      assert.equal(payload.reason, "missing-selector");
    });
  });

  it("tools/call jsnode_duplication_migration plans a migration over a temp workspace fixture", async () => {
    await withTempWorkspaceMcpServer(async (rpc) => {
      const { json } = await rpc({
        jsonrpc: "2.0",
        id: 34,
        method: "tools/call",
        params: { name: "jsnode_duplication_migration", arguments: { rank: 1, owner: "@fixture/owner", minimumBytes: 1 } },
      });
      assert.notEqual(json.result.isError, true, JSON.stringify(json.result));
      const payload = JSON.parse(json.result.content[0].text) as {
        kind: string;
        applicable: boolean;
        refusals: readonly unknown[];
        owner: string | null;
      };
      assert.equal(payload.kind, "jsnode.duplication-migration.plan");
      assert.equal(typeof payload.applicable, "boolean");
      assert.ok(Array.isArray(payload.refusals));
      assert.equal(payload.owner, "@fixture/owner");
      assert.equal(payload.applicable, true);
      assert.deepEqual(payload.refusals, []);
    });
  });

  it("tools/call jsnode_search returns ranked matches from the live workspace", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "jsnode_search", arguments: { query: "jsnode" } } });
      assert.notEqual(json.result.isError, true);
      const payload = JSON.parse(json.result.content[0].text) as { count: number; matches: { name: string }[] };
      assert.ok(payload.count > 0, "expected at least one match for 'jsnode'");
      assert.ok(payload.matches.some((m) => m.name.includes("jsnode")));
    });
  });

  it("tools/call jsnode_search falls back to any-term ranking when no field carries every query term", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 32, method: "tools/call", params: { name: "jsnode_search", arguments: { query: "bibliography citation csl" } } });
      assert.notEqual(json.result.isError, true);
      const payload = JSON.parse(json.result.content[0].text) as {
        count: number;
        matches: Array<{ name: string; field: string; reasons: string[] }>;
      };
      assert.ok(payload.count > 0, "the strict all-term match finds nothing for this three-word query, but the any-term fallback should not");
      const bibliography = payload.matches.find((match) => match.name === "@red-cup-engineering/bibliography-engineering-services-section");
      assert.ok(bibliography, "the bibliography package should surface through the any-term fallback");
      assert.equal(bibliography.field, "any-term");
      assert.match(bibliography.reasons.join(" "), /matches \d+ of \d+ terms/);
    });
  });

  it("tools/call jsnode_search explains ownership, consumers, and the delivery evidence boundary", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "jsnode_search", arguments: { query: "cell-graph" } } });
      assert.notEqual(json.result.isError, true);
      const payload = JSON.parse(json.result.content[0].text) as {
        matches: Array<{
          name: string;
          reasons: string[];
          consumers: string[];
          consumerDeclarations: Array<{ package: string; kind: string; range: string }>;
          paths: { classification: string; sourceOnly: boolean | null; source: { status: string } };
        }>;
      };
      // The contract under test is the match shape, never the live tree's contents: a keyword
      // search returns ranked matches whose reasons explain the match, whose consumers come from
      // source-declared dependency edges, and whose delivery paths keep source evidence distinct
      // from published, installed, and live assays.
      assert.ok(payload.matches.length > 0, "a package keyword should find at least one match");
      const match = payload.matches[0]!;
      assert.ok(match.reasons.length > 0);
      assert.ok(Array.isArray(match.consumers));
      assert.ok(match.consumerDeclarations.every((edge) => typeof edge.package === "string" && typeof edge.kind === "string" && typeof edge.range === "string"));
      assert.equal(match.paths.source.status, "observed");
      assert.ok(["source-with-unassayed-delivery", "source-only", "delivered"].includes(match.paths.classification));
    });
  });

  it("tools/call jsnode_search pages ranked matches with limit/offset while count stays the full total", async () => {
    await withMcpServer(async (rpc) => {
      const all = await rpc({ jsonrpc: "2.0", id: 33, method: "tools/call", params: { name: "jsnode_search", arguments: { query: "jsnode", limit: 1000 } } });
      const allPayload = JSON.parse(all.json.result.content[0].text) as { count: number; matches: { name: string }[] };
      assert.ok(allPayload.count >= 10, "the fixture query should have at least 10 total matches to page over");

      const page = await rpc({ jsonrpc: "2.0", id: 34, method: "tools/call", params: { name: "jsnode_search", arguments: { query: "jsnode" } } });
      const pagePayload = JSON.parse(page.json.result.content[0].text) as { count: number; matches: { name: string }[] };
      assert.equal(pagePayload.count, allPayload.count, "count reports the full total regardless of limit");
      assert.equal(pagePayload.matches.length, 10, "default limit is 10");
      assert.deepEqual(pagePayload.matches, allPayload.matches.slice(0, 10));

      const offsetPage = await rpc({ jsonrpc: "2.0", id: 35, method: "tools/call", params: { name: "jsnode_search", arguments: { query: "jsnode", limit: 3, offset: 3 } } });
      const offsetPayload = JSON.parse(offsetPage.json.result.content[0].text) as { matches: { name: string }[] };
      assert.deepEqual(offsetPayload.matches, allPayload.matches.slice(3, 6));
    });
  });

  it("tools/call jsnode_search caps a match's consumer detail by default and lifts the cap with detail:true", async () => {
    await withMcpServer(async (rpc) => {
      const compact = await rpc({ jsonrpc: "2.0", id: 36, method: "tools/call", params: { name: "jsnode_search", arguments: { query: "semantic-content-identify" } } });
      const compactPayload = JSON.parse(compact.json.result.content[0].text) as {
        matches: Array<{ name: string; consumerDeclarations: unknown[]; consumerDeclarationsTotal?: number }>;
      };
      const compactMatch = compactPayload.matches.find((m) => m.name === "@red-cup-engineering/semantic-content-identify-service");
      assert.ok(compactMatch, "the semantic-content-identify-service package should surface");
      assert.ok(compactMatch.consumerDeclarations.length <= 20, "default detail:false caps consumerDeclarations");
      assert.ok((compactMatch.consumerDeclarationsTotal ?? 0) > 20, "the full count is reported when the cap truncates");

      const full = await rpc({ jsonrpc: "2.0", id: 37, method: "tools/call", params: { name: "jsnode_search", arguments: { query: "semantic-content-identify", detail: true } } });
      const fullPayload = JSON.parse(full.json.result.content[0].text) as {
        matches: Array<{ name: string; consumerDeclarations: unknown[]; consumerDeclarationsTotal?: number }>;
      };
      const fullMatch = fullPayload.matches.find((m) => m.name === "@red-cup-engineering/semantic-content-identify-service");
      assert.ok(fullMatch);
      assert.equal(fullMatch.consumerDeclarationsTotal, undefined, "detail:true reports the uncapped array with no *Total field");
      assert.equal(fullMatch.consumerDeclarations.length, compactMatch.consumerDeclarationsTotal);
    });
  });

  it("tools/call jsnode_package reports a tool error for an unknown package", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "jsnode_package", arguments: { name: "@nope/does-not-exist" } } });
      assert.equal(json.result.isError, true);
      assert.match(json.result.content[0].text, /package not found/);
    });
  });

  it("tools/call jsnode_query: keyword-contains finds a known-tagged package", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "jsnode_query", arguments: { tag: "eavt" } } });
      assert.notEqual(json.result.isError, true);
      const payload = JSON.parse(json.result.content[0].text) as { count: number; packages: { name: string }[] };
      assert.ok(payload.count > 0, "expected at least one package tagged eavt");
      assert.ok(payload.packages.some((p) => p.name === "@red-cup-engineering/computer"));
      // default `return` is just the name field
      assert.deepEqual(Object.keys(payload.packages[0]!), ["name"]);
    });
  });

  it("MCP guidance offers duplication analysis without making it a required query route", () => {
    const duplication = JSNODE_TOOLS.find((tool) => tool.name === "jsnode_duplication");
    assert.ok(duplication);
    assert.doesNotMatch(duplication.description ?? "", /Use this before manual semantic-dedup searches or agent dispatch/);
    assert.doesNotMatch(jsnodeInstructions("jsnode"), /jsnode_duplication before semantic-dedup work/);
  });

  it("tools/call jsnode_query: scope filter matches exactly one scope", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "jsnode_query", arguments: { scope: "@561-group", return: ["name", "scope"] } } });
      assert.notEqual(json.result.isError, true);
      const payload = JSON.parse(json.result.content[0].text) as { count: number; packages: { name: string; scope: string }[] };
      assert.ok(payload.count > 0, "expected at least one @561-group package");
      assert.ok(payload.packages.every((p) => p.scope === "@561-group"));
      assert.ok(payload.packages.every((p) => p.name.startsWith("@561-group/")));
    });
  });

  it("tools/call jsnode_query: `return` projects only the requested fields", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "jsnode_query", arguments: { name: "jsnode-server", return: ["name", "layer", "description"] } } });
      assert.notEqual(json.result.isError, true);
      const payload = JSON.parse(json.result.content[0].text) as { count: number; packages: Record<string, unknown>[] };
      assert.ok(payload.count > 0);
      for (const pkg of payload.packages) {
        assert.deepEqual(Object.keys(pkg).sort(), ["description", "layer", "name"]);
      }
    });
  });

  it("tools/call jsnode_query: no match returns count 0, not an error", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "jsnode_query", arguments: { name: "no-such-package-in-this-workspace-xyz" } } });
      assert.notEqual(json.result.isError, true);
      const payload = JSON.parse(json.result.content[0].text) as { count: number; packages: unknown[] };
      assert.equal(payload.count, 0);
      assert.deepEqual(payload.packages, []);
    });
  });

  it("tools/call jsnode_query: an unknown `return` field is rejected, not silently ignored", async () => {
    await withMcpServer(async (rpc) => {
      // The MCP transport enforces the tool's inputSchema enum before dispatch
      // ever runs, so this is caught at the schema gate; packageQueryPayload's
      // own `unknown return field` check (service.mts) is the same guarantee
      // for any caller that reaches it directly, bypassing that gate.
      const { json } = await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "jsnode_query", arguments: { return: ["not-a-real-field"] } } });
      assert.equal(json.result.isError, true);
      assert.match(json.result.content[0].text, /return/);
    });
  });

  it("tools/call jsnode_query: `limit` caps `packages` without changing `count`", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "jsnode_query", arguments: { layer: "lib", limit: 1 } } });
      assert.notEqual(json.result.isError, true);
      const payload = JSON.parse(json.result.content[0].text) as { count: number; packages: unknown[] };
      assert.equal(payload.packages.length, 1);
      assert.ok(payload.count >= 1);
    });
  });

  it("tools/call jsnode_query finds a nested sites package by direct TUFTE dependency and projects its path", async () => {
    await withQueryFixtureMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "jsnode_query", arguments: { pathContains: "/sites/", dependsOn: "@red-cup-engineering/web-tufte-gui-services-section", return: ["name", "layer", "path"] } } });
      assert.notEqual(json.result.isError, true);
      const payload = JSON.parse(json.result.content[0].text) as { count: number; packages: { name: string; layer: string; path: string }[] };
      assert.equal(payload.count, 1);
      assert.deepEqual(payload.packages, [{ name: "@fixture/ledger-site", layer: "lib", path: "lib/fixture/sites/ledger-site" }]);
    });
  });

  it("tools/call jsnode_query selects packages that lack a direct dependency", async () => {
    await withQueryFixtureMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "jsnode_query", arguments: { pathContains: "/lib/", lacksDependency: "@red-cup-engineering/web-tufte-gui-services-section", return: ["name", "dependencies"], limit: 1 } } });
      assert.notEqual(json.result.isError, true);
      const payload = JSON.parse(json.result.content[0].text) as { count: number; packages: { name: string; dependencies: string[] }[] };
      assert.equal(payload.count, 1);
      assert.deepEqual(payload.packages, [{ name: "@fixture/ordinary-library", dependencies: [] }]);
    });
  });

  it("tools/call jsnode_status reports freshness fields", async () => {
    await withMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 40, method: "tools/call", params: { name: "jsnode_status", arguments: {} } });
      assert.notEqual(json.result.isError, true);
      const payload = JSON.parse(json.result.content[0].text) as {
        status: string; packages: number; root: string; lastRefreshedAt: string | null; refreshIntervalSeconds: number | null;
      };
      assert.equal(payload.status, "ok");
      assert.ok(payload.packages > 0);
      assert.equal(payload.root, REPO_ROOT);
      assert.equal(typeof payload.lastRefreshedAt, "string", "ensureMcpServer already called refresh()");
    });
  });

  it("tools/call jsnode_refresh re-reads the workspace and reports a newer lastRefreshedAt", async () => {
    await withMcpServer(async (rpc) => {
      const before = await rpc({ jsonrpc: "2.0", id: 41, method: "tools/call", params: { name: "jsnode_status", arguments: {} } });
      const beforePayload = JSON.parse(before.json.result.content[0].text) as { lastRefreshedAt: string };
      await new Promise((resolve) => setTimeout(resolve, 5));
      const after = await rpc({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "jsnode_refresh", arguments: {} } });
      assert.notEqual(after.json.result.isError, true);
      const afterPayload = JSON.parse(after.json.result.content[0].text) as { status: string; packages: number; lastRefreshedAt: string };
      assert.equal(afterPayload.status, "ok");
      assert.ok(afterPayload.packages > 0);
      assert.ok(
        new Date(afterPayload.lastRefreshedAt).getTime() > new Date(beforePayload.lastRefreshedAt).getTime(),
        "jsnode_refresh should advance lastRefreshedAt",
      );
    });
  });

  it("tools/call jsnode_term resolves a fixture glossary term over a temp workspace", async () => {
    await withGlossarySectionFabricationFixtureMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 50, method: "tools/call", params: { name: "jsnode_term", arguments: { name: "gft" } } });
      assert.notEqual(json.result.isError, true, JSON.stringify(json.result));
      const payload = JSON.parse(json.result.content[0].text) as { count: number; matches: Array<{ kind: string; matchedBy: string; admitted: boolean | null }> };
      assert.equal(payload.count, 1);
      assert.equal(payload.matches[0]?.kind, "term");
      assert.equal(payload.matches[0]?.matchedBy, "alias");
      assert.equal(typeof payload.matches[0]?.admitted, "boolean");
    });
  });

  it("tools/call jsnode_section ranks the exact-word section first over a temp workspace", async () => {
    await withGlossarySectionFabricationFixtureMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 51, method: "tools/call", params: { name: "jsnode_section", arguments: { query: "fixture glossary science" } } });
      assert.notEqual(json.result.isError, true, JSON.stringify(json.result));
      const payload = JSON.parse(json.result.content[0].text) as { count: number; sections: Array<{ name: string; sectionForm: unknown }> };
      assert.ok(payload.count > 0);
      assert.equal(payload.sections[0]?.name, "fixture-glossary-science-services-section");
      assert.ok(payload.sections[0]?.sectionForm !== undefined);
    });
  });

  it("tools/call jsnode_fabrication_records lists the fixture work order joined to its package", async () => {
    await withGlossarySectionFabricationFixtureMcpServer(async (rpc) => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 52, method: "tools/call", params: { name: "jsnode_fabrication_records", arguments: {} } });
      assert.notEqual(json.result.isError, true, JSON.stringify(json.result));
      const payload = JSON.parse(json.result.content[0].text) as { workOrders: Array<{ artifactId: string }>; receipts: Array<{ packageName: string; package: unknown }> };
      assert.ok(payload.workOrders.some((wo) => wo.artifactId === "fixture-op"));
      const receipt = payload.receipts.find((r) => r.packageName === "@fixture/fixture-op-service");
      assert.ok(receipt);
      assert.ok(receipt?.package !== null, "the receipt's packageName should join to the workspace package graph");
    });
  });
});
