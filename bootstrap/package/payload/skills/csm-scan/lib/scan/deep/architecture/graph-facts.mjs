// Graph-facts computation for the Architecture dimension.
//
// T217 owns this module. It turns the validated static import graph into raw,
// deterministic, verdict-free facts:
//   - explicit-edge fan-in / fan-out counts
//   - edge-kind counts (the syntactic construct that produced each edge)
//   - self-loops (files that import themselves)
//   - Tarjan strongly-connected components
//   - disclosed graph bounds (files/edges inspected and omitted against caps)
//
// Guarantees:
//   - All results are deep-frozen plain data; mutation throws.
//   - Every list/map is sorted with an explicit comparator; identical inputs
//     produce byte-identical output regardless of insertion order.
//   - Only raw counts and identities are emitted. No hub/coupling/quality
//     verdict, ranking, or recommendation is produced.
//   - Edge-kind totals always agree with the graph's own edge count when no
//     cap is active (see the parity tests).
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only the evidence contract
// (for `compareAscii`/`deepFreeze`) and never touches node:fs /
// node:child_process / node:process / node:vm / node:module.

import { compareAscii, deepFreeze } from '../../contracts/evidence.mjs';

export const GRAPH_FACTS_LIMITS = deepFreeze({
  edges: 500_000,
  files: 50_000,
  indicators: 20_000,
});

// A component is "cyclic" when it contains at least one cycle, which for a
// directed graph is any SCC with two or more vertices.
const CYCLIC_MIN_SIZE = 2;

/**
 * Compute explicit-edge fan-in and fan-out for every file in the graph.
 *
 * @param {object} graph - `{ [sourceFile]: string[] }` adjacency map.
 * @returns {{ fanIn: object, fanOut: object }} Deep-frozen maps keyed by
 *   repository-relative file path with integer counts. Every graph vertex is
 *   present in both maps (files without incoming edges have fan-in 0).
 */
export function computeFanInOut(graph) {
  const fanOut = {};
  const fanIn = {};
  for (const file of Object.keys(graph)) {
    fanOut[file] = (graph[file] || []).length;
  }
  for (const [source, targets] of Object.entries(graph)) {
    for (const target of targets) {
      fanIn[target] = (fanIn[target] || 0) + 1;
    }
  }
  for (const file of Object.keys(graph)) {
    if (fanIn[file] === undefined) fanIn[file] = 0;
  }
  return deepFreeze({ fanIn, fanOut });
}

/**
 * List files that import themselves.
 *
 * @param {object} graph - `{ [sourceFile]: string[] }` adjacency map.
 * @returns {string[]} Sorted repository-relative paths of self-loop files.
 */
export function computeSelfLoops(graph) {
  const loops = Object.keys(graph).filter((file) => (graph[file] || []).includes(file));
  loops.sort(compareAscii);
  return deepFreeze(loops);
}

/**
 * Aggregate edge-kind counts across the graph.
 *
 * @param {object} edgeKinds - `{ [sourceFile]: { [targetFile]: kind } }`.
 * @returns {object} Deep-frozen `{ [kind]: count }` with deterministic order.
 */
export function computeEdgeKindCounts(edgeKinds) {
  const counts = {};
  for (const targets of Object.values(edgeKinds)) {
    for (const kind of Object.values(targets)) {
      counts[kind] = (counts[kind] || 0) + 1;
    }
  }
  return deepFreeze(Object.fromEntries(Object.keys(counts).sort(compareAscii)
    .map((kind) => [kind, counts[kind]])));
}

/**
 * Compute the strongly-connected components of a directed graph with Tarjan's
 * algorithm. Vertices are visited in sorted order so the result is
 * deterministic; members of each component are sorted too.
 *
 * @param {object} graph - `{ [sourceFile]: string[] }` adjacency map.
 * @returns {object} Deep-frozen `{ totalComponents, singletonComponents,
 *   cyclicComponents }`. `cyclicComponents` lists only components with two or
 *   more vertices (each is `{ size, members }`), sorted by size descending and
 *   then by first member ascending.
 */
export function tarjanStronglyConnectedComponents(graph) {
  const vertices = Object.keys(graph).sort(compareAscii);
  const indexByVertex = new Map();
  const lowLinkByVertex = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let index = 0;

  const strongConnect = (vertex) => {
    indexByVertex.set(vertex, index);
    lowLinkByVertex.set(vertex, index);
    index += 1;
    stack.push(vertex);
    onStack.add(vertex);

    const targets = (graph[vertex] || []).slice().sort(compareAscii);
    for (const target of targets) {
      if (!indexByVertex.has(target)) {
        strongConnect(target);
        lowLinkByVertex.set(vertex, Math.min(lowLinkByVertex.get(vertex), lowLinkByVertex.get(target)));
      } else if (onStack.has(target)) {
        lowLinkByVertex.set(vertex, Math.min(lowLinkByVertex.get(vertex), indexByVertex.get(target)));
      }
    }

    if (lowLinkByVertex.get(vertex) === indexByVertex.get(vertex)) {
      const member = [];
      let current;
      do {
        current = stack.pop();
        onStack.delete(current);
        member.push(current);
      } while (current !== vertex);
      member.sort(compareAscii);
      components.push(member);
    }
  };

  for (const vertex of vertices) {
    if (!indexByVertex.has(vertex)) strongConnect(vertex);
  }

  components.sort((left, right) => right.length - left.length
    || compareAscii(left[0], right[0]));

  const cyclicComponents = components
    .filter((component) => component.length >= CYCLIC_MIN_SIZE)
    .map((member) => deepFreeze({ size: member.length, members: deepFreeze(member) }));
  const singletonComponents = components.reduce(
    (count, component) => count + (component.length === 1 ? 1 : 0),
    0,
  );
  return deepFreeze({
    totalComponents: components.length,
    singletonComponents,
    cyclicComponents: deepFreeze(cyclicComponents),
  });
}

/**
 * Disclose the graph measurement bounds.
 *
 * @param {object} input - `{ filesInspected, fileLimit, filesOmitted,
 *   edgesInspected, edgeLimit, edgesOmitted }`.
 * @returns {object} Deep-frozen bounds record with a derived `capped` flag.
 */
export function computeBounds({
  filesInspected,
  fileLimit,
  filesOmitted,
  edgesInspected,
  edgeLimit,
  edgesOmitted,
}) {
  const capped = filesOmitted > 0 || edgesOmitted > 0;
  return deepFreeze({
    filesInspected,
    fileLimit,
    filesOmitted,
    edgesInspected,
    edgeLimit,
    edgesOmitted,
    capped,
  });
}
