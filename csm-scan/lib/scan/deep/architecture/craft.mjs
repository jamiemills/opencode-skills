// Architecture craft — provider-derived coupling aggregates and SOLID/pattern
// indicators.
//
// T017 owns this module. It is a pure derivation helper that turns the
// already-computed Architecture model (`importGraph` adjacency plus the
// `layers` classification) into deterministic, verdict-free coupling
// aggregates and SOLID/pattern indicators. The analysis provider catalog
// consumes these so the facts reach the architecture provider-evidence block
// of the expanded pipeline only; the Architecture scanner output stays
// byte-identical.
//
// Guarantees:
//   - Pure DATA: no filesystem, network, child-process, or executable access.
//   - Deterministic: every list is sorted with an explicit comparator;
//     identical models produce byte-identical output regardless of insertion
//     order.
//   - Privacy-safe: only counts and repository-relative paths are emitted.
//   - Deep-frozen exports; mutation throws.
//   - No quality verdicts: "files above fan-in threshold", "layer-boundary
//     edge counts" and "interface-typed reference counts" are measured facts.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only the evidence contract
// (for `compareAscii`/`deepFreeze`) and the pure graph-facts module; it never
// touches node:fs / node:child_process / node:process / node:vm / node:module.

import { compareAscii, deepFreeze } from "../../contracts/evidence.mjs";
import { computeFanInOut, tarjanStronglyConnectedComponents } from "./graph-facts.mjs";

export const CRAFT_LIMITS = deepFreeze({
  cyclicSizes: 128,
  fanInThreshold: 10,
  pathSamples: 64,
  topN: 5,
});

const LAYER_ORDER = deepFreeze({
  entry: 0,
  core: 1,
  shared: 2,
  rest: 3,
});

const INTERFACE_MARKERS = Object.freeze(["abstract", "contract", "interface"]);

const PORT_ADAPTER_MARKERS = Object.freeze([
  "adapter",
  "adapters",
  "contract",
  "contracts",
  "port",
  "ports",
]);

const PATTERN_SUFFIXES = Object.freeze(["Adapter", "Factory", "Repository", "Service"]);

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function findingsGraph(findings) {
  if (
    !plainObject(findings) ||
    !plainObject(findings.importGraph) ||
    !plainObject(findings.importGraph.graph)
  )
    return {};
  return findings.importGraph.graph;
}

function stemOf(file) {
  const basename = file.slice(file.lastIndexOf("/") + 1);
  return basename.replace(/\.[^.]*$/, "").toLowerCase();
}

function classificationOf(file, layers) {
  const entryPoints = Array.isArray(layers.entryPoints) ? layers.entryPoints : [];
  const coreModules = Array.isArray(layers.coreModules) ? layers.coreModules : [];
  const libModules = Array.isArray(layers.libModules) ? layers.libModules : [];
  const shared = Array.isArray(layers.shared) ? layers.shared : [];
  const rest = Array.isArray(layers.rest) ? layers.rest : [];
  if (entryPoints.includes(file)) return "entry";
  if (coreModules.includes(file) || libModules.includes(file)) return "core";
  if (shared.includes(file)) return "shared";
  if (rest.includes(file)) return "rest";
  return "unclassified";
}

function edgeDirection(sourceLayer, targetLayer) {
  if (sourceLayer === "unclassified" || targetLayer === "unclassified") return "unknown";
  const sourceIndex = LAYER_ORDER[sourceLayer];
  const targetIndex = LAYER_ORDER[targetLayer];
  if (sourceIndex === undefined || targetIndex === undefined) return "unknown";
  if (sourceIndex === targetIndex) return "same";
  return sourceIndex < targetIndex ? "downward" : "upward";
}

function maximumFan(counts) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return { count: null, files: [], truncated: false };
  let maximum = entries[0][1];
  for (const [, count] of entries) {
    if (count > maximum) maximum = count;
  }
  const files = entries
    .filter(([, count]) => count === maximum)
    .map(([file]) => file)
    .toSorted(compareAscii);
  const truncated = files.length > CRAFT_LIMITS.pathSamples;
  return {
    count: maximum,
    files: truncated ? files.slice(0, CRAFT_LIMITS.pathSamples) : files,
    truncated,
  };
}

function topFan(counts, limit) {
  return Object.entries(counts)
    .map(([path, count]) => ({ path, count }))
    .toSorted((left, right) => right.count - left.count || compareAscii(left.path, right.path))
    .slice(0, limit);
}

function filesAboveThreshold(counts, threshold) {
  const files = Object.entries(counts)
    .filter(([, count]) => count >= threshold)
    .map(([file]) => file)
    .toSorted(compareAscii);
  const truncated = files.length > CRAFT_LIMITS.pathSamples;
  return {
    threshold,
    count: files.length,
    files: truncated ? files.slice(0, CRAFT_LIMITS.pathSamples) : files,
    truncated,
  };
}

function cyclicGroupSizes(components) {
  const sizes = components
    .map((component) => component.size)
    .toSorted((left, right) => right - left);
  const truncated = sizes.length > CRAFT_LIMITS.cyclicSizes;
  return {
    count: sizes.length,
    sizes: truncated ? sizes.slice(0, CRAFT_LIMITS.cyclicSizes) : sizes,
    largest: sizes.length > 0 ? sizes[0] : null,
    truncated,
  };
}

function layerBoundaries(graph, layers) {
  const pairCounts = new Map();
  const classificationCache = new Map();
  let crossingCount = 0;
  let totalEdges = 0;
  const classify = (file) => {
    let layer = classificationCache.get(file);
    if (layer === undefined) {
      layer = classificationOf(file, layers);
      classificationCache.set(file, layer);
    }
    return layer;
  };
  for (const [source, targets] of Object.entries(graph)) {
    const sourceLayer = classify(source);
    for (const target of targets || []) {
      totalEdges += 1;
      const targetLayer = classify(target);
      if (sourceLayer !== targetLayer) crossingCount += 1;
      const key = `${sourceLayer}\0${targetLayer}`;
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
  }
  const pairs = [...pairCounts.entries()]
    .map(([key, count]) => {
      const [sourceLayer, targetLayer] = key.split("\0");
      return { sourceLayer, targetLayer, count };
    })
    .toSorted((left, right) =>
      compareAscii(
        `${left.sourceLayer}\0${left.targetLayer}`,
        `${right.sourceLayer}\0${right.targetLayer}`,
      ),
    );
  return { totalEdges, crossingCount, pairs };
}

function dependencyDirection(graph, layers) {
  const pairCounts = new Map();
  const classificationCache = new Map();
  let downward = 0;
  let upward = 0;
  let same = 0;
  let unknown = 0;
  let totalEdges = 0;
  const classify = (file) => {
    let layer = classificationCache.get(file);
    if (layer === undefined) {
      layer = classificationOf(file, layers);
      classificationCache.set(file, layer);
    }
    return layer;
  };
  for (const [source, targets] of Object.entries(graph)) {
    const sourceLayer = classify(source);
    for (const target of targets || []) {
      totalEdges += 1;
      const targetLayer = classify(target);
      const direction = edgeDirection(sourceLayer, targetLayer);
      if (direction === "downward") downward += 1;
      else if (direction === "upward") upward += 1;
      else if (direction === "same") same += 1;
      else unknown += 1;
      const key = `${sourceLayer}\0${targetLayer}\0${direction}`;
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
  }
  const pairs = [...pairCounts.entries()]
    .map(([key, count]) => {
      const [sourceLayer, targetLayer, direction] = key.split("\0");
      return { sourceLayer, targetLayer, direction, count };
    })
    .toSorted((left, right) =>
      compareAscii(
        `${left.sourceLayer}\0${left.targetLayer}\0${left.direction}`,
        `${right.sourceLayer}\0${right.targetLayer}\0${right.direction}`,
      ),
    );
  return { totalEdges, downward, upward, same, unknown, pairs };
}

function edgeKindCounts(value) {
  const counts = {};
  if (!plainObject(value)) return counts;
  for (const kind of Object.keys(value).toSorted(compareAscii)) {
    if (Number.isSafeInteger(value[kind])) counts[kind] = value[kind];
  }
  return counts;
}

function consideredFiles(graph, modules) {
  const seen = new Set();
  for (const file of Object.keys(graph)) seen.add(file);
  for (const file of modules) seen.add(file);
  return [...seen];
}

function isInterfaceMarked(file) {
  const stem = stemOf(file);
  return INTERFACE_MARKERS.some((marker) => stem.includes(marker));
}

function portAdapterDirs(files) {
  const seen = new Set();
  const dirs = [];
  for (const file of files) {
    const slash = file.lastIndexOf("/");
    if (slash <= 0) continue;
    const segments = file.slice(0, slash).split("/");
    for (let index = 0; index < segments.length; index++) {
      if (PORT_ADAPTER_MARKERS.includes(segments[index].toLowerCase())) {
        const dir = segments.slice(0, index + 1).join("/");
        if (!seen.has(dir)) {
          seen.add(dir);
          dirs.push(dir);
        }
        break;
      }
    }
  }
  return dirs.toSorted(compareAscii);
}

function patternSuffixCounts(files) {
  const counts = {};
  for (const suffix of PATTERN_SUFFIXES) counts[suffix] = 0;
  const matched = [];
  for (const file of files) {
    const stem = stemOf(file);
    for (const suffix of PATTERN_SUFFIXES) {
      if (stem.endsWith(suffix.toLowerCase())) {
        counts[suffix] += 1;
        matched.push(file);
        break;
      }
    }
  }
  return { counts, files: matched.toSorted(compareAscii) };
}

function cappedSample(list) {
  const truncated = list.length > CRAFT_LIMITS.pathSamples;
  return {
    values: truncated ? list.slice(0, CRAFT_LIMITS.pathSamples) : list,
    truncated,
  };
}

/**
 * Compute coupling aggregates from the architecture model.
 *
 * @param {object} input - `{ findings, facts }` where `findings` is the
 *   architecture scanner result (`importGraph.graph` + `layers`) and `facts`
 *   is the optional T217 graph-facts record (used for edge-kind counts).
 * @returns {object} Deep-frozen coupling aggregates: fan-in/fan-out maxima and
 *   top-N lists, files above the disclosed fan-in threshold, cyclic-group
 *   sizes, layer-boundary edge counts, and edge-kind counts.
 */
export function computeCouplingAggregates(input) {
  const findings = plainObject(input) ? input.findings : null;
  const graph = findingsGraph(findings);
  const layers = plainObject(findings) && plainObject(findings.layers) ? findings.layers : {};
  const facts = plainObject(input) && plainObject(input.facts) ? input.facts : null;
  const { fanIn, fanOut } = computeFanInOut(graph);
  const components = tarjanStronglyConnectedComponents(graph);
  const coupling = {
    fanIn: {
      max: maximumFan(fanIn),
      top: topFan(fanIn, CRAFT_LIMITS.topN),
    },
    fanOut: {
      max: maximumFan(fanOut),
      top: topFan(fanOut, CRAFT_LIMITS.topN),
    },
    fanInThreshold: filesAboveThreshold(fanIn, CRAFT_LIMITS.fanInThreshold),
    cyclicGroups: cyclicGroupSizes(components.cyclicComponents),
    layerBoundaries: layerBoundaries(graph, layers),
    edgeKinds: edgeKindCounts(facts ? facts.edgeKindCounts : null),
  };
  return deepFreeze(coupling);
}

/**
 * Compute SOLID/pattern indicators from the architecture model.
 *
 * @param {object} input - `{ findings }` where `findings` is the architecture
 *   scanner result (`importGraph.graph`, `layers`, `modules`).
 * @returns {object} Deep-frozen indicators: interface-typed reference counts,
 *   layer dependency-direction counts, port/contract/adapter directory
 *   markers, and pattern-suffix naming counts.
 */
export function computeSolidIndicators(input) {
  const findings = plainObject(input) ? input.findings : null;
  const graph = findingsGraph(findings);
  const layers = plainObject(findings) && plainObject(findings.layers) ? findings.layers : {};
  const modules = Array.isArray(findings && findings.modules) ? findings.modules : [];
  const files = consideredFiles(graph, modules);
  const interfaceFiles = files.filter(isInterfaceMarked).toSorted(compareAscii);
  const interfaceSet = new Set(interfaceFiles);
  let interfaceReferenceCount = 0;
  for (const targets of Object.values(graph)) {
    for (const target of targets || []) {
      if (interfaceSet.has(target)) interfaceReferenceCount += 1;
    }
  }
  const dirs = portAdapterDirs(files);
  const suffixStats = patternSuffixCounts(files);
  const interfaceSample = cappedSample(interfaceFiles);
  const dirSample = cappedSample(dirs);
  const suffixSample = cappedSample(suffixStats.files);
  const indicators = {
    interfaceReferences: {
      count: interfaceReferenceCount,
      usageCount: interfaceFiles.length,
      paths: interfaceSample.values,
      truncated: interfaceSample.truncated,
    },
    dependencyDirection: dependencyDirection(graph, layers),
    portAdapterDirs: {
      paths: dirSample.values,
      truncated: dirSample.truncated,
    },
    patternSuffixes: {
      counts: suffixStats.counts,
      files: suffixSample.values,
      truncated: suffixSample.truncated,
    },
  };
  return deepFreeze(indicators);
}
