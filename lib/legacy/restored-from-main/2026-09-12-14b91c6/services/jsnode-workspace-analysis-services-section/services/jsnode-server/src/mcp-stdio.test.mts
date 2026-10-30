import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * Drives the compiled CLI's `mcp` subcommand as a real child process, talking
 * newline-delimited JSON-RPC over its stdio — the same framing the MCP SDK's
 * StdioServerTransport/StdioClientTransport pair use — rather than importing
 * anything in-process. This is the transport contract itself under test: no
 * HTTP port is ever bound.
 *
 * Every session here runs over a small temp fixture, never the real
 * workspace root: this suite verifies the stdio JSON-RPC framing and the
 * server's own tool surface, neither of which needs a real 270k-file scan,
 * and pointing a freshly spawned process at the live repo cost minutes under
 * ordinary concurrent load (a real hang, observed directly, on 2026-09-11).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Compiled test files land at <package>/.tmp/test-dist/*.test.mjs (tsconfig.test.json:
// rootDir "src", outDir ".tmp/test-dist"), so two levels up from here is the package root.
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");
const CLI_PATH = path.join(PACKAGE_ROOT, "dist", "cli.mjs");

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly result?: any;
  readonly error?: any;
}

/** One long-lived `jsnode-server mcp` child process, driven by hand-framed
 *  newline-delimited JSON-RPC requests, matching responses back to callers by
 *  request id. */
class StdioSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (response: JsonRpcResponse) => void>();
  private readonly stderrChunks: Buffer[] = [];

  constructor(root: string) {
    this.child = spawn(process.execPath, [CLI_PATH, "mcp", "--root", root], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.on("data", (chunk: Buffer) => { this.stderrChunks.push(chunk); });
    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      if (line.trim().length === 0) return;
      let message: JsonRpcResponse;
      try {
        message = JSON.parse(line) as JsonRpcResponse;
      } catch {
        return;
      }
      const resolve = this.pending.get(message.id as number);
      if (resolve !== undefined) {
        this.pending.delete(message.id as number);
        resolve(message);
      }
    });
  }

  async request(id: number, method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const response = new Promise<JsonRpcResponse>((resolve) => this.pending.set(id, resolve));
    const line = `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) })}\n`;
    this.child.stdin.write(line);
    return response;
  }

  stderrText(): string {
    return Buffer.concat(this.stderrChunks).toString("utf8");
  }

  close(): void {
    this.child.kill();
  }
}

let sharedSession: StdioSession | undefined;
let sharedFixtureRoot: string | undefined;

/** A small, deterministic two-package fixture: enough for `jsnode_query` to
 *  return real, non-empty results without ever touching the real workspace. */
function ensureSession(): StdioSession {
  if (sharedSession === undefined) {
    sharedFixtureRoot = mkdtempSync(path.join(tmpdir(), "jsnode-mcp-stdio-fixture-"));
    for (const name of ["alpha", "beta"]) {
      const dir = path.join(sharedFixtureRoot, name);
      mkdirSync(dir);
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({
        name: `@test/${name}`, version: "1.0.0", exports: "./index.mjs", dependencies: {},
      }));
      writeFileSync(path.join(dir, "index.mjs"), "export function noop() {}");
    }
    sharedSession = new StdioSession(sharedFixtureRoot);
  }
  return sharedSession;
}

after(() => {
  sharedSession?.close();
  if (sharedFixtureRoot !== undefined) rmSync(sharedFixtureRoot, { recursive: true, force: true });
});

describe("jsnode-server stdio MCP transport (real child process, no HTTP port)", () => {
  it("forwards receiver evidence while excluding generated copies and inverse codecs", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "jsnode-mcp-duplication-"));
    let session: StdioSession | undefined;
    try {
      for (const name of ["core", "consumer"]) {
        const dir = path.join(root, name);
        mkdirSync(dir);
        writeFileSync(path.join(dir, "package.json"), JSON.stringify({
          name: `@test/${name}`, version: "1.0.0", exports: "./index.mjs",
          dependencies: name === "consumer" ? { "@test/core": "1.0.0" } : {},
          scripts: { test: "node --test" },
        }));
        writeFileSync(path.join(dir, "index.mjs"), "export function shared(value) { return value.trim().toUpperCase(); }");
      }
      writeFileSync(path.join(root, "core", "codec.mjs"), "export function encode(raw) { return Buffer.from(raw, 'utf8').toString('hex'); }\nexport function decode(atom) { return Buffer.from(atom, 'hex').toString('utf8'); }");
      writeFileSync(path.join(root, "consumer", "projected.mjs"), "// @generated\nexport function shared(value) { return value.trim().toUpperCase(); }");
      session = new StdioSession(root);
      const response = await session.request(20, "tools/call", { name: "jsnode_duplication", arguments: { minimumBytes: 1 } });
      assert.equal(response.error, undefined, session.stderrText());
      assert.notEqual(response.result.isError, true);
      const payload = JSON.parse(response.result.content[0].text);
      assert.equal(payload.candidateCount, 1);
      assert.equal(payload.artifactSourceFilesExcluded, 1);
      assert.equal(payload.candidates[0].implementations.length, 2);
      assert.equal(payload.candidates[0].owner, "@test/core");
      assert.equal(payload.candidates[0].ownerEvidence[0].verification, "source-manifest-only");
      assert.equal(payload.candidates[0].ownerEvidence[0].exports, "./index.mjs");
    } finally {
      session?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("initialize reports the bumped serverInfo.version over stdio", async () => {
    const session = ensureSession();
    const response = await session.request(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "jsnode-server-stdio-test", version: "0.0.0" },
    });
    assert.equal(response.error, undefined, session.stderrText());
    assert.equal(response.result.serverInfo.name, "jsnode-server");
    assert.equal(response.result.serverInfo.version, "0.4.0");
  });

  it("tools/list exposes exactly the 18 jsnode tools", async () => {
    const session = ensureSession();
    const response = await session.request(2, "tools/list");
    assert.equal(response.error, undefined, session.stderrText());
    const names = (response.result.tools as { name: string }[]).map((t) => t.name);
    for (const expected of [
      "jsnode_search",
      "jsnode_package",
      "jsnode_atlas",
      "jsnode_domains",
      "jsnode_analysis",
      "jsnode_typeflow",
      "jsnode_typeflow_type",
      "jsnode_types",
      "jsnode_functions",
      "jsnode_duplication",
      "jsnode_duplication_migration",
      "jsnode_query",
      "jsnode_status",
      "jsnode_refresh",
      "jsnode_term",
      "jsnode_section",
      "jsnode_fabrication_records",
    ]) {
      assert.ok(names.includes(expected), `expected tool ${expected} in ${JSON.stringify(names)}`);
    }
    assert.equal(names.length, 18);
    assert.ok(names.includes("jsnode_context"));
  });

  it("tools/call jsnode_query over stdio returns count and packages", async () => {
    const session = ensureSession();
    const response = await session.request(3, "tools/call", {
      name: "jsnode_query",
      arguments: { limit: 5 },
    });
    assert.equal(response.error, undefined, session.stderrText());
    assert.notEqual(response.result.isError, true, JSON.stringify(response.result));
    const payload = JSON.parse(response.result.content[0].text) as { count: number; packages: readonly unknown[] };
    assert.equal(payload.count, 2, "expected exactly the two-package fixture");
    assert.ok(Array.isArray(payload.packages));
    assert.equal(payload.packages.length, 2);
  });
});
