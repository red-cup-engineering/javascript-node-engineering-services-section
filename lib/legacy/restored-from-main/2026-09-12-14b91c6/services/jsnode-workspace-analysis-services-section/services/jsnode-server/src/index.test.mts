import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { App, Context, Repr, Resource } from "@red-cup-engineering/http-server/server";
import { createJSNodeServer as createProductionJSNodeServer, jsNodeServerConfigFromManifest, type JSNodeServer, type JSNodeServerConfig } from "./service.mjs";

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

// The surface tests all assay one unchanged checkout. Holding this prepared
// server keeps the suite from repeatedly crawling and compiling the whole
// repository while leaving isolated roots (including refresh invalidation)
// independent.
const repositoryServer = createProductionJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
const refreshRepositoryServer = repositoryServer.refresh;
let repositoryRefresh: Promise<void> | undefined;
repositoryServer.refresh = () => (repositoryRefresh ??= refreshRepositoryServer());

function createJSNodeServer(config: JSNodeServerConfig): JSNodeServer {
  return config.root === REPO_ROOT ? repositoryServer : createProductionJSNodeServer(config);
}

function spectrumFixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "jsnode-server-spectrum-"));
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
  for (const [leaf, name, dependencies] of [
    ["alpha", "@test/alpha", {}],
    ["beta", "@test/beta", { "@test/alpha": "1.0.0" }],
    ["gamma", "@test/gamma", { "@test/beta": "1.0.0" }],
  ] as const) {
    const directory = path.join(root, "packages", leaf);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0", dependencies }), "utf8");
  }
  return root;
}

// Invoke a named string-matched route's handler with a minimal request context.
function callRoute(service: JSNodeServer, match: string, pathAndQuery: string): unknown {
  const resources = (service.app as App).resources ?? [];
  const resource = resources.find((r) => r.match === match);
  assert.ok(resource, `no route matched ${match}`);
  const ctx = {
    url: new URL(`http://x${pathAndQuery}`),
    params: {},
    negotiatedType: "application/json",
  } as unknown as Context;
  const repr = resource.handler(ctx) as Repr;
  return JSON.parse(String(repr.body));
}

function callParameterizedRoute(service: JSNodeServer, route: string, params: Record<string, string>, pathAndQuery: string): unknown {
  const resources = (service.app as App).resources ?? [];
  const resource = resources.find((candidate) => candidate.route === route);
  assert.ok(resource, `no route matched ${route}`);
  const ctx = {
    url: new URL(`http://x${pathAndQuery}`),
    params,
    negotiatedType: "application/json",
  } as unknown as Context;
  const repr = resource.handler(ctx) as Repr;
  return JSON.parse(String(repr.body));
}

describe("createJSNodeServer", () => {
  it("carries the standalone manifest's local MCP enablement", () => {
    const config = jsNodeServerConfigFromManifest({
      "561:jsnode-server": { name: "test", port: 18808, mcp: true },
    });
    assert.deepEqual(config.mcp, {});
  });

  it("refreshes and exposes packages in healthz handler", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const ws = service.snapshot();
    assert.ok(ws !== undefined);
    assert.ok(ws.packages.length > 10, `expected >10 packages, got ${ws.packages.length}`);
  });

  it("app has expected routes", () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    const routes = (service.app.resources ?? []).map((r) =>
      typeof r.match === "string" ? r.match : r.route ?? "(custom)",
    );
    assert.ok(routes.includes("/healthz"));
    assert.ok(routes.includes("/refresh"));
    assert.ok(routes.includes("/packages"));
    assert.ok(routes.includes("/workspace"));
    assert.ok(routes.includes("/types"));
    assert.ok(routes.includes("/functions"));
    assert.ok(routes.includes("/packages/:name/ego.svg"));
    assert.ok(routes.includes("/packages/:name/ego"));
    assert.ok(routes.includes("/packages/:name/symbols.svg"));
    assert.ok(routes.includes("/packages/:name/symbols"));
    assert.ok(routes.includes("/analysis"));
    assert.ok(routes.includes("/grid"));
    assert.ok(routes.includes("/quotient"));
    assert.ok(routes.includes("/spectrum"));
    assert.ok(routes.includes("/packages/:name/spectrum"));
  });

  it("the ego sub-route is matched before the catch-all package route", () => {
    // A path like /packages/<name>/ego.svg must hit the ego route, not be
    // swallowed by the greedy /packages/:name matcher.
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    const resources = service.app.resources ?? [];
    const egoIdx = resources.findIndex((r) => r.route === "/packages/:name/ego.svg");
    const pkgIdx = resources.findIndex((r) => r.route === "/packages/:name");
    assert.ok(egoIdx >= 0 && pkgIdx >= 0);
    assert.ok(egoIdx < pkgIdx, "sub-resource routes precede the catch-all");
  });

  it("the spectrum sub-route is matched before the catch-all package route", () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    const resources = service.app.resources ?? [];
    const specIdx = resources.findIndex((r) => r.route === "/packages/:name/spectrum");
    const pkgIdx = resources.findIndex((r) => r.route === "/packages/:name");
    assert.ok(specIdx >= 0 && pkgIdx >= 0);
    assert.ok(specIdx < pkgIdx, "sub-resource routes precede the catch-all");
  });

  it("/spectrum returns the ranked spectral field with a component cross-check", async () => {
    const root = spectrumFixtureRoot();
    try {
      const service = createJSNodeServer({ name: "test", root, port: 18808 });
      await service.refresh();
      const field = callRoute(service, "/spectrum", "/spectrum") as {
        kind: string;
        order: number;
        components: number;
        spectra: { name: string; spanningTrees: string }[];
      };
      assert.equal(field.kind, "jsnode.spectrum");
      assert.equal(field.order, 3);
      assert.equal(field.components, 1);
      // ranked by spanning-tree count, descending
      for (let i = 1; i < field.spectra.length; i++) {
        assert.ok(
          BigInt(field.spectra[i - 1]!.spanningTrees) >= BigInt(field.spectra[i]!.spanningTrees),
          "spectra are ranked by spanning-tree count",
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("/healthz reports lastRefreshedAt and the configured refreshIntervalSeconds", async () => {
    const root = spectrumFixtureRoot();
    try {
      const service = createProductionJSNodeServer({ name: "test", root, port: 18808, intervalSeconds: 60 });
      const beforeRefresh = callRoute(service, "/healthz", "/healthz") as {
        packages: number; lastRefreshedAt: string | null; refreshIntervalSeconds: number | null;
      };
      assert.equal(beforeRefresh.packages, 0);
      assert.equal(beforeRefresh.lastRefreshedAt, null, "nothing read off disk yet");
      assert.equal(beforeRefresh.refreshIntervalSeconds, 60);
      await service.refresh();
      const afterRefresh = callRoute(service, "/healthz", "/healthz") as {
        packages: number; lastRefreshedAt: string | null;
      };
      assert.equal(afterRefresh.packages, 3);
      assert.ok(afterRefresh.lastRefreshedAt !== null, "refresh() must set lastRefreshedAt");
      assert.equal(new Date(afterRefresh.lastRefreshedAt as string).toISOString(), afterRefresh.lastRefreshedAt);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("POST /refresh re-reads the workspace and advances lastRefreshedAt", async () => {
    const root = spectrumFixtureRoot();
    try {
      const service = createProductionJSNodeServer({ name: "test", root, port: 18808 });
      await service.refresh();
      const before = callRoute(service, "/healthz", "/healthz") as { lastRefreshedAt: string };
      await new Promise((resolve) => setTimeout(resolve, 5));
      const resources = (service.app as App).resources ?? [];
      const refreshRoute = resources.find((r) => r.match === "/refresh");
      assert.ok(refreshRoute, "no /refresh route registered");
      const ctx = { url: new URL("http://x/refresh"), params: {}, negotiatedType: "application/json" } as unknown as Context;
      const repr = (await refreshRoute!.handler(ctx)) as Repr;
      const after = JSON.parse(String(repr.body)) as { status: string; packages: number; lastRefreshedAt: string };
      assert.equal(after.status, "ok");
      assert.equal(after.packages, 3);
      assert.ok(new Date(after.lastRefreshedAt).getTime() > new Date(before.lastRefreshedAt).getTime());
      const healthzAfter = callRoute(service, "/healthz", "/healthz") as { lastRefreshedAt: string };
      assert.equal(healthzAfter.lastRefreshedAt, after.lastRefreshedAt, "/healthz reflects the POST /refresh it just served");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("holds graph and context on one manifest generation until refresh", async () => {
    const root = spectrumFixtureRoot();
    try {
      const service = createProductionJSNodeServer({ name: "test", root, port: 18808 });
      await service.refresh();
      const initialGraph = callParameterizedRoute(service, "/packages/:name/ego", { encodedName: encodeURIComponent("@test/alpha") }, "/packages/%40test%2Falpha/ego") as {
        nodes: { name: string }[]; edges: unknown[];
      };
      const initialContext = callRoute(service, "/context", "/context?prompt=alpha&limit=4") as {
        packages: { package: string; description: string }[]; types: unknown[]; source: { types: string };
      };
      assert.ok(initialGraph.nodes.some((node) => node.name === "@test/beta"));
      assert.equal(initialContext.packages.find((candidate) => candidate.package === "@test/alpha")?.description, "");
      assert.deepEqual(initialContext.types, []);
      assert.equal(initialContext.source.types, "unavailable");

      writeFileSync(path.join(root, "packages/alpha/package.json"), JSON.stringify({ name: "@test/alpha", version: "2.0.0", description: "refreshed alpha" }), "utf8");
      writeFileSync(path.join(root, "packages/beta/package.json"), JSON.stringify({ name: "@test/beta", version: "2.0.0", dependencies: {} }), "utf8");

      const heldGraph = callParameterizedRoute(service, "/packages/:name/ego", { encodedName: encodeURIComponent("@test/alpha") }, "/packages/%40test%2Falpha/ego") as {
        nodes: { name: string }[];
      };
      const heldContext = callRoute(service, "/context", "/context?prompt=alpha&limit=4") as {
        packages: { package: string; description: string }[]; types: unknown[]; source: { types: string };
      };
      assert.deepEqual(heldGraph, initialGraph);
      assert.deepEqual(heldContext, initialContext);

      await service.refresh();
      const refreshedGraph = callParameterizedRoute(service, "/packages/:name/ego", { encodedName: encodeURIComponent("@test/alpha") }, "/packages/%40test%2Falpha/ego") as {
        nodes: { name: string }[];
      };
      const refreshedContext = callRoute(service, "/context", "/context?prompt=alpha&limit=4") as {
        packages: { package: string; description: string }[]; types: unknown[]; source: { types: string };
      };
      assert.ok(!refreshedGraph.nodes.some((node) => node.name === "@test/beta"));
      assert.equal(refreshedContext.packages.find((candidate) => candidate.package === "@test/alpha")?.description, "refreshed alpha");
      assert.deepEqual(refreshedContext.types, []);
      assert.equal(refreshedContext.source.types, "unavailable");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Call a handler with an explicit negotiated type and params, returning the Repr.
function callHtml(service: JSNodeServer, find: (r: Resource) => boolean, opts: { type?: string; params?: Record<string, string>; pathAndQuery?: string }): Repr {
  const resources = (service.app.resources ?? []);
  const resource = resources.find(find);
  assert.ok(resource, "route not found");
  const ctx = {
    url: new URL(`http://x${opts.pathAndQuery ?? "/"}`),
    params: opts.params ?? {},
    negotiatedType: opts.type ?? "text/html",
  } as unknown as Context;
  return resource.handler(ctx) as Repr;
}

describe("human (HTML/SVG) surface", () => {
  it("GET / renders the catalog: domain cards with descriptions, not the DAG", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/", { type: "text/html" });
    const html = String(repr.body);
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes('class="cards"'), "the domain card grid is present");
    assert.ok(/href="\/domains\/jsnode"/.test(html), "a domain card links to its domain page");
    assert.ok(html.includes('id="q"'), "search box present");
    // The catalog is not the DAG: no inline graph svg on the homepage.
    assert.ok(!html.includes("<svg"), "the homepage is the catalog, not the graph");
  });

  it("GET /graph renders the DAG viewer with an inline, clickable svg", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/graph", { type: "text/html" });
    const html = String(repr.body);
    assert.ok(html.includes("<svg"), "inline svg present");
    assert.ok(/href="\/packages\/%40red-cup-engineering%2Fjsnode-topology"/.test(html), "nodes link to package pages");
  });

  it("GET /atlas returns the domain atlas as JSON for agents", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/atlas", { type: "application/json" });
    const atlas = JSON.parse(String(repr.body)) as { kind: string; domains: { domain: string }[] };
    assert.equal(atlas.kind, "jsnode.domain-atlas");
    assert.ok(atlas.domains.some((d) => d.domain === "jsnode"), "the jsnode domain is catalogued");
  });

  it("GET /domains/:domain renders one domain's page with its members", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/domains/:domain", {
      type: "text/html",
      params: { encodedDomain: "jsnode" },
    });
    const html = String(repr.body);
    assert.ok(html.includes("@red-cup-engineering/jsnode-topology"), "a member package is listed");
    assert.ok(html.includes("packages ("), "the members section is present");
  });

  it("GET /domains/:domain content-negotiates Turtle linked data", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/domains/:domain", {
      type: "text/turtle",
      params: { encodedDomain: "jsnode" },
    });
    const ttl = String(repr.body);
    assert.ok(ttl.includes("a jsnode:Domain ;"), "the domain is typed as jsnode:Domain");
    assert.ok(ttl.includes("jsnode:in-domain "), "membership edges are emitted");
  });

  it("GET /domains/:domain defaults to JSON (the catalog entry) for agents", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/domains/:domain", {
      type: "application/json",
      params: { encodedDomain: "jsnode" },
    });
    const entry = JSON.parse(String(repr.body)) as { domain: string; members: unknown[] };
    assert.equal(entry.domain, "jsnode");
    assert.ok(Array.isArray(entry.members) && entry.members.length > 0);
  });

  it("GET /domains returns the domain quotient, agreeing with the role quotient split", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/domains", { type: "application/json" });
    const q = JSON.parse(String(repr.body)) as { kind: string; withinDomainTotal: number; crossDomainTotal: number };
    assert.equal(q.kind, "jsnode.domain-quotient");
    assert.ok(q.withinDomainTotal >= 0 && q.crossDomainTotal > 0);
  });

  it("GET /roles renders the role lexicon with each role's definition", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/roles", { type: "text/html" });
    const html = String(repr.body);
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(/href="\/roles\/topology"/.test(html), "a role card links to its concept page");
    assert.ok(html.includes("settlement engine"), "the topology gloss is shown, not just the label");
  });

  it("GET /roles returns the role catalog as JSON for agents", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/roles", { type: "application/json" });
    const cat = JSON.parse(String(repr.body)) as { kind: string; roles: { role: string; gloss: string }[] };
    assert.equal(cat.kind, "jsnode.role-catalog");
    assert.ok(cat.roles.some((r) => r.role === "topology" && r.gloss.length > 0), "topology carries its gloss");
  });

  it("GET /roles/:role renders one role's concept page with its members", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/roles/:role", {
      type: "text/html",
      params: { encodedRole: "topology" },
    });
    const html = String(repr.body);
    assert.ok(html.includes("@red-cup-engineering/jsnode-topology"), "a member package is listed");
    assert.ok(html.includes("lifted faithfully from"), "the definition cites its provenance");
  });

  it("GET /roles/:role content-negotiates the role as a SKOS concept in Turtle", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/roles/:role", {
      type: "text/turtle",
      params: { encodedRole: "topology" },
    });
    const ttl = String(repr.body);
    assert.ok(ttl.includes("a skos:Concept"), "the role is typed as a skos:Concept");
    assert.ok(ttl.includes("skos:definition "), "the definition is emitted");
  });

  it("GET /roles/:role defaults to JSON (the catalog entry) for agents", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/roles/:role", {
      type: "application/json",
      params: { encodedRole: "codecs" },
    });
    const entry = JSON.parse(String(repr.body)) as { role: string; members: unknown[] };
    assert.equal(entry.role, "codecs");
    assert.ok(Array.isArray(entry.members) && entry.members.length > 0);
  });

  it("an unknown role returns a 404", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/roles/:role", {
      type: "application/json",
      params: { encodedRole: "not-a-role" },
    });
    assert.equal(repr.status, 404);
  });

  it("GET /dependencies returns the dependency report with drift, as JSON", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/dependencies", { type: "application/json" });
    const rep = JSON.parse(String(repr.body)) as { kind: string; externalCount: number; drift: unknown[] };
    assert.equal(rep.kind, "jsnode.dependencies");
    assert.ok(rep.externalCount > 0, "external registry deps are surfaced");
    assert.ok(Array.isArray(rep.drift));
  });

  it("GET /dependencies renders the report as HTML for a browser", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/dependencies", { type: "text/html" });
    const html = String(repr.body);
    assert.ok(html.includes("version drift"), "the drift section is present");
    assert.ok(html.includes("external dependencies"));
  });

  it("GET /consistency reports node engines and folds in drift, as JSON", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/consistency", { type: "application/json" });
    const c = JSON.parse(String(repr.body)) as { kind: string; nodeEngines: unknown[]; packageCount: number };
    assert.equal(c.kind, "jsnode.consistency");
    assert.ok(c.packageCount > 0 && Array.isArray(c.nodeEngines));
  });

  it("GET /build-order returns dependency-respecting tiers, as JSON", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/build-order", { type: "application/json" });
    const bo = JSON.parse(String(repr.body)) as { kind: string; tiers: string[][]; order: string[]; acyclic: boolean };
    assert.equal(bo.kind, "jsnode.build-order");
    assert.ok(bo.tiers.length > 0 && bo.order.length > 0);
    // tier 0 packages must have no internal dependencies — they come first.
    assert.ok(Array.isArray(bo.tiers[0]) && bo.tiers[0].length > 0);
  });

  it("the package page shows manifest facts and ranged dependencies", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/packages/:name", {
      type: "text/html",
      params: { encodedName: encodeURIComponent("@red-cup-engineering/jsnode-server") },
    });
    const html = String(repr.body);
    assert.ok(html.includes("dependencies (") , "the declared-dependencies table is present");
    assert.ok(/class="facts"/.test(html), "the manifest-facts strip is present");
  });

  it("GET /lifecycle returns cohorts and migration debt, as JSON", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/lifecycle", { type: "application/json" });
    const lc = JSON.parse(String(repr.body)) as { kind: string; byLifecycle: Record<string, string[]>; byMaturity: Record<string, string[]> };
    assert.equal(lc.kind, "jsnode.lifecycle");
    assert.ok(Array.isArray(lc.byLifecycle.active) && Array.isArray(lc.byMaturity.experimental));
  });

  it("GET /lifecycle renders the retirement queue as HTML", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/lifecycle", { type: "text/html" });
    const html = String(repr.body);
    assert.ok(html.includes("retirement queue"));
    assert.ok(html.includes("frozen contracts"));
  });

  it("GET /consistency exposes lifecycle counts and the exempt set", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/consistency", { type: "application/json" });
    const c = JSON.parse(String(repr.body)) as { activeCount: number; lifecycleCounts: Record<string, number>; exempt: string[] };
    assert.ok(typeof c.activeCount === "number" && c.lifecycleCounts !== undefined);
    assert.ok(Array.isArray(c.exempt));
  });

  it("GET /graph.svg serves a standalone svg document", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.match === "/graph.svg", { type: "image/svg+xml" });
    assert.ok(String(repr.type).includes("image/svg+xml"));
    assert.ok(String(repr.body).trimStart().startsWith("<svg"));
  });

  it("GET /packages/:name with Accept html renders deps, dependents and both graphs", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/packages/:name", {
      type: "text/html",
      params: { encodedName: encodeURIComponent("@red-cup-engineering/jsnode-topology") },
    });
    const html = String(repr.body);
    assert.ok(html.includes("@red-cup-engineering/jsnode-topology"));
    assert.ok(html.includes("depended on by"), "dependents section present");
    // jsnode-engineering-cli depends on jsnode-topology, so it must be listed as a dependent.
    assert.ok(html.includes("@red-cup-engineering/jsnode-engineering-cli"), "a known dependent is linked");
    // Both embedded graphs are present and pannable.
    assert.ok(html.includes("neighbourhood"), "ego graph section");
    assert.ok(html.includes("internal structure"), "symbol graph section");
    assert.ok((html.match(/class="graph-stage"/g) ?? []).length === 2, "two inline graph stages");
    assert.ok(html.includes('data-focus="true"'), "ego graph marks the focus package");
  });

  it("GET /packages/:name/ego.svg serves a focused neighbourhood svg", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/packages/:name/ego.svg", {
      type: "image/svg+xml",
      params: { encodedName: encodeURIComponent("@red-cup-engineering/jsnode-topology") },
      pathAndQuery: "/packages/x/ego.svg",
    });
    assert.ok(String(repr.type).includes("image/svg+xml"));
    const svg = String(repr.body);
    assert.ok(svg.trimStart().startsWith("<svg"));
    assert.ok(svg.includes('data-focus="true"'));
  });

  it("GET /packages/:name/symbols.svg serves a shaped symbol svg for a built package", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/packages/:name/symbols.svg", {
      type: "image/svg+xml",
      params: { encodedName: encodeURIComponent("@red-cup-engineering/jsnode-engineering-cli") },
      pathAndQuery: "/packages/x/symbols.svg",
    });
    const svg = String(repr.body);
    assert.ok(svg.trimStart().startsWith("<svg"));
    // Either the real shaped graph (data-kind) or, if unbuilt, the explicit note.
    assert.ok(/data-kind=|not built/.test(svg));
  });

  it("GET /packages/:name/symbols returns the symbol graph as json", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/packages/:name/symbols", {
      type: "application/json",
      params: { encodedName: encodeURIComponent("@red-cup-engineering/jsnode-engineering-cli") },
      pathAndQuery: "/packages/x/symbols",
    });
    const sg = JSON.parse(String(repr.body)) as { pkg: string; nodes: unknown[]; edges: unknown[]; populated: boolean };
    assert.equal(sg.pkg, "@red-cup-engineering/jsnode-engineering-cli");
    assert.ok(Array.isArray(sg.nodes) && Array.isArray(sg.edges));
  });

  it("GET /packages/:name/ego returns the neighbourhood as json", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/packages/:name/ego", {
      type: "application/json",
      params: { encodedName: encodeURIComponent("@red-cup-engineering/jsnode-topology") },
      pathAndQuery: "/packages/x/ego",
    });
    const ego = JSON.parse(String(repr.body)) as { focus: string; nodes: { name: string }[]; edges: unknown[] };
    assert.equal(ego.focus, "@red-cup-engineering/jsnode-topology");
    assert.ok(ego.nodes.some((n) => n.name === "@red-cup-engineering/jsnode-topology"), "focus is in its own neighbourhood");
  });

  it("GET /packages/:name still defaults to JSON for agents", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/packages/:name", {
      type: "application/json",
      params: { encodedName: encodeURIComponent("@red-cup-engineering/jsnode-topology") },
    });
    const parsed = JSON.parse(String(repr.body));
    assert.equal(parsed.name, "@red-cup-engineering/jsnode-topology");
  });

  it("unknown package returns an html 404 when html is negotiated", async () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    await service.refresh();
    const repr = callHtml(service, (r) => r.route === "/packages/:name", {
      type: "text/html",
      params: { encodedName: encodeURIComponent("@nope/missing") },
    });
    assert.equal(repr.status, 404);
    assert.ok(String(repr.body).includes("not found"));
  });
});

describe("held type index", () => {
  // A tiny root with no package strata yields an empty index instantly, so the
  // holding/invalidation contract can be tested without the heavy compiler run.
  let emptyRoot: string;
  it("holds one index across reads and rebuilds after refresh", async () => {
    emptyRoot = mkdtempSync(path.join(tmpdir(), "jsnode-server-"));
    const service = createJSNodeServer({ name: "test", root: emptyRoot, port: 18808 });
    const first = service.typeIndex();
    assert.strictEqual(service.typeIndex(), first, "index must be held, not rebuilt per read");
    await service.refresh();
    assert.notStrictEqual(service.typeIndex(), first, "refresh must invalidate the held index");
    rmSync(emptyRoot, { recursive: true, force: true });
  });

  it("/types and /functions return the attributed shape", () => {
    const service = createJSNodeServer({ name: "test", root: REPO_ROOT, port: 18808 });
    const types = callRoute(service, "/types", "/types?match=Workspace") as {
      match: string; count: number; types: { pkg: string; name: string; kind: string }[];
    };
    assert.equal(types.match, "Workspace");
    assert.equal(types.count, types.types.length);
    // The substring filter is a subset of the whole index.
    const all = callRoute(service, "/types", "/types") as { count: number };
    assert.ok(types.count <= all.count);
    // When dists are built, the filter actually finds workspace types, attributed.
    if (types.count > 0) {
      assert.ok(types.types.every((t) => t.name.includes("Workspace")));
      assert.ok(types.types.every((t) => typeof t.pkg === "string" && t.pkg.length > 0));
    }

    const fns = callRoute(service, "/functions", "/functions?producing=Workspace") as {
      producing: string; count: number; functions: { pkg: string; name: string; codomain?: string }[];
    };
    assert.equal(fns.producing, "Workspace");
    assert.equal(fns.count, fns.functions.length);
    if (fns.count > 0) {
      assert.ok(fns.functions.every((f) => f.codomain !== undefined && f.codomain.includes("Workspace")));
    }
  });
});
