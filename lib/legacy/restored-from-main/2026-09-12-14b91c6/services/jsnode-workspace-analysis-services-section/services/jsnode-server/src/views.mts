/**
 * views — the human face of the jsnode workspace: HTML pages over the same
 * carriers the JSON/RDF surface serves.
 *
 * jsnode-engineering-cli owns the *renderer* (`dependencyGraphSvg`); this owns the
 * *page* around it. Two views:
 *
 *   - the DAG viewer (`renderDagPage`): the whole workspace as one inline,
 *     clickable SVG, with drag-to-pan, wheel-to-zoom, a search that dims
 *     non-matching packages, and a stratum legend that toggles layers. The SVG
 *     is the source of truth; the script only changes the viewBox and node
 *     opacity, so the picture stays the self-describing document jsnode-engineering-cli
 *     emitted.
 *   - the package page (`renderPackagePage`): one package's coordinates, the
 *     packages it depends on, and the packages that depend on it — every name a
 *     link, so the graph is walkable without the SVG at all.
 *
 * Pure string builders, no transport. The caller supplies `base` (the public
 * path prefix) so the same pages work served at `/` or mounted under a subpath.
 */
import {
  dependencyGraphSvg,
  type DependencyGraphNode,
  type WorkspaceDependencyGraph,
  type WorkspaceAnalysis,
  type RoleDomainGrid,
  type RoleQuotientGraph,
  type WorkspaceSpectrum,
  type DomainAtlas,
  type DomainEntry,
  type DomainQuotientGraph,
  type RoleCatalog,
  type RoleCatalogEntry,
  type WorkspaceDependencies,
  type WorkspaceConsistency,
  type BuildOrder,
  type WorkspaceLifecycle,
  type WorkspaceTypeFlow,
  type TypeFlowNeighbourhood,
  type TypeFlowEdge,
} from "@red-cup-engineering/jsnode-engineering-cli";
import type { JSNodePackage } from "@red-cup-engineering/jsnode-topology";
import { JSNODE_ROLES, packageCoordinate } from "@red-cup-engineering/jsnode-topology";

/** The domain (Personality facet) a package name encodes — its catalog home. */
const domainOf = (name: string): string => packageCoordinate(name).domain;

export interface ViewOptions {
  /** Public path prefix the app is served under. Default "/". */
  readonly base?: string;
  /** Page <title> / heading. */
  readonly title?: string;
}

export interface PackagePageOptions extends ViewOptions {
  /** The package's neighbourhood (ego) dependency graph, pre-rendered to SVG. */
  readonly egoSvg?: string;
  /** The package's internal symbol graph, pre-rendered to SVG (or the
   *  "not built" placeholder when `symbolBuilt` is false). */
  readonly symbolSvg?: string;
  /** Whether the symbol graph actually has a built surface to show. */
  readonly symbolBuilt?: boolean;
  /** Symbol/relation counts, for the section heading. */
  readonly symbolCounts?: { readonly nodes: number; readonly edges: number };
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Join a base prefix and a path into one absolute path, collapsing the slash.
const link = (base: string, p: string): string =>
  (base.endsWith("/") ? base.slice(0, -1) : base) + "/" + p.replace(/^\//, "");

// The shared top-level navigation. `/` (the catalog) leads; the dependency DAG
// — once the homepage — now lives at `/graph`, one click away. `current` names
// the page so it can render unlinked.
const NAV: ReadonlyArray<readonly [string, string]> = [
  ["", "catalog"],
  ["domains", "domains"],
  ["roles", "roles"],
  ["dependencies", "deps"],
  ["consistency", "consistency"],
  ["lifecycle", "lifecycle"],
  ["build-order", "build order"],
  ["graph", "graph"],
  ["grid", "grid"],
  ["quotient", "quotient"],
  ["analysis", "analysis"],
  ["spectrum", "spectrum"],
  ["typeflow", "type flow"],
];
const navLinks = (base: string, current: string): string =>
  NAV.map(([p, label]) =>
    p === current
      ? `<span class="navcur">${esc(label)}</span>`
      : `<a href="${esc(link(base, p))}">${esc(label)}</a>`,
  ).join(" ");

const LAYER_SWATCH: Record<string, string> = {
  lib: "#3f7d9c",
  apps: "#9c3f7d",
  services: "#7d9c3f",
  sites: "#9c7d3f",
  ops: "#7d7d7d",
};

const SHELL_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0d1117; color: #e6edf3;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
a { color: #79c0ff; text-decoration: none; }
a:hover { text-decoration: underline; }
.navcur { color: #e6edf3; font-weight: 600; }
header { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
  padding: .6rem 1rem; border-bottom: 1px solid #21262d; position: sticky; top: 0;
  background: #0d1117; z-index: 2; }
header h1 { font-size: 1rem; margin: 0; font-weight: 600; }
header .spacer { flex: 1; }
input[type=search] { background: #161b22; border: 1px solid #30363d; color: #e6edf3;
  border-radius: 6px; padding: .35rem .6rem; min-width: 16rem; font: inherit; }
button { background: #161b22; border: 1px solid #30363d; color: #e6edf3;
  border-radius: 6px; padding: .35rem .7rem; font: inherit; cursor: pointer; }
button:hover { border-color: #8b949e; }
.legend { display: flex; gap: .5rem; flex-wrap: wrap; }
.legend label { display: inline-flex; gap: .35rem; align-items: center; cursor: pointer;
  padding: .2rem .5rem; border: 1px solid #30363d; border-radius: 999px; user-select: none; }
.legend .off { opacity: .4; text-decoration: line-through; }
.swatch { width: .8rem; height: .8rem; border-radius: 3px; display: inline-block; }
.roles { display: inline-flex; gap: .2rem; vertical-align: middle; }
.rc { width: 1.1rem; height: 1.1rem; border-radius: 4px; display: inline-flex; align-items: center;
  justify-content: center; font-size: .72rem; border: 1px solid #30363d; color: #484f58;
  text-transform: uppercase; text-decoration: none; }
a.rc:hover { text-decoration: none; border-color: #8b949e; }
.rc.on { color: #0d1117; background: #d2a8ff; border-color: #d2a8ff; font-weight: 700; }
.life, .mat { font-size: .7rem; border: 1px solid #30363d; border-radius: 999px; padding: 0 .45rem; color: #8b949e; white-space: nowrap; }
.life.deprecated { color: #f0883e; border-color: #6e4b18; }
.life.abandoned { color: #58a6ff; border-color: #2a4a6a; }
.life.maintenance { color: #c9a227; border-color: #5d5018; }
.mat.experimental { color: #db6d6d; border-color: #6a2a2a; }
.mat.alpha { color: #e0a458; border-color: #6a4a1a; }
.mat.beta { color: #c9a227; border-color: #5d5018; }
.mat.stable { color: #3fb950; border-color: #2f5d33; }
`;

/** The whole-workspace DAG viewer page: inline clickable SVG + pan/zoom/search. */
export function renderDagPage(
  graph: WorkspaceDependencyGraph,
  opts: ViewOptions = {},
): string {
  const base = opts.base ?? "/";
  const title = opts.title ?? "workspace dependency DAG";
  const svg = dependencyGraphSvg(graph, {
    title,
    href: (n) => link(base, "packages/" + encodeURIComponent(n.name)),
  });
  const layers = [...new Set(graph.nodes.map((n) => n.layer))];
  const counts = graph.nodes.reduce<Record<string, number>>((a, n) => ((a[n.layer] = (a[n.layer] ?? 0) + 1), a), {});
  const legend = layers
    .map((l) => `<label data-layer="${esc(l)}"><span class="swatch" style="background:${LAYER_SWATCH[l] ?? "#888"}"></span>${esc(l)} <small>${counts[l]}</small></label>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${SHELL_CSS}
#stage { width: 100vw; height: calc(100vh - 3rem); overflow: hidden; cursor: grab; }
#stage.grabbing { cursor: grabbing; }
#stage svg { width: 100%; height: 100%; display: block; touch-action: none; }
.node { transition: opacity .12s ease; }
</style>
</head><body>
<header>
  <h1>${esc(title)}</h1>
  <input id="q" type="search" placeholder="filter packages… (name or description)" autocomplete="off">
  <div class="legend">${legend}</div>
  <div class="spacer"></div>
  ${navLinks(base, "graph")}
  <button id="reset">reset view</button>
  <a href="${esc(link(base, "graph.svg"))}">raw .svg</a>
</header>
<div id="stage">${svg}</div>
<script>
(() => {
  const stage = document.getElementById("stage");
  const svg = stage.querySelector("svg");
  const vb = svg.getAttribute("viewBox").split(/\\s+/).map(Number);
  const home = vb.slice();
  const apply = () => svg.setAttribute("viewBox", vb.join(" "));
  // wheel zoom about the pointer
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const px = vb[0] + (e.clientX - r.left) / r.width * vb[2];
    const py = vb[1] + (e.clientY - r.top) / r.height * vb[3];
    const k = e.deltaY < 0 ? 0.85 : 1 / 0.85;
    vb[2] *= k; vb[3] *= k;
    vb[0] = px - (e.clientX - r.left) / r.width * vb[2];
    vb[1] = py - (e.clientY - r.top) / r.height * vb[3];
    apply();
  }, { passive: false });
  // drag to pan (but let clicks on nodes through to their links)
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a")) return;
    drag = { x: e.clientX, y: e.clientY, vb: vb.slice() };
    stage.classList.add("grabbing");
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = svg.getBoundingClientRect();
    vb[0] = drag.vb[0] - (e.clientX - drag.x) / r.width * vb[2];
    vb[1] = drag.vb[1] - (e.clientY - drag.y) / r.height * vb[3];
    apply();
  });
  const end = () => { drag = null; stage.classList.remove("grabbing"); };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  document.getElementById("reset").addEventListener("click", () => { vb.splice(0, 4, ...home); apply(); });
  // search: dim packages that don't match name or description
  const off = new Set();
  const refilter = () => {
    const t = document.getElementById("q").value.trim().toLowerCase();
    svg.querySelectorAll(".node").forEach((g) => {
      const hay = ((g.getAttribute("data-name") || "") + " " + (g.querySelector("title")?.textContent || "")).toLowerCase();
      const layer = g.getAttribute("data-layer");
      const show = (!t || hay.includes(t)) && !off.has(layer);
      g.style.opacity = show ? "1" : "0.1";
    });
  };
  document.getElementById("q").addEventListener("input", refilter);
  // legend toggles a whole stratum
  document.querySelectorAll(".legend label").forEach((lab) => {
    lab.addEventListener("click", () => {
      const l = lab.getAttribute("data-layer");
      if (off.has(l)) { off.delete(l); lab.classList.remove("off"); }
      else { off.add(l); lab.classList.add("off"); }
      refilter();
    });
  });
})();
</script>
</body></html>`;
}

const badge = (layer: string): string =>
  `<span class="swatch" style="background:${LAYER_SWATCH[layer] ?? "#888"}"></span> ${esc(layer)}`;

// Lifecycle and maturity chips. Active is the default and renders nothing — only
// the noteworthy dispositions get a chip, so the live set stays visually quiet
// and deprecated/abandoned/maintenance stand out.
const lifeBadge = (lifecycle: string): string =>
  lifecycle === "active" ? "" : `<span class="life ${esc(lifecycle)}" title="lifecycle: ${esc(lifecycle)}">${esc(lifecycle)}</span>`;
const matBadge = (maturity: string): string =>
  `<span class="mat ${esc(maturity)}" title="release maturity (from version): ${esc(maturity)}">${esc(maturity)}</span>`;

// Shape legend for the symbol graph, matching symbol-svg's per-kind palette.
const KIND_COLOR: Record<string, string> = {
  class: "#4493c8",
  interface: "#3fae7d",
  "type-alias": "#c89a44",
  function: "#a96fd0",
};
const SHAPES_LEGEND =
  `<div class="shapes">` +
  `<span><i class="g-rect" style="--c:${KIND_COLOR.class}"></i>class</span>` +
  `<span><i class="g-round" style="--c:${KIND_COLOR.interface}"></i>interface</span>` +
  `<span><i class="g-para" style="--c:${KIND_COLOR["type-alias"]}"></i>type&nbsp;alias</span>` +
  `<span><i class="g-pill" style="--c:${KIND_COLOR.function}"></i>function</span>` +
  `<span class="muted">→ param · → return · ⇢ extends</span>` +
  `</div>`;

// One pan/zoom controller wired to every .graph-stage on the page. Inline SVGs
// only — it just edits the viewBox, so the self-describing markup is untouched.
const PANZOOM_JS = `
(() => {
  document.querySelectorAll(".graph-stage").forEach((stage) => {
    const svg = stage.querySelector("svg");
    if (!svg) return;
    let vb = (svg.getAttribute("viewBox") || "").split(/\\s+/).map(Number);
    if (vb.length !== 4 || vb.some(Number.isNaN)) return;
    const home = vb.slice();
    const apply = () => svg.setAttribute("viewBox", vb.join(" "));
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const px = vb[0] + (e.clientX - r.left) / r.width * vb[2];
      const py = vb[1] + (e.clientY - r.top) / r.height * vb[3];
      const k = e.deltaY < 0 ? 0.85 : 1 / 0.85;
      vb[2] *= k; vb[3] *= k;
      vb[0] = px - (e.clientX - r.left) / r.width * vb[2];
      vb[1] = py - (e.clientY - r.top) / r.height * vb[3];
      apply();
    }, { passive: false });
    let drag = null;
    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest("a")) return;
      drag = { x: e.clientX, y: e.clientY, vb: vb.slice() };
      stage.setPointerCapture(e.pointerId); stage.classList.add("grabbing");
    });
    stage.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = svg.getBoundingClientRect();
      vb[0] = drag.vb[0] - (e.clientX - drag.x) / r.width * vb[2];
      vb[1] = drag.vb[1] - (e.clientY - drag.y) / r.height * vb[3];
      apply();
    });
    const end = () => { drag = null; stage.classList.remove("grabbing"); };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    const reset = stage.parentElement && stage.parentElement.querySelector("[data-reset]");
    if (reset) reset.addEventListener("click", () => { vb = home.slice(); apply(); });
  });
})();`;

/** One package's page: coordinates, its dependencies and dependents, plus two
 *  graphs — its neighbourhood in the ecosystem and its internal type/function
 *  structure. The graph SVGs are pre-rendered by the caller (off jsnode-engineering-cli)
 *  and embedded inline so they pan, zoom, and stay self-describing. */
export function renderPackagePage(
  pkg: JSNodePackage,
  graph: WorkspaceDependencyGraph,
  opts: PackagePageOptions = {},
): string {
  const base = opts.base ?? "/";
  const node = graph.nodes.find((n) => n.name === pkg.name);
  const deps = node?.dependencies ?? [];
  const dependents = graph.edges.filter((e) => e.to === pkg.name).map((e) => e.from).sort();
  const pkgLink = (name: string): string =>
    `<a href="${esc(link(base, "packages/" + encodeURIComponent(name)))}">${esc(name)}</a>`;
  const list = (names: readonly string[]): string =>
    names.length
      ? `<ul>${names.map((n) => `<li>${pkgLink(n)}</li>`).join("")}</ul>`
      : `<p class="muted">none</p>`;
  const keywords = pkg.tags.length
    ? `<p>keywords: ${pkg.tags.map((t) => `<code>${esc(t)}</code>`).join(" ")}</p>`
    : "";
  const sub = (suffix: string): string =>
    esc(link(base, "packages/" + encodeURIComponent(pkg.name) + "/" + suffix));

  // The plain manifest facts a reader looks at first: license, the Node engine,
  // module system, publishability, and where the source lives — the metadata the
  // catalog used to throw away.
  const m = pkg.manifest;
  const factBits: string[] = [];
  factBits.push(
    m.license
      ? `<span class="fact">license <b>${esc(m.license)}</b></span>`
      : `<span class="fact warn">no license</span>`,
  );
  if (m.engines["node"]) factBits.push(`<span class="fact">node <b>${esc(m.engines["node"])}</b></span>`);
  if (m.moduleType) factBits.push(`<span class="fact">${esc(m.moduleType === "module" ? "ESM" : "CommonJS")}</span>`);
  factBits.push(`<span class="fact">${m.private ? "private" : "publishable"}</span>`);
  if (m.repository) {
    const url = m.repository.replace(/^git\+/, "").replace(/\.git$/, "");
    factBits.push(`<span class="fact">repo <a href="${esc(url)}">${esc(url.replace(/^https?:\/\//, ""))}</a></span>`);
  }
  const factsLine = `<div class="facts">${factBits.join("")}</div>`;
  const scriptsLine = m.scripts.length
    ? `<div class="scripts-row">${m.scripts.map((s) => `<code>${esc(s)}</code>`).join("")}</div>`
    : "";

  // Every declared dependency, with its kind and version range — the runtime
  // name-list the graph reads, plus the dev/peer/optional deps and the external
  // (registry) packages it never showed. Internal deps link to their page.
  const lifeOf = new Map(graph.nodes.map((n) => [n.name, n.lifecycle]));
  const KIND_RANK: Record<string, number> = { runtime: 0, dev: 1, peer: 2, optional: 3 };
  const declaredDeps = [...pkg.deps].sort(
    (a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || a.name.localeCompare(b.name),
  );
  const depRows = declaredDeps
    .map((d) => {
      const life = lifeOf.get(d.name);
      const nm = lifeOf.has(d.name)
        ? `${pkgLink(d.name)} ${life && life !== "active" ? lifeBadge(life) : ""}`
        : `${esc(d.name)} <span class="muted" title="external (registry) dependency">↗</span>`;
      return `<tr><td>${nm}</td><td><span class="kk ${esc(d.kind)}">${esc(d.kind)}</span></td><td><code>${esc(d.range)}</code></td></tr>`;
    })
    .join("");
  const depsSection = declaredDeps.length
    ? `<section><h2>dependencies (${declaredDeps.length} declared)</h2>
    <table class="deps"><tr><th>package</th><th>kind</th><th>range</th></tr>${depRows}</table></section>`
    : `<section><h2>dependencies</h2><p class="muted">none declared</p></section>`;

  // The two graph sections, only when their SVGs were supplied.
  const counts = opts.symbolCounts;
  const egoSection = opts.egoSvg
    ? `<section class="gsec">
    <div class="ghead"><h2>neighbourhood</h2>
      <span class="muted">deps &amp; dependents · drag to pan, scroll to zoom</span>
      <span class="spacer"></span>
      <span class="links"><button data-reset>reset</button> · <a href="${sub("ego.svg")}">raw .svg</a> · <a href="${sub("ego")}">json</a> · <a href="${sub("spectrum")}" title="this neighbourhood's exact spectral signature (spanning-tree count, characteristic polynomial)">spectrum</a></span>
    </div>
    <div class="graph-stage">${opts.egoSvg}</div>
  </section>`
    : "";
  const symbolSection = opts.symbolSvg
    ? `<section class="gsec">
    <div class="ghead"><h2>internal structure</h2>
      <span class="muted">${opts.symbolBuilt && counts ? `${counts.nodes} symbols, ${counts.edges} relations` : "types &amp; functions"}</span>
      <span class="spacer"></span>
      <span class="links"><button data-reset>reset</button> · <a href="${sub("symbols.svg")}">raw .svg</a> · <a href="${sub("symbols")}">json</a></span>
    </div>
    ${opts.symbolBuilt ? SHAPES_LEGEND : ""}
    <div class="graph-stage">${opts.symbolSvg}</div>
  </section>`
    : "";
  const graphsScript = opts.egoSvg || opts.symbolSvg ? `<script>${PANZOOM_JS}</script>` : "";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(pkg.name)}</title>
<style>${SHELL_CSS}
main { max-width: 64rem; margin: 0 auto; padding: 1.5rem 1.25rem; }
h1 { font-size: 1.3rem; margin: 0 0 .25rem; word-break: break-all; }
.meta { color: #8b949e; margin: 0 0 1rem; }
.desc { font-size: 1.05rem; line-height: 1.5; margin: 0 0 1.5rem; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
@media (max-width: 38rem) { .cols { grid-template-columns: 1fr; } }
h2 { font-size: .95rem; color: #e6edf3; margin: 0; }
.cols h2 { color: #8b949e; border-bottom: 1px solid #21262d; padding-bottom: .3rem; }
ul { margin: .4rem 0; padding-left: 1.1rem; } li { margin: .15rem 0; }
.muted { color: #6e7681; } code { color: #d2a8ff; }
.facts { display: flex; flex-wrap: wrap; gap: .4rem .55rem; margin: 0 0 1rem; font-size: .82rem; }
.fact { border: 1px solid #30363d; border-radius: 999px; padding: .05rem .55rem; color: #8b949e; }
.fact b { color: #e6edf3; font-weight: 600; }
.fact.warn { border-color: #6e4b18; color: #c89a44; }
.scripts-row { display: flex; flex-wrap: wrap; gap: .3rem; margin: .2rem 0 1.2rem; }
.scripts-row code { background: #161b22; padding: .05rem .4rem; border-radius: 5px; }
table.deps { border-collapse: collapse; font-size: 13px; width: 100%; }
table.deps th, table.deps td { border: 1px solid #21262d; padding: .25rem .5rem; text-align: left; }
table.deps th { color: #8b949e; font-weight: 600; }
.kk { font-size: .7rem; border: 1px solid #30363d; border-radius: 999px; padding: 0 .4rem; color: #8b949e; }
.kk.runtime { color: #3fae7d; border-color: #2f5d44; }
.kk.dev { color: #79c0ff; border-color: #2a4a6a; }
.kk.peer { color: #d2a8ff; border-color: #4a3a6a; }
.kk.optional { color: #8b949e; }
.gsec { margin-top: 1.8rem; }
.gsec .ghead { display: flex; align-items: baseline; gap: .6rem; flex-wrap: wrap;
  border-bottom: 1px solid #21262d; padding-bottom: .3rem; margin-bottom: .5rem; }
.gsec .spacer { flex: 1; } .gsec .links { font-size: .8rem; }
.graph-stage { width: 100%; height: 460px; overflow: hidden; border: 1px solid #21262d;
  border-radius: 8px; background: #0d1117; cursor: grab; touch-action: none; }
.graph-stage.grabbing { cursor: grabbing; }
.graph-stage svg { width: 100%; height: 100%; display: block; }
.shapes { display: flex; gap: .9rem; flex-wrap: wrap; color: #8b949e; font-size: .8rem; margin: 0 0 .6rem; }
.shapes span { display: inline-flex; gap: .35rem; align-items: center; }
.shapes i { width: 1.1rem; height: .72rem; border: 1.5px solid var(--c); display: inline-block; }
.shapes .g-round { border-radius: .4rem; border-style: dashed; }
.shapes .g-para { transform: skewX(-18deg); }
.shapes .g-pill { border-radius: .4rem; }
</style>
</head><body>
<header><a href="${esc(base.endsWith("/") ? base : base + "/")}">← catalog</a>
<a href="${esc(link(base, "domains/" + encodeURIComponent(domainOf(pkg.name))))}">${esc(domainOf(pkg.name))} domain</a>
<div class="spacer"></div>
<a href="${esc(link(base, "packages/" + encodeURIComponent(pkg.name)))}">json/turtle/json-ld</a></header>
<main>
  <h1>${esc(pkg.name)}</h1>
  <p class="meta">${badge(pkg.layer)} · v${esc(pkg.version)} ${matBadge(pkg.maturity)} ${lifeBadge(pkg.lifecycle)} · ${deps.length} internal deps · ${dependents.length} dependents</p>
  ${factsLine}
  <p class="desc">${pkg.description ? esc(pkg.description) : '<span class="muted">no description</span>'}</p>
  ${scriptsLine}
  ${keywords}
  <div class="cols">
    ${depsSection}
    <section><h2>depended on by (${dependents.length})</h2>${list(dependents)}</section>
  </div>
  ${egoSection}
  ${symbolSection}
</main>
${graphsScript}
</body></html>`;
}

// A standalone page shell for the tabular views (analysis, grid): the same
// chrome as the DAG/package pages, a back-link, and a content slot.
function tablePage(base: string, title: string, body: string, current = ""): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${SHELL_CSS}
main { padding: 1rem 1.2rem; max-width: 1100px; }
h2 { font-size: 1rem; margin: 1.4rem 0 .5rem; }
.muted { color: #8b949e; }
.stats { display: flex; flex-wrap: wrap; gap: .5rem 1.4rem; margin: .5rem 0; }
.stats b { color: #e6edf3; } .stats span { color: #8b949e; }
table { border-collapse: collapse; font-size: 13px; margin: .5rem 0; }
th, td { border: 1px solid #21262d; padding: .25rem .5rem; text-align: left; vertical-align: top; }
th { color: #8b949e; font-weight: 600; position: sticky; top: 3rem; background: #0d1117; }
td.empty { background: #10151c; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.drift { background: #2b1a10; color: #c89a44; }
.kk { font-size: .7rem; border: 1px solid #30363d; border-radius: 999px; padding: 0 .4rem; color: #8b949e; }
.kk.runtime { color: #3fae7d; border-color: #2f5d44; }
.kk.dev { color: #79c0ff; border-color: #2a4a6a; }
.kk.peer { color: #d2a8ff; border-color: #4a3a6a; }
.kk.optional { color: #8b949e; }
.grid-wrap { overflow-x: auto; }
.grid th.role { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; }
code { background: #161b22; padding: 0 .3rem; border-radius: 4px; }
ul.flat { margin: .3rem 0; padding-left: 1.1rem; }
table.quotient td small { color: #6e7681; font-size: .82em; margin-left: .15rem; }
table.quotient td.with { background: #11281b; }
table.quotient td.against { background: #2b2410; }
table.quotient td.diag { background: #1b2230; font-style: italic; }
.with-key { color: #3fae7d; } .against-key { color: #c89a44; }
</style>
</head><body>
<header>
  <h1>${esc(title)}</h1>
  <div class="spacer"></div>
  ${navLinks(base, current)}
</header>
<main>${body}</main>
</body></html>`;
}

const pkgHrefLink = (base: string, name: string): string =>
  `<a href="${esc(link(base, "packages/" + encodeURIComponent(name)))}">${esc(name)}</a>`;

/** The geometric/analytical invariants of the dependency graph as a page:
 *  the global shape, the disconnected islands, any cycles, and the packages
 *  that lead each centrality measure. */
export function renderAnalysisPage(analysis: WorkspaceAnalysis, opts: ViewOptions = {}): string {
  const base = opts.base ?? "/";
  const a = analysis;
  const islands = a.components.filter((c) => c.size === 1).flatMap((c) => c.members);
  const byBetween = [...a.centrality].sort((x, y) => y.betweenness - x.betweenness).slice(0, 15);
  const byStratum = [...a.centrality].sort((x, y) => y.stratum - x.stratum).slice(0, 15);
  const top = a.centrality.slice(0, 15);

  const row = (c: WorkspaceAnalysis["centrality"][number]): string =>
    `<tr><td>${pkgHrefLink(base, c.name)}</td><td class="num">${c.dependents}</td>` +
    `<td class="num">${c.dependencies}</td><td class="num">${Math.round(c.betweenness)}</td>` +
    `<td class="num">${c.stratum}</td></tr>`;
  const tableOf = (rows: readonly WorkspaceAnalysis["centrality"][number][]): string =>
    `<div class="grid-wrap"><table><tr><th>package</th><th>dependents</th><th>dependencies</th>` +
    `<th>betweenness</th><th>stratum</th></tr>${rows.map(row).join("")}</table></div>`;

  const cyclesBlock = a.acyclic
    ? `<p class="muted">acyclic — no dependency cycles.</p>`
    : `<ul class="flat">${a.cycles.map((c) => `<li>${c.map((n) => pkgHrefLink(base, n)).join(" → ")} → …</li>`).join("")}</ul>`;

  return tablePage(base, opts.title ?? "workspace analysis", `
<div class="stats">
  <span><b>${a.order}</b> packages</span><span><b>${a.size}</b> dependency edges</span>
  <span><b>${a.componentCount}</b> components</span>
  <span>diameter <b>${a.diameter}</b></span><span>radius <b>${a.radius}</b></span>
  <span>deepest chain <b>${a.height}</b></span>
  <span>${a.acyclic ? "acyclic ✓" : `<b>${a.cycles.length}</b> cycles`}</span>
</div>
<p class="muted">Distances ignore edge direction and are measured within the largest component.
Geometric centre (least eccentric): ${a.center.slice(0, 6).map((n) => pkgHrefLink(base, n)).join(", ")}${a.center.length > 6 ? " …" : ""}.</p>

<h2>connected components</h2>
<p>One component of <b>${a.components[0]?.size ?? 0}</b> packages${
    islands.length ? `, and ${islands.length} isolated package${islands.length === 1 ? "" : "s"}: ${islands.map((n) => pkgHrefLink(base, n)).join(", ")}` : ""
  }.</p>

<h2>dependency cycles</h2>
${cyclesBlock}

<h2>most depended-upon</h2>${tableOf(top)}
<h2>highest betweenness (most dependency flow through)</h2>${tableOf(byBetween)}
<h2>deepest strata (longest dependency chain below)</h2>${tableOf(byStratum)}
`, "analysis");
}

/** The flat layout made visible as the role × domain grid: rows are domains
 *  that instantiate at least one role, columns are the roles, and each cell
 *  holds the package(s) at that coordinate. An empty cell is a role a domain
 *  never reaches — itself a fact about the ecosystem's shape. */
export function renderGridPage(grid: RoleDomainGrid, opts: ViewOptions = {}): string {
  const base = opts.base ?? "/";
  const knownRoles = grid.roles.filter((r) => r !== "—");
  const cellOf = new Map<string, readonly string[]>();
  for (const c of grid.cells) cellOf.set(`${c.domain} ${c.role}`, c.packages);
  // Domains that have at least one known role — the genuine fibration.
  const fiberDomains = grid.domains.filter((d) => knownRoles.some((r) => cellOf.has(`${d} ${r}`)));
  const atomic = grid.cells.filter((c) => c.role === "—").flatMap((c) => c.packages).sort();

  const headRow = `<tr><th>domain</th>${knownRoles
    .map((r) => `<th class="role"><a href="${esc(link(base, "roles/" + encodeURIComponent(String(r))))}" title="what ${esc(String(r))} means">${esc(String(r))}</a></th>`)
    .join("")}</tr>`;
  const bodyRows = fiberDomains
    .map((d) => {
      const cells = knownRoles
        .map((r) => {
          const pkgs = cellOf.get(`${d} ${r}`);
          if (!pkgs || pkgs.length === 0) return `<td class="empty"></td>`;
          return `<td>${pkgs.map((n) => pkgHrefLink(base, n)).join("<br>")}</td>`;
        })
        .join("");
      return `<tr><th>${esc(d)}</th>${cells}</tr>`;
    })
    .join("");

  return tablePage(base, opts.title ?? "fibration grid — domain × role", `
<div class="stats">
  ${grid.byRole.map((r) => `<span><b>${r.count}</b> ${esc(String(r.role))}</span>`).join("")}
</div>
<p class="muted">The flat <code>&lt;domain&gt;-&lt;role&gt;</code> layout read as a 2-D grid: each row is a
domain, each column a role functor. A filled cell is a package; an empty cell is a role that domain never reaches.
Only domains that instantiate at least one role are shown.</p>
<div class="grid-wrap"><table class="grid">${headRow}${bodyRows}</table></div>

<h2>role-less packages (${atomic.length})</h2>
<p class="muted">Packages whose names carry no known role suffix — atoms and applications rather than role functors.</p>
<p>${atomic.map((n) => pkgHrefLink(base, n)).join(", ")}</p>
`, "grid");
}

const roleLabel = (r: string): string => (r === "—" ? "—" : esc(r));

/** The role quotient as a page: the dependency graph projected to roles — every
 *  package contracted to its role — read three ways: the cross- vs within-domain
 *  split of dependency, the grading test (is the role order a real layering, or
 *  do roles mutually depend?), and the role→role multigraph itself as a matrix.
 *  `packageAcyclic`, when supplied, surfaces the package graph's own acyclicity
 *  for contrast with the quotient's. */
export function renderQuotientPage(
  q: RoleQuotientGraph,
  opts: ViewOptions & { readonly packageAcyclic?: boolean } = {},
): string {
  const base = opts.base ?? "/";
  const total = q.withinDomainEdges + q.crossDomainEdges;
  const pct = (n: number): string => (total === 0 ? "0" : ((100 * n) / total).toFixed(0));

  // The matrix: rows = depending role, cols = depended-on role; multiplicity
  // (within/cross) per cell, the diagonal carrying the within-role self-loop.
  const edgeAt = new Map<string, RoleQuotientGraph["edges"][number]>();
  for (const e of q.edges) edgeAt.set(`${e.from} ${e.to}`, e);
  const head = `<tr><th>depends ↓ on →</th>${q.roles.map((r) => `<th class="role">${roleLabel(r)}</th>`).join("")}</tr>`;
  const rows = q.roles
    .map((from) => {
      const cells = q.roles
        .map((to) => {
          const e = edgeAt.get(`${from} ${to}`);
          if (!e) return `<td class="empty"></td>`;
          const cls =
            from === to ? "diag" : e.declaredOrder === "against" ? "against" : e.declaredOrder === "with" ? "with" : "";
          const split = e.weight > 0 ? `<small>${e.withinDomain}/${e.crossDomain}</small>` : "";
          const title = `${from} → ${to}: ${e.weight} dependencies (${e.withinDomain} within-domain, ${e.crossDomain} cross-domain) · ${e.declaredOrder} declared order`;
          return `<td class="num ${cls}" title="${esc(title)}">${e.weight} ${split}</td>`;
        })
        .join("");
      return `<tr><th>${roleLabel(from)}</th>${cells}</tr>`;
    })
    .join("");

  // The role nodes: declared stratum, package count, within-role self-loop.
  const nodeRows = q.nodes
    .map(
      (n) =>
        `<tr><td>${roleLabel(n.role)}</td><td class="num">${n.stratum ?? "—"}</td>` +
        `<td class="num">${n.packages}</td><td class="num">${n.selfLoop}</td></tr>`,
    )
    .join("");

  const contrast =
    opts.packageAcyclic === true && !q.acyclic
      ? `<p class="muted">The packages themselves form a <b>clean acyclic DAG</b> — yet their role quotient does not. Individual packages layer; the role abstraction their names promise does not. (A quotient can be cyclic over an acyclic graph: contracting distinct packages to one role identifies edges that had no cycle between them.)</p>`
      : "";
  const gradingBlock = q.acyclic
    ? `<p>The ranked role functors form an <b>acyclic</b> quotient: some layering of the roles is consistent with every dependency. The declared order is a genuine grading.</p>${contrast}`
    : `<p>The ranked role functors are <b>not</b> acyclic — some roles mutually depend, so <b>no role order can be a total grading</b>. The entangled class${q.entangled.length === 1 ? " is" : "es are"}:</p>
<ul class="flat">${q.entangled.map((c) => `<li>${c.map(roleLabel).join(" ⇄ ")}</li>`).join("")}</ul>
<p class="muted">geometry and holography are <em>not</em> in the tangle: they only depend downward, and nothing roled depends up into them.</p>${contrast}`;

  const againstBlock = q.againstDeclared.length
    ? `<p>The back-edges that run <b>against</b> the declared <code>algebra → topology → geometry → analysis → logic → codecs → holography</code> order — where the naming convention and the real dependency flow disagree (information, not defects):</p>
<ul class="flat">${q.againstDeclared
        .map((e) => `<li><code>${roleLabel(e.from)} → ${roleLabel(e.to)}</code> · ${e.weight} ${e.weight === 1 ? "dependency" : "dependencies"} (${e.withinDomain} within-domain, ${e.crossDomain} cross-domain)</li>`)
        .join("")}</ul>`
    : `<p class="muted">No dependency runs against the declared role order.</p>`;

  return tablePage(base, opts.title ?? "role quotient — the dependency graph projected to roles", `
<div class="stats">
  <span><b>${q.order}</b> roles</span>
  <span><b>${q.size}</b> quotient edges</span>
  <span><b>${q.withinDomainEdges}</b> within-domain (${pct(q.withinDomainEdges)}%)</span>
  <span><b>${q.crossDomainEdges}</b> cross-domain (${pct(q.crossDomainEdges)}%)</span>
  <span>${q.acyclic ? "role order is a grading ✓" : `<b>${q.entangled.reduce((a, c) => a + c.length, 0)}</b> roles entangled`}</span>
</div>
<p class="muted">The <a href="${esc(link(base, "grid"))}">fibration grid</a> lays out every package by its full (domain, role) coordinate. This is the same workspace <em>projected to roles</em>: each package contracted to its role, so the
${total}-edge dependency graph collapses to one role→role multigraph (parallel edges and self-loops kept — the multigraph quotient convention). Edge direction is dependent → dependency.</p>

<h2>horizontal vs vertical</h2>
<p><b>${pct(q.crossDomainEdges)}%</b> of dependency <em>crosses domains</em> (horizontal — movement along the base), only <b>${pct(q.withinDomainEdges)}%</b> stays within one domain (vertical — inside a fibre). The fibres are nearly independent: the workspace is held together <em>by role across domains</em>, not by domain.</p>

<h2>is the role order a grading?</h2>
${gradingBlock}

<h2>edges against the declared order</h2>
${againstBlock}

<h2>the role → role multigraph</h2>
<p class="muted">Rows depend on columns. Each cell is <code>weight <small>within/cross</small></code>: total dependencies and their within-domain / cross-domain split. The diagonal is the within-role self-loop;
<span class="with-key">green</span> runs with the declared order, <span class="against-key">amber</span> against it.</p>
<div class="grid-wrap"><table class="grid quotient">${head}${rows}</table></div>

<h2>the roles</h2>
<div class="grid-wrap"><table><tr><th>role</th><th>declared stratum</th><th>packages</th><th>within-role self-loop</th></tr>${nodeRows}</table></div>
`, "quotient");
}

/** The spectral field as a page: every package's radius-1 dependency
 *  neighbourhood read through its exact graph Laplacian — the Kirchhoff
 *  spanning-tree count (how many ways the neighbourhood could be re-wired as a
 *  spanning tree), the cyclomatic number (its independent cycles), ranked most
 *  redundantly-wired first. The whole-graph component count cross-checks the
 *  combinatorial one on the analysis page. */
export function renderSpectrumPage(spectrum: WorkspaceSpectrum, opts: ViewOptions = {}): string {
  const base = opts.base ?? "/";
  const s = spectrum;
  // The exact tree count is a bignum carried as a decimal string; show it whole
  // (that legibility is the point) but tag its digit length for the long ones.
  const trees = (v: string): string =>
    v.length > 18 ? `<span title="${v} (${v.length} digits)">${esc(v)}</span>` : esc(v);
  const top = s.spectra.filter((p) => BigInt(p.spanningTrees) > 1n);
  const rows = top
    .map((p, i) => {
      const json = esc(link(base, "packages/" + encodeURIComponent(p.name) + "/spectrum"));
      return (
        `<tr><td class="num">${i + 1}</td><td>${pkgHrefLink(base, p.name)}` +
        ` <a class="muted" href="${json}" title="this neighbourhood's full spectrum (with characteristic polynomial) as JSON">·json</a></td>` +
        `<td class="num">${p.order}</td><td class="num">${p.size}</td><td class="num">${p.cyclomatic}</td>` +
        `<td class="num" style="text-align:left;word-break:break-all;max-width:26rem">${trees(p.spanningTrees)}${p.exact ? "" : ' <small class="muted">≈</small>'}</td></tr>`
      );
    })
    .join("");
  const richest = s.spectra[0];

  return tablePage(base, opts.title ?? "spectrum — the workspace's exact local harmonics", `
<div class="stats">
  <span><b>${s.order}</b> neighbourhoods read</span>
  <span><b>${s.components}</b> components</span>
  <span><b>${s.treeNeighbourhoods}</b> tree neighbourhoods</span>
  <span><b>${top.length}</b> redundantly wired</span>
</div>
<p class="muted">Each package's radius-1 dependency neighbourhood — the package, the packages it
depends on, and the packages that depend on it — is read as an undirected graph and run through its exact
combinatorial <em>Laplacian</em> in native bignum. The <b>spanning-tree count</b> (Kirchhoff's theorem: a
reduced-Laplacian determinant) counts the ways that neighbourhood could be re-wired as a single spanning tree —
<b>1</b> when it is already a tree or a star (no local redundancy), larger the more alternative routings its
dependencies admit. The <b>cycles</b> column is the first Betti number <code>E − V + C</code>, the dimension of
the neighbourhood's cycle space. Direction is discarded: this is the constant-sheaf agent-graph reading, whose
Laplacian is the classical graph Laplacian. The <b>${s.components}</b>-component count here is computed as the
Laplacian's nullity and cross-checks the combinatorial component count on the
<a href="${esc(link(base, "analysis"))}">analysis</a> page.</p>

<p class="muted"><b>${s.treeNeighbourhoods}</b> of the <b>${s.order}</b> neighbourhoods are already trees
(spanning-tree count 1): minimally wired, no alternative routing.${
    richest && BigInt(richest.spanningTrees) > 1n
      ? ` The most redundantly-wired is ${pkgHrefLink(base, richest.name)}, whose
${richest.order}-package neighbourhood admits <b>${esc(richest.spanningTrees)}</b> distinct spanning trees.`
      : ""
  } Only the <b>${top.length}</b> neighbourhoods with more than one spanning tree are listed; the rest are trees.</p>

<h2>most redundantly-wired neighbourhoods</h2>
<div class="grid-wrap"><table>
<tr><th>#</th><th>package</th><th>nodes</th><th>edges</th><th>cycles</th><th>spanning trees</th></tr>
${rows}
</table></div>
<p class="muted">The full spectrum of any one neighbourhood — including its exact Laplacian characteristic
polynomial, the entire content of its spectrum — is at <code>/packages/&lt;name&gt;/spectrum</code> (the
<em>·json</em> link on each row), or any package's page links its own.</p>
`, "spectrum");
}

// ---------- the normie surface: dependencies, consistency, build order ----------

const depHref = (base: string, name: string): string =>
  esc(link(base, "packages/" + encodeURIComponent(name)));
const kindChip = (k: string): string => `<span class="kk ${esc(k)}">${esc(k)}</span>`;

/** The dependency report as a page: what the workspace pulls in (registry and
 *  internal), who uses it, and — first, because it is the actionable part — the
 *  dependencies pinned at more than one version (the drift). No naming
 *  convention anywhere; just "what do we depend on, and is it consistent?". */
export function renderDependenciesPage(rep: WorkspaceDependencies, opts: ViewOptions = {}): string {
  const base = opts.base ?? "/";
  const nm = (e: { name: string; internal: boolean }): string =>
    e.internal
      ? `<a href="${depHref(base, e.name)}">${esc(e.name)}</a>`
      : `${esc(e.name)} <span class="muted" title="external (registry) dependency">↗</span>`;

  const driftBlock = rep.drift.length
    ? `<ul class="flat">${rep.drift
        .map((d) => {
          const pins = d.uses
            .map((u) => `${esc(u.range)} <span class="muted">(${esc(u.by.split("/").pop() ?? u.by)})</span>`)
            .join(", ");
          return `<li><b>${esc(d.name)}</b> — <b>${d.ranges.length}</b> ranges: ${pins}</li>`;
        })
        .join("")}</ul>`
    : `<p class="muted">No dependency is pinned to more than one version range. Nothing drifts.</p>`;

  const row = (e: WorkspaceDependencies["entries"][number]): string =>
    `<tr><td>${nm(e)}</td><td class="num">${e.usedBy}</td>` +
    `<td>${e.kinds.map(kindChip).join(" ")}</td>` +
    `<td${e.drift ? ' class="drift"' : ""}>${e.ranges.map((r) => `<code>${esc(r)}</code>`).join(e.drift ? " ⚠ " : " ")}</td></tr>`;
  const external = rep.entries.filter((e) => !e.internal);
  const internal = rep.entries.filter((e) => e.internal);

  return tablePage(base, opts.title ?? "dependencies — what the workspace pulls in", `
<div class="stats">
  <span><b>${rep.total}</b> dependencies</span>
  <span><b>${rep.externalCount}</b> external (registry)</span>
  <span><b>${rep.internalCount}</b> internal (workspace)</span>
  <span>${rep.drift.length ? `<b>${rep.drift.length}</b> drifting ⚠` : "no version drift ✓"}</span>
</div>
<p class="muted">Every dependency declared across the workspace — runtime, dev, peer, optional — with the version
ranges it is pinned to and the packages that declare it. The internal dependency graph (<a href="${esc(link(base, "graph"))}">graph</a>)
shows only workspace→workspace edges; this is the whole surface, registry packages included.</p>

<h2>version drift (same dependency, divergent ranges)</h2>
${driftBlock}

<h2>external dependencies (${external.length})</h2>
<div class="grid-wrap"><table><tr><th>package</th><th>used by</th><th>kinds</th><th>ranges</th></tr>${external.map(row).join("")}</table></div>

<h2>internal dependencies (${internal.length})</h2>
<div class="grid-wrap"><table><tr><th>package</th><th>used by</th><th>kinds</th><th>ranges</th></tr>${internal.map(row).join("")}</table></div>
`, "dependencies");
}

/** The consistency report as a page: the health a maintainer asks about — Node
 *  engine spread, which packages miss the scripts most define, the ESM/CJS
 *  split, and the plain hygiene gaps. Convention-agnostic. */
export function renderConsistencyPage(c: WorkspaceConsistency, opts: ViewOptions = {}): string {
  const base = opts.base ?? "/";
  const plist = (names: readonly string[], limit = 40): string =>
    names.length
      ? `${names.slice(0, limit).map((n) => `<code>${esc(n.split("/").pop() ?? n)}</code>`).join(" ")}${names.length > limit ? ` <span class="muted">+${names.length - limit} more</span>` : ""}`
      : `<span class="muted">none</span>`;

  const engineRows = c.nodeEngines
    .map((b) => `<tr><td><code>${esc(b.range)}</code></td><td class="num">${b.packages.length}</td><td>${plist(b.packages)}</td></tr>`)
    .join("");
  const scriptRows = c.scripts
    .map((s) => `<tr><td><code>${esc(s.script)}</code></td><td class="num">${s.have}</td><td class="num">${s.missing.length}</td><td>${s.missing.length ? plist(s.missing) : '<span class="muted">— all have it</span>'}</td></tr>`)
    .join("");
  const typeRow = c.moduleTypes
    .map((t) => `<span><b>${t.count}</b> ${esc(t.type === "module" ? "ESM" : t.type === "commonjs" ? "CommonJS" : t.type)}</span>`)
    .join(" ");

  const lifeOrder = ["maintenance", "deprecated", "abandoned"] as const;
  const matOrder = ["experimental", "alpha", "beta", "stable"] as const;
  const lifeStats = `<span><b>${c.activeCount}</b> active</span>` +
    lifeOrder.filter((l) => c.lifecycleCounts[l] > 0).map((l) => `<span>${lifeBadge(l)} <b>${c.lifecycleCounts[l]}</b></span>`).join("");
  const matStats = matOrder.map((m) => `<span>${matBadge(m)} <b>${c.maturityCounts[m]}</b></span>`).join("");

  return tablePage(base, opts.title ?? "consistency — is the workspace coherent?", `
<div class="stats">
  <span><b>${c.packageCount}</b> packages</span>
  <span><b>${c.activeCount}</b> active (gaps measured against these)</span>
  <span><b>${c.nodeEngines.length}</b> distinct node engines</span>
  <span>${c.driftCount ? `<b>${c.driftCount}</b> dependencies drift ⚠` : "no dependency drift ✓"}</span>
</div>
<p class="muted">The plain health of the workspace, read off the manifests — no naming convention involved. The
hygiene gaps below count only the <b>active</b> set: <a href="${esc(link(base, "lifecycle"))}">deprecated and
abandoned</a> packages (${c.exempt.length}) are <b>exempt</b> — a package being removed or intentionally frozen is
not held to the live workspace's standards. The common scripts are the ones at least a quarter of the active
packages define.</p>

<h2>lifecycle &amp; maturity</h2>
<div class="stats">${lifeStats}</div>
<div class="stats">${matStats}</div>
<p class="muted">Lifecycle is the team's intent (from keywords); maturity is the release stage (from the version).
The full breakdown, the retirement queue, and the migration debt are on the
<a href="${esc(link(base, "lifecycle"))}">lifecycle</a> page.</p>

<h2>Node engine spread</h2>
<div class="grid-wrap"><table><tr><th>engines.node</th><th>packages</th><th>which</th></tr>${engineRows}
${c.noNodeEngine.length ? `<tr><td class="muted">— none declared</td><td class="num">${c.noNodeEngine.length}</td><td>${plist(c.noNodeEngine)}</td></tr>` : ""}</table></div>

<h2>script coverage</h2>
<div class="grid-wrap"><table><tr><th>script</th><th>have</th><th>missing</th><th>packages missing it</th></tr>${scriptRows}</table></div>
${c.noScripts.length ? `<p class="muted"><b>${c.noScripts.length}</b> package${c.noScripts.length === 1 ? "" : "s"} define no scripts at all: ${plist(c.noScripts)}</p>` : ""}

<h2>module system</h2>
<div class="stats">${typeRow}</div>

<h2>hygiene gaps</h2>
<p><b>${c.missingDescription.length}</b> without a description: ${plist(c.missingDescription)}</p>
<p><b>${c.missingLicense.length}</b> without a license: ${plist(c.missingLicense)}</p>
${c.driftCount ? `<p><b>${c.driftCount}</b> dependencies pinned at divergent versions — see <a href="${esc(link(base, "dependencies"))}">dependencies</a>: ${c.driftNames.map((n) => `<code>${esc(n)}</code>`).join(" ")}</p>` : ""}
`, "consistency");
}

/** The build order as a page: the dependency-respecting tiers in which the
 *  workspace builds, tier 0 first. A cycle (if any) is called out, since its
 *  members cannot be linearly ordered. */
export function renderBuildOrderPage(bo: BuildOrder, opts: ViewOptions = {}): string {
  const base = opts.base ?? "/";
  const plink = (n: string): string => `<a href="${depHref(base, n)}">${esc(n.split("/").pop() ?? n)}</a>`;
  const tierBlocks = bo.tiers
    .map((t, i) => `<div class="tier"><div class="tn">tier ${i}<span class="muted"> · ${t.length}</span></div><div class="tm">${t.map(plink).join(" ")}</div></div>`)
    .join("");
  const cycleBlock = bo.acyclic
    ? `<p class="muted">The internal dependency graph is acyclic — every package has a place in the order.</p>`
    : `<p><b>${bo.unordered.length}</b> package${bo.unordered.length === 1 ? "" : "s"} could not be ordered (they sit in or below a dependency cycle): ${bo.unordered.map(plink).join(" ")}. See <a href="${esc(link(base, "analysis"))}">analysis</a> for the cycles.</p>`;

  return tablePage(base, opts.title ?? "build order — in what order do the packages build?", `
<style>
.tier { display: flex; gap: .8rem; border: 1px solid #21262d; border-radius: 8px; margin: .4rem 0; padding: .4rem .6rem; }
.tier .tn { flex: none; width: 6rem; color: #8b949e; font-weight: 600; }
.tier .tm { display: flex; flex-wrap: wrap; gap: .25rem .55rem; }
</style>
<div class="stats">
  <span><b>${bo.order.length}</b> packages ordered</span>
  <span><b>${bo.tierCount}</b> tiers</span>
  <span>max parallelism <b>${bo.maxWidth}</b></span>
  <span>${bo.acyclic ? "acyclic ✓" : `<b>${bo.unordered.length}</b> in a cycle ⚠`}</span>
</div>
<p class="muted">A package builds once everything it depends on is built. These are the tiers of that topological
order: tier 0 has no internal dependencies, each later tier depends only on earlier ones — so a whole tier could
build in parallel. Edge direction is dependent → dependency.</p>
${cycleBlock}
<h2>tiers</h2>
${tierBlocks}
`, "build-order");
}

/** The lifecycle report as a page: the cohorts by disposition and maturity, the
 *  retirement queue (deprecated packages, with the active dependents that are
 *  the actual migration work), and the frozen contracts (abandoned packages and
 *  who rests on them). */
export function renderLifecyclePage(lc: WorkspaceLifecycle, opts: ViewOptions = {}): string {
  const base = opts.base ?? "/";
  const plink = (n: string): string => `<a href="${depHref(base, n)}">${esc(n.split("/").pop() ?? n)}</a>`;
  const lifeOrder = ["active", "maintenance", "deprecated", "abandoned"] as const;
  const matOrder = ["experimental", "alpha", "beta", "stable"] as const;

  const lifeStats = lifeOrder
    .map((l) => `<span>${l === "active" ? `<b>${lc.byLifecycle[l].length}</b> active` : `${lifeBadge(l)} <b>${lc.byLifecycle[l].length}</b>`}</span>`)
    .join(" ");
  const matStats = matOrder
    .map((m) => `<span>${matBadge(m)} <b>${lc.byMaturity[m].length}</b></span>`)
    .join(" ");

  const deprecatedBlock = lc.deprecated.length
    ? `<div class="grid-wrap"><table><tr><th>package</th><th>active dependents</th><th>all dependents</th><th>who still depends on it</th></tr>${lc.deprecated
        .map((d) => `<tr><td>${plink(d.name)} ${matBadge(d.maturity)}</td><td class="num${d.activeDependents.length ? " drift" : ""}">${d.activeDependents.length}</td><td class="num">${d.dependents.length}</td><td>${d.dependents.length ? d.dependents.map(plink).join(" ") : '<span class="muted">— nothing; safe to remove</span>'}</td></tr>`)
        .join("")}</table></div>`
    : `<p class="muted">No package is marked <code>deprecated</code>.</p>`;

  const abandonedBlock = lc.abandoned.length
    ? `<div class="grid-wrap"><table><tr><th>package</th><th>dependents</th><th>who rests on the frozen contract</th></tr>${lc.abandoned
        .map((d) => `<tr><td>${plink(d.name)} ${matBadge(d.maturity)}</td><td class="num">${d.dependents.length}</td><td>${d.dependents.length ? d.dependents.map(plink).join(" ") : '<span class="muted">— none</span>'}</td></tr>`)
        .join("")}</table></div>`
    : `<p class="muted">No package is marked <code>abandoned</code>.</p>`;

  return tablePage(base, opts.title ?? "lifecycle — disposition & maturity", `
<div class="stats">${lifeStats}</div>
<div class="stats">${matStats}</div>
<p class="muted">Two facts each package carries: its <b>lifecycle</b> — the team's intent, from keywords
(<code>deprecated</code> = being removed, <code>abandoned</code> = intentionally frozen, <code>maintenance</code>
= kept but not developed) — and its <b>maturity</b>, inferred from the version (<code>0.0.0</code> experimental,
<code>0.0.x</code> alpha, <code>0.x.y</code> beta, <code>&ge;1.0.0</code> stable). Deprecated and abandoned
packages are held out of the live workspace's <a href="${esc(link(base, "consistency"))}">consistency</a> checks.</p>

<h2>deprecated — the retirement queue</h2>
<p class="muted">Packages being removed. The work is the <b class="with-key">active dependents</b>: a deprecated
package nothing active depends on is already isolated and safe to delete; one with active dependents is migration
debt. <b>${lc.migrationDebt.length}</b> active→deprecated dependency edge${lc.migrationDebt.length === 1 ? "" : "s"} remain.</p>
${deprecatedBlock}

<h2>abandoned — the frozen contracts</h2>
<p class="muted">Packages that should stay stable regardless of ecosystem churn. They are exempt from consistency
pressure; their dependents are the blast radius if one ever did change.</p>
${abandonedBlock}
`, "lifecycle");
}

// ---------- the domain atlas (the catalog homepage) ----------

const ROLE_ACCENT = "#d2a8ff";

/** The seven canonical role chips for a domain, the ones it instantiates lit and
 *  the ones it never reaches dimmed — the faceted coverage read at a glance. Each
 *  chip links to that role's concept page, so the coverage is also a way in to
 *  the role vocabulary. */
function roleChips(present: readonly string[], base: string): string {
  const have = new Set(present);
  return `<span class="roles">${JSNODE_ROLES.map((r) => {
    const cls = `rc${have.has(r) ? " on" : ""}`;
    const title = `${r}${have.has(r) ? "" : " — absent"} — what ${r} means`;
    return `<a class="${cls}" href="${esc(link(base, "roles/" + encodeURIComponent(r)))}" title="${esc(title)}">${esc(r[0]!)}</a>`;
  }).join("")}</span>`;
}

const layerBadges = (layers: readonly string[]): string =>
  layers.map((l) => `<span class="lb" style="--c:${LAYER_SWATCH[l] ?? "#888"}">${esc(l)}</span>`).join(" ");

/** The catalog: every domain as a card with its synopsis, role coverage, layers,
 *  and import degree — the workspace browsed by *subject*, searchable by name,
 *  description, or member. This is the homepage: the semantic surface that leads
 *  with what each thing *is*, the dependency DAG one click away at /graph. */
export function renderAtlasPage(atlas: DomainAtlas, opts: ViewOptions = {}): string {
  const base = opts.base ?? "/";
  const title = opts.title ?? "the package atlas";
  const dlink = (d: string): string => esc(link(base, "domains/" + encodeURIComponent(d)));

  const cards = atlas.domains
    .map((d) => {
      const hay = esc(
        (d.domain + " " + d.synopsis + " " + d.members.map((m) => m.name).join(" ")).toLowerCase(),
      );
      const synopsis = d.synopsis
        ? `<p class="syn">${esc(d.synopsis)}</p>`
        : `<p class="syn muted">${d.size} package${d.size === 1 ? "" : "s"}${
            d.roles.length ? ` · ${d.roles.map(esc).join(", ")}` : ""
          } <span class="nodesc">(no description)</span></p>`;
      const deg = `<span class="deg">imports ${d.dependsOn.length} · used by ${d.dependedOnBy.length}</span>`;
      return `<article class="card" data-hay="${hay}">
  <h3><a href="${dlink(d.domain)}">${esc(d.domain)}</a> <span class="n">${d.size}</span></h3>
  ${roleChips(d.roles, base)}
  ${synopsis}
  <div class="cfoot">${layerBadges(d.layers)} ${deg}</div>
</article>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${SHELL_CSS}
main { max-width: 1180px; margin: 0 auto; padding: 1rem 1.2rem 3rem; }
.lead { color: #8b949e; margin: .3rem 0 1rem; max-width: 60rem; line-height: 1.5; }
.stats { display: flex; flex-wrap: wrap; gap: .5rem 1.4rem; margin: .5rem 0 1rem; }
.stats b { color: #e6edf3; } .stats span { color: #8b949e; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr)); gap: .8rem; }
.card { border: 1px solid #21262d; border-radius: 10px; padding: .7rem .85rem; background: #0f141a; }
.card.hide { display: none; }
.card h3 { margin: 0 0 .35rem; font-size: 1rem; word-break: break-word; }
.card h3 .n { color: #6e7681; font-weight: 400; font-size: .85rem; }
.roles { display: inline-flex; gap: .2rem; margin-bottom: .45rem; }
.rc { width: 1.1rem; height: 1.1rem; border-radius: 4px; display: inline-flex; align-items: center;
  justify-content: center; font-size: .72rem; border: 1px solid #30363d; color: #484f58;
  text-transform: uppercase; }
.rc.on { color: #0d1117; background: ${ROLE_ACCENT}; border-color: ${ROLE_ACCENT}; font-weight: 700; }
.syn { margin: 0 0 .5rem; line-height: 1.45; }
.syn.muted { color: #8b949e; } .nodesc { color: #6e7681; }
.cfoot { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .7rem; font-size: .8rem; }
.lb { color: var(--c); border: 1px solid var(--c); border-radius: 999px; padding: 0 .45rem; font-size: .72rem; }
.deg { color: #6e7681; margin-left: auto; }
.empty { color: #6e7681; padding: 2rem 0; }
</style>
</head><body>
<header>
  <h1>${esc(title)}</h1>
  <input id="q" type="search" placeholder="filter by subject, description, or package…" autocomplete="off">
  <div class="spacer"></div>
  ${navLinks(base, "")}
</header>
<main>
  <p class="lead">The workspace read along its <b>subject</b> facet. Every package is named
  <code>&lt;domain&gt;-&lt;role&gt;</code> — a two-facet classification in the sense of Ranganathan's
  Colon Classification, the domain its <em>Personality</em> facet and the role its <em>Energy</em> facet. This is
  the domain projection: each <a href="${esc(link(base, "domains"))}">domain</a> is a namespace gathering the
  packages that share its prefix. The <a href="${esc(link(base, "graph"))}">dependency graph</a>,
  <a href="${esc(link(base, "grid"))}">fibration grid</a>, and <a href="${esc(link(base, "quotient"))}">role
  quotient</a> read the same workspace through its structure.</p>
  <div class="stats">
    <span><b>${atlas.domainCount}</b> domains</span>
    <span><b>${atlas.packageCount}</b> packages</span>
  </div>
  <div class="cards" id="cards">${cards}</div>
  <p class="empty" id="empty" hidden>No domain matches.</p>
</main>
<script>
(() => {
  const q = document.getElementById("q");
  const cards = [...document.querySelectorAll(".card")];
  const empty = document.getElementById("empty");
  const refilter = () => {
    const t = q.value.trim().toLowerCase();
    let shown = 0;
    for (const c of cards) {
      const ok = !t || (c.getAttribute("data-hay") || "").includes(t);
      c.classList.toggle("hide", !ok);
      if (ok) shown++;
    }
    empty.hidden = shown !== 0;
  };
  q.addEventListener("input", refilter);
})();
</script>
</body></html>`;
}

// ---------- one domain's page ----------

const roleBadge = (role: string | null): string =>
  role
    ? `<span class="rb" style="--c:${ROLE_ACCENT}">${esc(role)}</span>`
    : `<span class="rb muted" style="--c:#6e7681">—</span>`;

/** One domain as a page: its representative synopsis, every member package with
 *  its own description and role, and the domains it imports and is imported by —
 *  the namespace opened up. RDF for the same resource is one click away. */
export function renderDomainPage(entry: DomainEntry, opts: ViewOptions = {}): string {
  const base = opts.base ?? "/";
  const dlink = (d: string): string =>
    `<a href="${esc(link(base, "domains/" + encodeURIComponent(d)))}">${esc(d)}</a>`;
  const plink = (n: string): string =>
    `<a href="${esc(link(base, "packages/" + encodeURIComponent(n)))}">${esc(n)}</a>`;
  // The domain resource itself: one URL, content-negotiated to JSON | Turtle | JSON-LD.
  const self = esc(link(base, "domains/" + encodeURIComponent(entry.domain)));

  const memberRows = entry.members
    .map(
      (m) =>
        `<tr><td>${plink(m.name)}</td><td>${roleBadge(m.role)}</td><td>${badge(m.layer)}</td>` +
        `<td class="num">${m.dependents}</td><td class="num">${m.dependencies}</td>` +
        `<td>${m.description ? esc(m.description) : '<span class="muted">—</span>'}</td></tr>`,
    )
    .join("");

  const synopsis = entry.synopsis
    ? `<blockquote class="syn">${esc(entry.synopsis)}<footer>— from ${plink(entry.synopsisFrom ?? "")}</footer></blockquote>`
    : `<p class="muted">No member of this domain carries a description.</p>`;

  const importsBlock = entry.dependsOn.length
    ? `<p>${entry.dependsOn.map(dlink).join(", ")}</p>`
    : `<p class="muted">none — this subject depends on no other.</p>`;
  const importersBlock = entry.dependedOnBy.length
    ? `<p>${entry.dependedOnBy.map(dlink).join(", ")}</p>`
    : `<p class="muted">none — nothing else depends on this subject.</p>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(entry.domain)} — domain</title>
<style>${SHELL_CSS}
main { max-width: 70rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
.meta { color: #8b949e; margin: 0 0 1rem; display: flex; flex-wrap: wrap; gap: .3rem .9rem; }
blockquote.syn { border-left: 3px solid ${ROLE_ACCENT}; margin: 0 0 1.4rem; padding: .3rem 0 .3rem 1rem;
  font-size: 1.08rem; line-height: 1.5; }
blockquote.syn footer { color: #6e7681; font-size: .82rem; margin-top: .35rem; }
h2 { font-size: .95rem; color: #8b949e; border-bottom: 1px solid #21262d; padding-bottom: .3rem; margin: 1.6rem 0 .5rem; }
table { border-collapse: collapse; font-size: 13px; width: 100%; }
th, td { border: 1px solid #21262d; padding: .3rem .5rem; text-align: left; vertical-align: top; }
th { color: #8b949e; font-weight: 600; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.rb { color: var(--c); border: 1px solid var(--c); border-radius: 999px; padding: 0 .5rem; font-size: .76rem; }
.rb.muted { opacity: .7; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.4rem; }
@media (max-width: 40rem) { .cols { grid-template-columns: 1fr; } }
.muted { color: #6e7681; } code { color: #d2a8ff; }
.rdf { font-size: .8rem; }
</style>
</head><body>
<header><a href="${esc(link(base, ""))}">← catalog</a><a href="${esc(link(base, "domains"))}">domains</a>
<div class="spacer"></div>
<span class="rdf"><a href="${self}">json</a> · <a href="${self}" title="content-negotiated: send Accept: text/turtle or application/ld+json">linked data</a></span></header>
<main>
  <h1>${esc(entry.domain)}</h1>
  <p class="meta"><b>${entry.size}</b> package${entry.size === 1 ? "" : "s"}
    <span>${roleChips(entry.roles, base)}</span>
    <span>${layerBadges(entry.layers)}</span>
    <span>${entry.internalEdges} internal edge${entry.internalEdges === 1 ? "" : "s"}</span></p>
  ${synopsis}
  <h2>packages (${entry.size})</h2>
  <table><tr><th>package</th><th>role</th><th>layer</th><th>dependents</th><th>deps</th><th>description</th></tr>${memberRows}</table>
  <div class="cols">
    <section><h2>imports (${entry.dependsOn.length} domains)</h2>${importsBlock}</section>
    <section><h2>imported by (${entry.dependedOnBy.length} domains)</h2>${importersBlock}</section>
  </div>
</main>
</body></html>`;
}

// ---------- the role lexicon (the role facet as a defined vocabulary) ----------

const roleHref = (base: string, role: string): string =>
  esc(link(base, "roles/" + encodeURIComponent(role)));

const classTag = (classification: string): string =>
  classification === "sibling"
    ? `<span class="ctag sib" title="observed alongside the canonical six, not one of them">carrier sibling</span>`
    : `<span class="ctag math">math layer</span>`;

// The stratum ladder: all seven roles in declared order, the current one lit —
// the "where it sits" context for one role's page.
function roleLadder(base: string, current: string | null): string {
  return `<span class="ladder">${JSNODE_ROLES.map((r) =>
    r === current
      ? `<span class="rung on">${esc(r)}</span>`
      : `<a class="rung" href="${roleHref(base, r)}">${esc(r)}</a>`,
  ).join('<span class="arr">→</span>')}</span>`;
}

const roleLinks = (base: string, roles: readonly string[]): string =>
  roles.length
    ? roles.map((r) => `<a href="${roleHref(base, r)}">${esc(r)}</a>`).join(", ")
    : `<span class="muted">none</span>`;

/** The role lexicon: every role as a defined concept — its stratum, its authored
 *  definition, and the live coverage (how many packages instantiate it, across
 *  how many domains). The Energy-facet dual of the domain atlas, and the piece
 *  that makes the naming convention legible: what each `<role>` suffix *means*. */
export function renderRoleCatalogPage(catalog: RoleCatalog, opts: ViewOptions = {}): string {
  const base = opts.base ?? "/";
  const title = opts.title ?? "the role lexicon";

  const cards = catalog.roles
    .map((r) => {
      const deg = `<span class="deg">${r.size} package${r.size === 1 ? "" : "s"} · ${r.domainCount} domain${r.domainCount === 1 ? "" : "s"}</span>`;
      const flow =
        r.dependsOn.length || r.dependedOnBy.length
          ? `<p class="flow"><span class="muted">depends on</span> ${roleLinks(base, r.dependsOn)} · <span class="muted">used by</span> ${roleLinks(base, r.dependedOnBy)}</p>`
          : "";
      return `<article class="card">
  <h3><span class="strat" title="declared stratum ${r.stratum}">${r.stratum}</span>
    <a href="${roleHref(base, r.role)}">${esc(r.role)}</a> ${classTag(r.classification)}</h3>
  <p class="gloss">${esc(r.gloss)}</p>
  ${flow}
  <div class="cfoot">${layerBadges(r.layers)} ${deg}</div>
</article>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${SHELL_CSS}
main { max-width: 1180px; margin: 0 auto; padding: 1rem 1.2rem 3rem; }
.lead { color: #8b949e; margin: .3rem 0 1rem; max-width: 62rem; line-height: 1.5; }
.stats { display: flex; flex-wrap: wrap; gap: .5rem 1.4rem; margin: .5rem 0 1rem; }
.stats b { color: #e6edf3; } .stats span { color: #8b949e; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(24rem, 1fr)); gap: .8rem; }
.card { border: 1px solid #21262d; border-radius: 10px; padding: .8rem .9rem; background: #0f141a; }
.card h3 { margin: 0 0 .4rem; font-size: 1.05rem; display: flex; align-items: center; gap: .45rem; }
.strat { width: 1.4rem; height: 1.4rem; border-radius: 50%; background: #161b22; border: 1px solid #30363d;
  color: #8b949e; display: inline-flex; align-items: center; justify-content: center; font-size: .8rem; flex: none; }
.ctag { font-size: .68rem; padding: 0 .4rem; border-radius: 999px; border: 1px solid #30363d; color: #8b949e; }
.ctag.math { color: #d2a8ff; border-color: #d2a8ff; }
.ctag.sib { color: #7d9c3f; border-color: #7d9c3f; }
.gloss { margin: 0 0 .55rem; line-height: 1.5; }
.flow { margin: 0 0 .55rem; font-size: .85rem; }
.cfoot { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .7rem; font-size: .8rem; }
.lb { color: var(--c); border: 1px solid var(--c); border-radius: 999px; padding: 0 .45rem; font-size: .72rem; }
.deg { color: #6e7681; margin-left: auto; }
</style>
</head><body>
<header>
  <h1>${esc(title)}</h1>
  <div class="spacer"></div>
  ${navLinks(base, "roles")}
</header>
<main>
  <p class="lead">The workspace read along its <b>role</b> facet — the <em>Energy</em> facet of the
  <code>&lt;domain&gt;-&lt;role&gt;</code> name. Every package instantiates one <em>role</em> functor
  (the suffix) over its <a href="${esc(link(base, "domains"))}">domain</a> (the prefix). This is the vocabulary of
  those roles: each one a <b>defined concept</b> in declared stratum order, its definition lifted faithfully from
  the workspace's own authored prose — never synthesised. The same roles drive the
  <a href="${esc(link(base, "grid"))}">fibration grid</a> and the <a href="${esc(link(base, "quotient"))}">role
  quotient</a>; here they are read as terms with meanings. Served as linked data (a SKOS concept scheme) at
  <code>/vocab</code> and per role at <code>/roles/&lt;role&gt;</code>.</p>
  <div class="stats">
    <span><b>${catalog.roleCount}</b> roles</span>
    <span><b>${catalog.packageCount}</b> roled packages</span>
    <span><b>${catalog.rolelessCount}</b> role-less (atoms &amp; apps)</span>
  </div>
  <div class="cards">${cards}</div>
</main>
</body></html>`;
}

// ---------- one role's concept page ----------

/** One role as a page: its authored definition (with provenance), its place in
 *  the stratum, and every package that instantiates it — across which domains,
 *  with which cross-role dependency. The Energy-facet analogue of the domain
 *  page; RDF for the same resource (a SKOS concept) is one click away. */
export function renderRoleConceptPage(entry: RoleCatalogEntry, opts: ViewOptions = {}): string {
  const base = opts.base ?? "/";
  const self = roleHref(base, entry.role);
  const plink = (n: string): string =>
    `<a href="${esc(link(base, "packages/" + encodeURIComponent(n)))}">${esc(n)}</a>`;
  const dlink = (d: string): string =>
    `<a href="${esc(link(base, "domains/" + encodeURIComponent(d)))}">${esc(d)}</a>`;

  const memberRows = entry.members
    .map(
      (m) =>
        `<tr><td>${plink(m.name)}</td><td>${dlink(m.domain)}</td>` +
        `<td>${m.qualifier ? `<code>${esc(m.qualifier)}</code>` : '<span class="muted">—</span>'}</td>` +
        `<td>${badge(m.layer)}</td><td class="num">${m.dependents}</td><td class="num">${m.dependencies}</td>` +
        `<td>${m.description ? esc(m.description) : '<span class="muted">—</span>'}</td></tr>`,
    )
    .join("");

  const flowCols = `<div class="cols">
    <section><h2>depends on (${entry.dependsOn.length} role${entry.dependsOn.length === 1 ? "" : "s"})</h2>
      <p>${roleLinks(base, entry.dependsOn)}</p>
      <p class="muted">roles whose packages this role's packages import.</p></section>
    <section><h2>used by (${entry.dependedOnBy.length} role${entry.dependedOnBy.length === 1 ? "" : "s"})</h2>
      <p>${roleLinks(base, entry.dependedOnBy)}</p>
      <p class="muted">roles whose packages depend on this role's packages.</p></section>
  </div>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(entry.role)} — role</title>
<style>${SHELL_CSS}
main { max-width: 72rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; display: flex; align-items: center; gap: .6rem; }
.strat { width: 1.7rem; height: 1.7rem; border-radius: 50%; background: #161b22; border: 1px solid #30363d;
  color: #8b949e; display: inline-flex; align-items: center; justify-content: center; font-size: .9rem; }
.ctag { font-size: .72rem; padding: .05rem .5rem; border-radius: 999px; border: 1px solid #30363d; color: #8b949e; }
.ctag.math { color: #d2a8ff; border-color: #d2a8ff; }
.ctag.sib { color: #7d9c3f; border-color: #7d9c3f; }
.meta { color: #8b949e; margin: 0 0 1rem; display: flex; flex-wrap: wrap; gap: .3rem .9rem; }
blockquote.def { border-left: 3px solid #d2a8ff; margin: 0 0 1rem; padding: .35rem 0 .35rem 1rem;
  font-size: 1.12rem; line-height: 1.55; }
blockquote.def footer { color: #6e7681; font-size: .8rem; margin-top: .45rem; }
.ladder { display: inline-flex; flex-wrap: wrap; align-items: center; gap: .35rem; margin: 0 0 1.4rem; font-size: .82rem; }
.ladder .rung { color: #79c0ff; padding: .05rem .4rem; border: 1px solid transparent; border-radius: 6px; }
.ladder .rung.on { color: #0d1117; background: #d2a8ff; font-weight: 700; }
.ladder .arr { color: #30363d; }
h2 { font-size: .95rem; color: #8b949e; border-bottom: 1px solid #21262d; padding-bottom: .3rem; margin: 1.6rem 0 .5rem; }
table { border-collapse: collapse; font-size: 13px; width: 100%; }
th, td { border: 1px solid #21262d; padding: .3rem .5rem; text-align: left; vertical-align: top; }
th { color: #8b949e; font-weight: 600; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.4rem; }
@media (max-width: 40rem) { .cols { grid-template-columns: 1fr; } }
.muted { color: #6e7681; } code { color: #d2a8ff; }
.rdf { font-size: .8rem; }
</style>
</head><body>
<header><a href="${esc(link(base, ""))}">← catalog</a><a href="${esc(link(base, "roles"))}">roles</a>
<div class="spacer"></div>
<span class="rdf"><a href="${self}">json</a> · <a href="${self}" title="content-negotiated: send Accept: text/turtle or application/ld+json">linked data</a></span></header>
<main>
  <h1><span class="strat" title="declared stratum ${entry.stratum}">${entry.stratum}</span>${esc(entry.role)} ${classTag(entry.classification)}</h1>
  <p class="meta"><b>${entry.size}</b> package${entry.size === 1 ? "" : "s"}
    <span>across <b>${entry.domainCount}</b> domain${entry.domainCount === 1 ? "" : "s"}</span>
    <span>${layerBadges(entry.layers)}</span>
    <span>${entry.internalEdges} within-role edge${entry.internalEdges === 1 ? "" : "s"}</span></p>
  <blockquote class="def">${esc(entry.gloss)}<footer>— definition lifted faithfully from ${esc(entry.source)}</footer></blockquote>
  ${roleLadder(base, entry.role)}
  ${flowCols}
  <h2>packages (${entry.size})</h2>
  <table><tr><th>package</th><th>domain</th><th>qualifier</th><th>layer</th><th>dependents</th><th>deps</th><th>description</th></tr>${memberRows}</table>
</main>
</body></html>`;
}

// ---------- the domain quotient (dual of the role quotient) ----------

/** The domain quotient as a page: the dependency graph contracted to subjects —
 *  which domains depend on which, whether that subject dependency is acyclic,
 *  and which subjects mutually entangle. The dual of the role quotient: where
 *  that collapses the domain axis, this collapses the role axis. */
export function renderDomainQuotientPage(q: DomainQuotientGraph, opts: ViewOptions = {}): string {
  const base = opts.base ?? "/";
  const dlink = (d: string): string =>
    `<a href="${esc(link(base, "domains/" + encodeURIComponent(d)))}">${esc(d)}</a>`;
  const total = q.withinDomainTotal + q.crossDomainTotal;
  const pct = (n: number): string => (total === 0 ? "0" : ((100 * n) / total).toFixed(0));

  const topDeps = q.mostDependedOn.slice(0, 20)
    .map((d, i) => `<tr><td class="num">${i + 1}</td><td>${dlink(d.domain)}</td><td class="num">${d.dependents}</td></tr>`)
    .join("");
  const heavy = q.edges.slice(0, 25)
    .map((e) => `<tr><td>${dlink(e.from)}</td><td>${dlink(e.to)}</td><td class="num">${e.weight}</td></tr>`)
    .join("");

  const entangledBlock = q.acyclic
    ? `<p>The subject dependency is <b>acyclic</b>: no two domains depend on each other. Some layering of the
       subjects is consistent with every cross-domain dependency — the subject graph is a genuine DAG.</p>`
    : `<p>The subject dependency is <b>not</b> acyclic — these domains mutually depend, so no subject layering is
       total:</p><ul class="flat">${q.entangled
        .map((c) => `<li>${c.map(dlink).join(" ⇄ ")}</li>`)
        .join("")}</ul>`;

  return tablePage(base, opts.title ?? "domain quotient — the dependency graph projected to subjects", `
<div class="stats">
  <span><b>${q.order}</b> domains</span>
  <span><b>${q.size}</b> cross-domain edges</span>
  <span><b>${q.withinDomainTotal}</b> within-domain (${pct(q.withinDomainTotal)}%)</span>
  <span><b>${q.crossDomainTotal}</b> cross-domain (${pct(q.crossDomainTotal)}%)</span>
  <span>${q.acyclic ? "subjects layer ✓" : `<b>${q.entangled.reduce((a, c) => a + c.length, 0)}</b> entangled`}</span>
</div>
<p class="muted">Every package contracted to its <a href="${esc(link(base, ""))}">domain</a> (its subject), parallel
edges and self-loops kept. This is the dual of the <a href="${esc(link(base, "quotient"))}">role quotient</a>:
that collapses the domain axis to read the role grading; this collapses the role axis to read the subject graph.
The two partition the same ${total} dependency edges — the within/cross split here matches the role quotient's
exactly. The <a href="${esc(link(base, "grid"))}">grid</a> lays out the full (domain, role) coordinate.</p>

<h2>is the subject dependency acyclic?</h2>
${entangledBlock}

<h2>most depended-on subjects</h2>
<p class="muted">Domains by the number of distinct other domains that depend on them — the subjects the workspace is most built upon.</p>
<div class="grid-wrap"><table><tr><th>#</th><th>domain</th><th>depended on by</th></tr>${topDeps}</table></div>

<h2>heaviest cross-domain dependencies</h2>
<p class="muted">The domain→domain edges carrying the most package dependencies (depending → depended-on).</p>
<div class="grid-wrap"><table><tr><th>from</th><th>to</th><th>edges</th></tr>${heavy}</table></div>
`, "domains");
}

// ---------- the type-flow category (composition surface) ----------

const tflink = (base: string, name: string): string =>
  `<a href="${esc(link(base, "typeflow/" + encodeURIComponent(name)))}">${esc(name)}</a>`;

export interface TypeFlowPageOptions extends ViewOptions {
  /** Total workspace packages, for the built-coverage line. */
  readonly totalPackages?: number;
}

/** The type-flow category as a page: the workspace's types as objects and its
 *  functions as the morphisms between them, with the composition edges
 *  (codomain meets domain) made explicit. Leads with the hubs — the carriers the
 *  most functions produce and consume — then the sources and sinks. */
export function renderTypeFlowPage(flow: WorkspaceTypeFlow, opts: TypeFlowPageOptions = {}): string {
  const base = opts.base ?? "/";
  const coverage =
    opts.totalPackages !== undefined
      ? `<b>${flow.packages}</b> of ${opts.totalPackages} packages built`
      : `<b>${flow.packages}</b> packages built`;

  const hubRows = flow.hubs
    .map(
      (h, i) =>
        `<tr><td class="num">${i + 1}</td><td>${tflink(base, h.name)}</td>` +
        `<td>${pkgHrefLink(base, h.pkg)}</td><td class="num">${h.producers}</td>` +
        `<td class="num">${h.consumers}</td><td class="num">${h.producers + h.consumers}</td></tr>`,
    )
    .join("");
  const sample = (names: readonly string[], n: number): string =>
    names.slice(0, n).map((x) => tflink(base, x)).join(", ") + (names.length > n ? ` … <span class="muted">(${names.length} total)</span>` : "");

  return tablePage(base, opts.title ?? "type flow — the workspace's composition category", `
<div class="stats">
  <span><b>${flow.order}</b> carrier types</span>
  <span><b>${flow.size}</b> composition edges</span>
  <span><b>${flow.crossPackageEdges}</b> cross-package seams</span>
  <span><b>${flow.sources.length}</b> sources</span>
  <span><b>${flow.sinks.length}</b> sinks</span>
  <span>${coverage}</span>
</div>
<p class="lead">The ecosystem's <b>types as objects, functions as morphisms</b> — and the one structure the
<a href="${esc(link(base, "packages"))}">flat type and function lists</a> leave implicit: <b>composition</b>.
An edge <code>A → B</code> means some function takes <code>A</code> and produces <code>B</code>, so a path through
this graph is a concrete <em>pipeline</em> that transforms one type into another. Composition type-checks exactly
when a codomain meets a domain — these edges <em>are</em> the valid one-step compositions. Each type is read by its
hom-functor: the functions that produce it (arrows in) and consume it (arrows out). Click any type for its
neighbourhood.</p>
<p class="muted">Edges are drawn only between <b>addressable</b> type names — declared in exactly one package — so a
name like <code>Options</code> or <code>Context</code> declared in several packages is never silently fused; the
<b>${flow.ambiguous}</b> ambiguous names are held out of the confident graph. Only built packages contribute a type
surface (${coverage}); an unbuilt package's carriers are invisible here until it is built.</p>

<h2>hub carriers — the most produced &amp; consumed types</h2>
<p class="muted">The objects with the largest hom-functors: the carriers the most functions flow into and out of —
the workspace's central types.</p>
<div class="grid-wrap"><table>
<tr><th>#</th><th>type</th><th>declared in</th><th>produced by</th><th>consumed by</th><th>total</th></tr>
${hubRows}
</table></div>

<h2>sources — carriers no function produces (${flow.sources.length})</h2>
<p class="muted">Pure inputs: types only ever consumed, never returned — the raw materials a pipeline must be given.</p>
<p>${sample(flow.sources, 60)}</p>

<h2>sinks — carriers no function consumes (${flow.sinks.length})</h2>
<p class="muted">Terminal outputs: types only ever produced, never fed onward — where a pipeline comes to rest.</p>
<p>${sample(flow.sinks, 60)}</p>
`, "typeflow");
}

export interface TypeFlowTypePageOptions extends ViewOptions {
  /** A shortest pipeline to a `?to=` target, when one was requested. */
  readonly pipeline?: { readonly to: string; readonly steps: readonly TypeFlowEdge[] | null };
  /** The declaring package's description, surfaced so the type's subject is
   *  legible without leaving the page. */
  readonly packageDescription?: string;
}

/** One type's hom-functor presentation as a page: the functions that produce and
 *  consume it, its one-step neighbours, and what it reaches by composition. The
 *  Yoneda reading — an object is what flows into and out of it — made walkable. */
export function renderTypeFlowTypePage(
  nb: TypeFlowNeighbourhood,
  opts: TypeFlowTypePageOptions = {},
): string {
  const base = opts.base ?? "/";
  const self = esc(link(base, "typeflow/" + encodeURIComponent(nb.name)));
  const fnLine = (f: { pkg: string; name: string; signature: string }): string =>
    `<li><code>${esc(f.signature)}</code> <span class="muted">— ${pkgHrefLink(base, f.pkg)}</span></li>`;
  const fnList = (fns: readonly { pkg: string; name: string; signature: string }[]): string =>
    fns.length ? `<ul class="sigs">${fns.map(fnLine).join("")}</ul>` : `<p class="muted">none</p>`;
  const typeList = (refs: readonly { name: string }[], cap: number): string =>
    refs.length
      ? `<p>${refs.slice(0, cap).map((r) => tflink(base, r.name)).join(", ")}${refs.length > cap ? ` … <span class="muted">(${refs.length} total)</span>` : ""}</p>`
      : `<p class="muted">none</p>`;

  const pipe = opts.pipeline;
  const pipelineBlock = pipe
    ? pipe.steps === null
      ? `<section class="pipe"><h2>pipeline to ${tflink(base, pipe.to)}</h2><p class="muted">No composition pipeline reaches <code>${esc(pipe.to)}</code> from here.</p></section>`
      : pipe.steps.length === 0
        ? `<section class="pipe"><h2>pipeline to ${tflink(base, pipe.to)}</h2><p class="muted">Same type — the identity.</p></section>`
        : `<section class="pipe"><h2>shortest pipeline to ${tflink(base, pipe.to)} (${pipe.steps.length} step${pipe.steps.length === 1 ? "" : "s"})</h2>
<ol class="steps">${pipe.steps
            .map((s) => `<li>${tflink(base, s.from)} <span class="muted">→</span> <code>${esc(s.fn)}</code> <span class="muted">(${pkgHrefLink(base, s.pkg)})</span> <span class="muted">→</span> ${tflink(base, s.to)}</li>`)
            .join("")}</ol></section>`
    : "";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(nb.name)} — type flow</title>
<style>${SHELL_CSS}
main { max-width: 70rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
h1 { font-size: 1.4rem; margin: 0 0 .25rem; word-break: break-all; }
.meta { color: #8b949e; margin: 0 0 1rem; display: flex; flex-wrap: wrap; gap: .3rem .9rem; }
.lead { color: #8b949e; line-height: 1.5; margin: 0 0 1.4rem; }
h2 { font-size: .95rem; color: #8b949e; border-bottom: 1px solid #21262d; padding-bottom: .3rem; margin: 1.6rem 0 .5rem; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.4rem; }
@media (max-width: 44rem) { .cols { grid-template-columns: 1fr; } }
ul.sigs { margin: .4rem 0; padding-left: 1.1rem; } ul.sigs li { margin: .25rem 0; line-height: 1.4; }
ol.steps { margin: .5rem 0; padding-left: 1.4rem; } ol.steps li { margin: .3rem 0; }
.pipe { margin-top: 1.6rem; }
blockquote.pkgdesc { border-left: 3px solid #d2a8ff; margin: 0 0 1rem; padding: .2rem 0 .2rem 1rem;
  color: #adbac7; line-height: 1.5; }
blockquote.pkgdesc footer { color: #6e7681; font-size: .82rem; margin-top: .3rem; }
.muted { color: #6e7681; } code { color: #d2a8ff; }
.rb { color: var(--c); border: 1px solid var(--c); border-radius: 999px; padding: 0 .5rem; font-size: .76rem; }
.rdf { font-size: .8rem; }
</style>
</head><body>
<header><a href="${esc(link(base, "typeflow"))}">← type flow</a>
<a href="${esc(link(base, "packages/" + encodeURIComponent(nb.pkg)))}">${esc(nb.pkg)}</a>
<div class="spacer"></div>
<span class="rdf"><a href="${self}">json</a> · <a href="${self}" title="content-negotiated: send Accept: text/turtle or application/ld+json">linked data</a></span></header>
<main>
  <h1>${esc(nb.name)}</h1>
  <p class="meta"><span class="rb" style="--c:#d2a8ff">${esc(nb.typeKind)}</span>
    <span>declared in ${pkgHrefLink(base, nb.pkg)}</span>
    <span>${nb.producedBy.length} producer${nb.producedBy.length === 1 ? "" : "s"}</span>
    <span>${nb.consumedBy.length} consumer${nb.consumedBy.length === 1 ? "" : "s"}</span></p>
  ${opts.packageDescription ? `<blockquote class="pkgdesc">${esc(opts.packageDescription)}<footer>— ${pkgHrefLink(base, nb.pkg)}</footer></blockquote>` : ""}
  <p class="lead">This type read by its <b>hom-functor</b>: an object is determined, up to isomorphism, by the
  morphisms into and out of it. The functions that <em>produce</em> it are the arrows in; the functions that
  <em>consume</em> it are the arrows out. Following them composes a pipeline.</p>
  ${pipelineBlock}
  <div class="cols">
    <section><h2>produced by (${nb.producedBy.length})</h2><p class="muted">functions whose codomain is this type</p>${fnList(nb.producedBy)}</section>
    <section><h2>consumed by (${nb.consumedBy.length})</h2><p class="muted">functions taking this type as an argument</p>${fnList(nb.consumedBy)}</section>
  </div>
  <div class="cols">
    <section><h2>one step upstream (${nb.upstream.length})</h2><p class="muted">types that transform into this one</p>${typeList(nb.upstream, 40)}</section>
    <section><h2>one step downstream (${nb.downstream.length})</h2><p class="muted">types this one transforms into</p>${typeList(nb.downstream, 40)}</section>
  </div>
  <div class="cols">
    <section><h2>reaches by composition (${nb.reaches.length})</h2><p class="muted">every type reachable downstream</p>${typeList(nb.reaches, 80)}</section>
    <section><h2>reachable from (${nb.reachableFrom.length})</h2><p class="muted">every type from which this is reachable</p>${typeList(nb.reachableFrom, 80)}</section>
  </div>
</main>
</body></html>`;
}
