/**
 * spectrum — exact spectral geometry of bounded slices of the workspace
 * dependency graph, in native bignum.
 *
 * {@link ./analysis.mjs} notes that `@emsenn/meme-analysis` defines the exact
 * spectral invariants of a graph — the component count as the Laplacian's
 * nullity, the characteristic polynomial as the entire exact content of the
 * spectrum, and the weighted spanning-tree count as a reduced-Laplacian
 * determinant — but that its hereditarily-finite-set arithmetic, where an
 * integer V costs O(V), OOMs at workspace scale (the whole-workspace Laplacian
 * determinant is a ninety-digit integer the ordinal naturals cannot hold). Its
 * own header proposes "wiring the exact functor onto bounded slices" as the
 * natural next step. This module is that step, sharpened by two moves:
 *
 *  1. SLICE. The neighbourhood of a single package is a bounded graph whose
 *     invariants are small, legible, and attached to a locus. Computed for every
 *     package, they are a *field* of local harmonic complexity over the
 *     workspace — how redundantly each package's dependency neighbourhood is
 *     wired — rather than one illegible number at the graph's root.
 *  2. NATIVE BIGNUM. The invariants are exact integers; only the ordinal
 *     representation of them is expensive. Over JavaScript `bigint` the same
 *     exact values are ordinary machine words-of-words — no float, no OOM. A
 *     `Number` path (see {@link numericSpanningTreeCount}) stands by for any
 *     slice large enough that even the bigint determinant would be costly; at
 *     radius 1 no neighbourhood reaches it, but the guard keeps the surface
 *     honest where it might.
 *
 * The undirected reading: a dependency edge a→b is read as the unweighted
 * undirected edge {a,b}. Its graph Laplacian is the constant-sheaf Laplacian of
 * the neighbourhood (the agent-graph the corpus's sheaf-consensus theory treats
 * as its base case), so the spanning-tree count is exactly Kirchhoff's and the
 * characteristic polynomial carries the neighbourhood's own harmonics.
 *
 * Pure functions of the graph; no I/O.
 */
import { egoGraph } from "./graph.mjs";
import type { WorkspaceDependencyGraph } from "./graph.mjs";

// ---------- exact bignum linear algebra ----------

/** The combinatorial Laplacian L = D − A of a symmetric 0/1 adjacency, exact
 *  integer entries (bigint). */
export function integerLaplacian(adjacency: readonly (readonly number[])[]): bigint[][] {
  const n = adjacency.length;
  return adjacency.map((row, i) => {
    const out = new Array<bigint>(n).fill(0n);
    let degree = 0n;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (row[j]) {
        out[j] = -1n;
        degree += 1n;
      }
    }
    out[i] = degree;
    return out;
  });
}

/** Fraction-free (Bareiss) determinant of an integer matrix, exact. The
 *  intermediate quotients are always exact integers — that is the point of
 *  Bareiss — so this never leaves ℤ. */
export function bareissDeterminant(matrix: readonly (readonly bigint[])[]): bigint {
  const n = matrix.length;
  if (n === 0) return 1n;
  const m = matrix.map((row) => [...row]);
  let prev = 1n;
  let sign = 1n;
  for (let k = 0; k < n - 1; k++) {
    if (m[k]![k] === 0n) {
      let swap = -1;
      for (let i = k + 1; i < n; i++) {
        if (m[i]![k] !== 0n) {
          swap = i;
          break;
        }
      }
      if (swap === -1) return 0n;
      [m[k], m[swap]] = [m[swap]!, m[k]!];
      sign = -sign;
    }
    const pivot = m[k]![k]!;
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++) {
        m[i]![j] = (m[i]![j]! * pivot - m[i]![k]! * m[k]![j]!) / prev;
      }
    }
    prev = pivot;
  }
  return sign * m[n - 1]![n - 1]!;
}

/** Rank of an integer matrix over ℚ, by fraction-free elimination — the number
 *  of nonzero pivots, computed exactly. */
export function fractionFreeRank(matrix: readonly (readonly bigint[])[]): number {
  const n = matrix.length;
  if (n === 0) return 0;
  const cols = matrix[0]!.length;
  const m = matrix.map((row) => [...row]);
  let prev = 1n;
  let r = 0;
  for (let col = 0; col < cols && r < n; col++) {
    let pivot = -1;
    for (let i = r; i < n; i++) {
      if (m[i]![col] !== 0n) {
        pivot = i;
        break;
      }
    }
    if (pivot === -1) continue;
    [m[r], m[pivot]] = [m[pivot]!, m[r]!];
    for (let i = r + 1; i < n; i++) {
      for (let j = col + 1; j < cols; j++) {
        m[i]![j] = (m[i]![j]! * m[r]![col]! - m[i]![col]! * m[r]![j]!) / prev;
      }
      m[i]![col] = 0n;
    }
    prev = m[r]![col]!;
    r++;
  }
  return r;
}

/** The characteristic polynomial det(xI − L) by the division-free
 *  Samuelson–Berkowitz algorithm, exact integer coefficients lowest-degree
 *  first (monic, so the leading coefficient is 1). Division-free keeps it in ℤ
 *  with no Bareiss bookkeeping; the entire exact content of the spectrum, whose
 *  numeric roots — eigenvalues — are a boundary question this surface does not
 *  cross. */
export function berkowitzCharPoly(matrix: readonly (readonly bigint[])[]): bigint[] {
  const n = matrix.length;
  if (n === 0) return [1n];
  const a = (i: number, j: number): bigint => matrix[i]![j]!;
  // p accumulates char-poly coefficients highest-degree first; the char poly of
  // the empty 0×0 minor is 1.
  let p: bigint[] = [1n];
  for (let size = 1; size <= n; size++) {
    const corner = a(size - 1, size - 1);
    const sub = size - 1; // order of the leading principal minor B
    // First column of the (size+1)×size lower-triangular Toeplitz factor:
    //   c0 = 1, c1 = −corner, c_{k+2} = −(R · B^k · S).
    const c = new Array<bigint>(size + 1).fill(0n);
    c[0] = 1n;
    c[1] = -corner;
    if (sub >= 1) {
      const row: bigint[] = [];
      const colVec: bigint[] = [];
      for (let i = 0; i < sub; i++) {
        row.push(a(size - 1, i));
        colVec.push(a(i, size - 1));
      }
      let sVec = colVec;
      for (let k = 0; k <= sub - 1; k++) {
        let dot = 0n;
        for (let i = 0; i < sub; i++) dot += row[i]! * sVec[i]!;
        c[k + 2] = -dot;
        const next = new Array<bigint>(sub).fill(0n);
        for (let i = 0; i < sub; i++) {
          let acc = 0n;
          for (let j = 0; j < sub; j++) acc += a(i, j) * sVec[j]!;
          next[i] = acc;
        }
        sVec = next;
      }
    }
    const np = new Array<bigint>(size + 1).fill(0n);
    for (let i = 0; i < size + 1; i++) {
      let acc = 0n;
      for (let j = 0; j < size; j++) {
        const ci = i - j;
        if (ci >= 0 && ci < c.length) acc += c[ci]! * p[j]!;
      }
      np[i] = acc;
    }
    p = np;
  }
  // p is highest-degree first and monic (p[0] = 1); present lowest-degree first.
  return p.reverse();
}

// ---------- the spectral reading of a graph ----------

/** The exact spectral invariants of an undirected graph given by a symmetric
 *  0/1 adjacency. */
export interface GraphSpectrum {
  readonly order: number;
  /** Undirected edges. */
  readonly size: number;
  /** Connected components — the multiplicity of the Laplacian's zero eigenvalue,
   *  read exactly as its rank deficiency. */
  readonly components: number;
  /** Weighted spanning-tree count (Kirchhoff): the determinant of the Laplacian
   *  with one vertex struck. Zero exactly when the graph is disconnected. */
  readonly spanningTrees: bigint;
  /** First Betti number E − V + C: the independent cycles, the dimension of the
   *  graph's cycle space — how far the neighbourhood is from a forest. */
  readonly cyclomatic: number;
  /** The Laplacian characteristic polynomial, exact, lowest degree first. */
  readonly characteristicPolynomial: readonly bigint[];
}

const edgeCount = (adjacency: readonly (readonly number[])[]): number => {
  let e = 0;
  for (let i = 0; i < adjacency.length; i++) {
    for (let j = i + 1; j < adjacency.length; j++) if (adjacency[i]![j]) e++;
  }
  return e;
};

/** Spanning-tree count of an undirected graph (Matrix-Tree): the determinant of
 *  the Laplacian with its first row and column struck. The empty and one-vertex
 *  graphs have the single empty tree. */
export function spanningTreeCount(adjacency: readonly (readonly number[])[]): bigint {
  const n = adjacency.length;
  if (n <= 1) return 1n;
  const laplacian = integerLaplacian(adjacency);
  const reduced = laplacian.slice(1).map((row) => row.slice(1));
  return bareissDeterminant(reduced);
}

/** Component count of an undirected graph as the Laplacian's nullity. */
export function spectralComponentCount(adjacency: readonly (readonly number[])[]): number {
  const n = adjacency.length;
  if (n === 0) return 0;
  return n - fractionFreeRank(integerLaplacian(adjacency));
}

/** A `Number`-valued (floating) spanning-tree count, for any slice too large for
 *  the exact bignum determinant to stay cheap. The repo is float-free by
 *  preference, so this is a guarded fallback, never the default; callers mark a
 *  result it produced as inexact. */
export function numericSpanningTreeCount(adjacency: readonly (readonly number[])[]): number {
  const n = adjacency.length;
  if (n <= 1) return 1;
  const laplacian = integerLaplacian(adjacency).map((row) => row.map((v) => Number(v)));
  const reduced = laplacian.slice(1).map((row) => row.slice(1));
  // Plain Gaussian elimination with partial pivoting; the determinant is the
  // product of pivots.
  const m = reduced.map((row) => [...row]);
  const k = m.length;
  let det = 1;
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let i = col + 1; i < k; i++) if (Math.abs(m[i]![col]!) > Math.abs(m[pivot]![col]!)) pivot = i;
    if (m[pivot]![col] === 0) return 0;
    if (pivot !== col) {
      [m[col], m[pivot]] = [m[pivot]!, m[col]!];
      det = -det;
    }
    det *= m[col]![col]!;
    for (let i = col + 1; i < k; i++) {
      const factor = m[i]![col]! / m[col]![col]!;
      for (let j = col; j < k; j++) m[i]![j]! -= factor * m[col]![j]!;
    }
  }
  return Math.round(det);
}

/** Above this neighbourhood order the exact characteristic polynomial (O(n⁴)
 *  bignum work) is skipped and the tree count falls back to {@link
 *  numericSpanningTreeCount}. Radius-1 neighbourhoods stay well under it. */
export const EXACT_SLICE_LIMIT = 256;

/** The exact spectral reading of an undirected graph. */
export function graphSpectrum(adjacency: readonly (readonly number[])[]): GraphSpectrum {
  const order = adjacency.length;
  const size = edgeCount(adjacency);
  const components = spectralComponentCount(adjacency);
  const spanningTrees = spanningTreeCount(adjacency);
  return {
    order,
    size,
    components,
    spanningTrees,
    cyclomatic: size - order + components,
    characteristicPolynomial: berkowitzCharPoly(integerLaplacian(adjacency)),
  };
}

// ---------- per-package neighbourhood spectra over the workspace graph ----------

/** The spectral signature of one package's dependency neighbourhood. Bignums are
 *  carried as decimal strings so the carrier serialises to JSON unchanged. */
export interface PackageSpectrum {
  readonly kind: "jsnode.package-spectrum";
  readonly name: string;
  /** Packages in the radius-1 neighbourhood (the focus, its dependencies, and
   *  its dependents). */
  readonly order: number;
  /** Undirected dependency edges among them. */
  readonly size: number;
  readonly components: number;
  /** Kirchhoff spanning-tree count of the neighbourhood, exact, decimal string —
   *  the number of ways the neighbourhood could be re-wired as a spanning tree;
   *  1 for a tree/star, larger the more redundantly it is connected. */
  readonly spanningTrees: string;
  /** First Betti number (independent cycles) of the neighbourhood. */
  readonly cyclomatic: number;
  /** True when the tree count is the exact bignum value; false when the slice
   *  exceeded {@link EXACT_SLICE_LIMIT} and the `Number` fallback was used. */
  readonly exact: boolean;
  /** Degree of the Laplacian characteristic polynomial (= order). */
  readonly charPolyDegree: number;
  /** Characteristic polynomial coefficients, lowest degree first, exact, decimal
   *  strings. Present only when the slice is within {@link EXACT_SLICE_LIMIT}. */
  readonly charPoly?: readonly string[];
}

/** Build the symmetric 0/1 adjacency over a closed dependency subgraph (edge
 *  direction discarded — the constant-sheaf agent-graph reading). */
function symmetricAdjacency(slice: WorkspaceDependencyGraph): {
  names: string[];
  adjacency: number[][];
} {
  const names = slice.nodes.map((n) => n.name);
  const index = new Map(names.map((n, i) => [n, i] as const));
  const adjacency = names.map(() => new Array<number>(names.length).fill(0));
  for (const e of slice.edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) {
      adjacency[a]![b] = 1;
      adjacency[b]![a] = 1;
    }
  }
  return { names, adjacency };
}

/** The spectral signature of one package's radius-1 dependency neighbourhood.
 *  Returns undefined when the package is not a node of the graph. */
export function packageNeighbourhoodSpectrum(
  graph: WorkspaceDependencyGraph,
  name: string,
): PackageSpectrum | undefined {
  const slice = egoGraph(graph, name, { upDepth: 1, downDepth: 1 });
  if (slice.nodes.length === 0) return undefined;
  const { adjacency } = symmetricAdjacency(slice);
  const order = adjacency.length;
  const size = edgeCount(adjacency);
  const components = spectralComponentCount(adjacency);
  const cyclomatic = size - order + components;
  if (order > EXACT_SLICE_LIMIT) {
    return {
      kind: "jsnode.package-spectrum",
      name,
      order,
      size,
      components,
      spanningTrees: String(numericSpanningTreeCount(adjacency)),
      cyclomatic,
      exact: false,
      charPolyDegree: order,
    };
  }
  return {
    kind: "jsnode.package-spectrum",
    name,
    order,
    size,
    components,
    spanningTrees: spanningTreeCount(adjacency).toString(),
    cyclomatic,
    exact: true,
    charPolyDegree: order,
    charPoly: Object.freeze(berkowitzCharPoly(integerLaplacian(adjacency)).map((c) => c.toString())),
  };
}

/** A package's neighbourhood spectrum without the characteristic polynomial —
 *  the cheap O(n³) part, for the ranked whole-workspace field. */
export interface PackageSpectrumSummary {
  readonly name: string;
  readonly order: number;
  readonly size: number;
  readonly components: number;
  readonly spanningTrees: string;
  readonly cyclomatic: number;
  readonly exact: boolean;
}

/** The whole-workspace spectral field: every package's neighbourhood spectrum,
 *  ranked by spanning-tree count — most redundantly-wired neighbourhood first.
 *  The characteristic polynomials are omitted here (they are the per-package
 *  surface); this is the O(n³)-per-package summary, cheap over the whole graph. */
export interface WorkspaceSpectrum {
  readonly kind: "jsnode.spectrum";
  /** Packages whose neighbourhood was read. */
  readonly order: number;
  /** The graph's own connected-component count, computed *spectrally* — the
   *  multiplicity of the whole-graph Laplacian's zero eigenvalue, read as its
   *  exact rank deficiency — as an independent cross-check against the
   *  combinatorial (BFS) component count in {@link ./analysis.mjs}. The two
   *  agree by theorem; computing this one by the other route makes the agreement
   *  a check rather than a tautology. */
  readonly components: number;
  /** Neighbourhoods that are trees (spanning-tree count 1): no local redundancy,
   *  the dependency neighbourhood is already minimal. */
  readonly treeNeighbourhoods: number;
  readonly spectra: readonly PackageSpectrumSummary[];
}

/** The spectral component count of the whole graph: the multiplicity of the
 *  zero eigenvalue of its (undirected) Laplacian, read as the exact rank
 *  deficiency in native bignum. This is the genuine spectral route to the
 *  number {@link ./analysis.mjs} also reaches combinatorially by BFS — so their
 *  agreement is an independent check, not one method confirming itself. The
 *  whole-graph fraction-free rank is the one unsliced exact computation here,
 *  and at workspace order it runs in a fraction of a second, once. */
function spectralWholeGraphComponents(graph: WorkspaceDependencyGraph): number {
  return spectralComponentCount(symmetricAdjacency(graph).adjacency);
}

/** Compute the workspace spectral field. */
export function workspaceSpectrum(graph: WorkspaceDependencyGraph): WorkspaceSpectrum {
  const spectra: PackageSpectrumSummary[] = [];
  let treeNeighbourhoods = 0;
  for (const node of graph.nodes) {
    const slice = egoGraph(graph, node.name, { upDepth: 1, downDepth: 1 });
    const { adjacency } = symmetricAdjacency(slice);
    const order = adjacency.length;
    const size = edgeCount(adjacency);
    const components = spectralComponentCount(adjacency);
    const exact = order <= EXACT_SLICE_LIMIT;
    const trees = exact ? spanningTreeCount(adjacency) : BigInt(numericSpanningTreeCount(adjacency));
    if (trees === 1n) treeNeighbourhoods++;
    spectra.push({
      name: node.name,
      order,
      size,
      components,
      spanningTrees: trees.toString(),
      cyclomatic: size - order + components,
      exact,
    });
  }
  // Rank by spanning-tree count (a bignum), most redundantly-wired first, then
  // by neighbourhood order, then name, for a stable reading.
  spectra.sort((a, b) => {
    const ta = BigInt(a.spanningTrees);
    const tb = BigInt(b.spanningTrees);
    if (ta !== tb) return tb > ta ? 1 : -1;
    return b.order - a.order || a.name.localeCompare(b.name);
  });
  return {
    kind: "jsnode.spectrum",
    order: graph.nodes.length,
    components: spectralWholeGraphComponents(graph),
    treeNeighbourhoods,
    spectra: Object.freeze(spectra),
  };
}
