// Analysis provider catalog — Architecture, Conventions, Documentation, and
// Practices.
//
// T219 owns this module. It is an INERT, data-only provider catalog that adapts
// the Architecture (static import graph plus T217 dynamic-indicator graph
// facts), Conventions, Documentation, and Practices scanner models — together
// with T210 plugin declarative observations — to the T202 provider result
// contract (DIM-architecture-v1 / DIM-conventions-v1 / DIM-documentation-v1 /
// DIM-practices-v1 categories).
//
// Guarantees:
//   - Built-in import/comment/convention/documentation behavior is preserved
//     byte-identically: this catalog never touches a scanner; it only maps
//     already-computed scanner models (findings / graph facts) into provider
//     observations, so the focused scanner tests and the P0 parity matrix stay
//     byte-identical.
//   - Observations are deterministic (explicit comparators), deep-frozen, and
//     category-validated by the provider foundation; duplicate and unknown
//     categories are rejected with typed errors.
//   - Per-dimension observation lists are bounded to the provider foundation
//     limit and truncation is disclosed through a `capped` flag (same envelope
//     shape as `maintainabilityProviderResults` / `genericProviderResults`).
//   - Plugin observations can only append after built-in observations through
//     `mergeProviderResults`; exact duplicates are dropped and plugin entries
//     never replace or rewrite built-in graph/findings.
//   - Generic fallback for unknown languages contributes only documentation
//     artifact observations (readme/license/contributing) and never fabricates
//     architecture or conventions claims.
//   - Observation details carry only privacy-safe structured facts (counts,
//     types, repo-relative paths); raw source excerpts and samples are never
//     copied into observations.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only the evidence contract
// and the provider foundation and never touches node:fs /
// node:child_process / node:process / node:vm / node:module.

import {
  compareAscii,
  deepFreeze,
  normalizeEvidencePath,
} from '../contracts/evidence.mjs';
import {
  createProviderResult,
  mergeProviderResults,
  PROVIDER_RESULT_LIMITS,
} from './base.mjs';
import {
  practicesObservations,
  practicesProviderResult,
} from './practices.mjs';

export const ANALYSIS_CATALOG_VERSION = 1;

export const ANALYSIS_DIMENSION_IDS = deepFreeze([
  'DIM-architecture-v1',
  'DIM-conventions-v1',
  'DIM-documentation-v1',
  'DIM-practices-v1',
]);

export const ANALYSIS_PROVIDER_IDS = deepFreeze({
  architecture: 'PRV-analysis-architecture-v1',
  conventions: 'PRV-analysis-conventions-v1',
  documentation: 'PRV-analysis-documentation-v1',
  practices: 'PRV-analysis-practices-v1',
});

export const ANALYSIS_PLUGIN_PROVIDER_ID = 'PRV-analysis-plugin-v1';

export const ANALYSIS_LIMITS = deepFreeze({
  cyclicSizes: 128,
  key: 96,
  assembledKey: 128,
});

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function plain(value) {
  return plainObject(value) ? value : null;
}

function asciiList(values) {
  return (Array.isArray(values) ? values : [])
    .filter((entry) => typeof entry === 'string')
    .sort(compareAscii);
}

function boundedKey(value) {
  return value.length > ANALYSIS_LIMITS.key ? value.slice(0, ANALYSIS_LIMITS.key) : value;
}

// Keep every assembled matchedKey within the provider foundation's 128-char
// bound (base.mjs matchedKey validation). Segment-wise boundedKey alone cannot
// guarantee this for multi-segment keys such as import-edge (two paths) or
// dynamic-indicator (kind + path + line), so the full assembled key is
// deterministically final-truncated at the bound. Full values stay available
// in observation details, so truncation is disclosed without data loss.
function boundedAssembledKey(value) {
  return value.length > ANALYSIS_LIMITS.assembledKey ? value.slice(0, ANALYSIS_LIMITS.assembledKey) : value;
}

function observation(category, path, matchedKey, details, sourceKind) {
  return { category, path, matchedKey, details, sourceKind };
}

function safeInteger(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function canonicalOrder(left, right) {
  return compareAscii(
    `${left.category}\0${left.path ?? ''}\0${left.matchedKey}`,
    `${right.category}\0${right.path ?? ''}\0${right.matchedKey}`,
  );
}

function boundedObservations(observations) {
  const sorted = observations.slice().sort(canonicalOrder);
  const capped = sorted.length > PROVIDER_RESULT_LIMITS.observations;
  if (capped) sorted.length = PROVIDER_RESULT_LIMITS.observations;
  return { observations: sorted, capped };
}

// ---------------------------------------------------------------------------
// Architecture — static import graph plus T217 dynamic-indicator graph facts
// ---------------------------------------------------------------------------

function graphFactsObservations(facts) {
  const observations = [];

  const bounds = plain(facts.bounds);
  const universe = plain(facts.universe);
  if (bounds) {
    observations.push(observation(
      'graph',
      null,
      'graph:bounds',
      {
        filesInspected: safeInteger(bounds.filesInspected),
        fileLimit: safeInteger(bounds.fileLimit),
        filesOmitted: safeInteger(bounds.filesOmitted),
        edgesInspected: safeInteger(bounds.edgesInspected),
        edgeLimit: safeInteger(bounds.edgeLimit),
        edgesOmitted: safeInteger(bounds.edgesOmitted),
        capped: bounds.capped === true,
      },
      'repository_metadata',
    ));
  }
  if (universe) {
    observations.push(observation(
      'graph',
      null,
      'graph:universe',
      {
        ecosystems: asciiList(universe.ecosystems),
        moduleFiles: safeInteger(universe.moduleFiles),
        sourceFiles: safeInteger(universe.sourceFiles),
        testFilesExcluded: safeInteger(universe.testFilesExcluded),
        declarationFilesExcluded: safeInteger(universe.declarationFilesExcluded),
        indicatorsDetected: safeInteger(universe.indicatorsDetected),
        indicatorsOmitted: safeInteger(universe.indicatorsOmitted),
      },
      'repository_metadata',
    ));
  }

  const edgeKindCounts = plain(facts.edgeKindCounts);
  if (edgeKindCounts) {
    const kinds = {};
    for (const [kind, count] of Object.entries(edgeKindCounts)) {
      if (Number.isSafeInteger(count)) kinds[kind] = count;
    }
    observations.push(observation('graph', null, 'graph:edge-kinds', { kinds }, 'repository_metadata'));
  }

  const scc = plain(facts.stronglyConnectedComponents);
  if (scc) {
    const cyclic = Array.isArray(scc.cyclicComponents) ? scc.cyclicComponents : [];
    const cyclicSizes = [];
    let truncated = false;
    for (const component of cyclic) {
      if (plainObject(component) && Number.isSafeInteger(component.size)) {
        if (cyclicSizes.length >= ANALYSIS_LIMITS.cyclicSizes) {
          truncated = true;
          break;
        }
        cyclicSizes.push(component.size);
      }
    }
    observations.push(observation(
      'graph',
      null,
      'graph:scc',
      {
        totalComponents: safeInteger(scc.totalComponents),
        singletonComponents: safeInteger(scc.singletonComponents),
        cyclicCount: cyclic.length,
        cyclicSizes,
        cyclicSizesTruncated: truncated || cyclic.length > ANALYSIS_LIMITS.cyclicSizes,
      },
      'repository_metadata',
    ));
  }

  if (bounds) {
    const fanIn = plain(facts.fanIn);
    const fanOut = plain(facts.fanOut);
    const fanInValues = fanIn ? Object.values(fanIn).filter(Number.isSafeInteger) : [];
    const fanOutValues = fanOut ? Object.values(fanOut).filter(Number.isSafeInteger) : [];
    const maximum = (values) => (values.length === 0 ? null : Math.max(...values));
    observations.push(observation(
      'graph',
      null,
      'graph:fan',
      {
        totalEdges: (safeInteger(bounds.edgesInspected) !== null && safeInteger(bounds.edgesOmitted) !== null)
          ? bounds.edgesInspected + bounds.edgesOmitted
          : null,
        maxFanIn: maximum(fanInValues),
        maxFanOut: maximum(fanOutValues),
        filesWithInboundEdges: fanInValues.filter((value) => value > 0).length,
        filesWithOutboundEdges: fanOutValues.filter((value) => value > 0).length,
        selfLoopCount: Array.isArray(facts.selfLoops) ? facts.selfLoops.length : 0,
      },
      'repository_metadata',
    ));
  }

  return observations;
}

/**
 * Derive DIM-architecture-v1 provider observations from the architecture
 * scanner model: `{ findings, facts }`. `findings` is the architecture scanner
 * result and
 * `facts` is the T217 `analyzeGraphFacts` record. Pure and deterministic.
 * @param {object} input - `{ findings, facts }`.
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen); empty for
 *   foreign input.
 */
export function architectureObservations(input) {
  const findings = plainObject(input) ? input.findings : null;
  if (!plainObject(findings)) return [];
  const model = findings;
  const factRecord = plainObject(input) && plainObject(input.facts) ? input.facts : {};
  const modules = asciiList(model.modules);
  const entryPoints = asciiList(model.layers && model.layers.entryPoints);
  const graph = plainObject(model.importGraph) && plainObject(model.importGraph.graph)
    ? model.importGraph.graph
    : {};
  const fanIn = plain(factRecord.fanIn) ?? {};
  const fanOut = plain(factRecord.fanOut) ?? {};
  const selfLoops = Array.isArray(factRecord.selfLoops) ? new Set(factRecord.selfLoops) : new Set();
  const indicators = Array.isArray(factRecord.dynamicIndicators) ? factRecord.dynamicIndicators : [];

  const observations = graphFactsObservations(factRecord);

  for (const module of modules) {
    observations.push(observation(
      'module',
      module,
      `module:${boundedKey(module)}`,
      {
        fanIn: Number.isInteger(fanIn[module]) ? fanIn[module] : 0,
        fanOut: Number.isInteger(fanOut[module]) ? fanOut[module] : 0,
        selfLoop: selfLoops.has(module),
      },
      'source',
    ));
  }

  for (const entry of entryPoints) {
    observations.push(observation('entry_point', entry, `entry-point:${boundedKey(entry)}`, {}, 'source'));
  }

  for (const source of Object.keys(graph).sort(compareAscii)) {
    const targets = Array.isArray(graph[source]) ? graph[source].slice().sort(compareAscii) : [];
    for (const target of targets) {
      observations.push(observation(
        'import_edge',
        source,
        boundedAssembledKey(`import-edge:${boundedKey(source)}:${boundedKey(target)}`),
        { target },
        'source',
      ));
    }
  }

  for (const indicator of indicators) {
    if (!plainObject(indicator) || typeof indicator.file !== 'string') continue;
    observations.push(observation(
      'dynamic_indicator',
      indicator.file,
      boundedAssembledKey(`dynamic-indicator:${typeof indicator.kind === 'string' ? indicator.kind : 'unknown'}:${boundedKey(indicator.file)}:${Number.isInteger(indicator.line) ? indicator.line : 0}`),
      {
        kind: typeof indicator.kind === 'string' ? indicator.kind : 'unknown',
        specifier: typeof indicator.specifier === 'string' ? indicator.specifier : null,
        line: Number.isInteger(indicator.line) ? indicator.line : 0,
      },
      'source',
    ));
  }

  return deepFreeze([{ dimensionId: ANALYSIS_DIMENSION_IDS[0], observations }]);
}

/**
 * Build immutable provider results from the architecture scanner model.
 * Inert: consumed only by tests and future provider catalogs.
 * @param {object} input - `{ findings, facts }`.
 * @returns {object} `{ results, capped }` (deep-frozen).
 */
export function architectureProviderResults(input) {
  if (!plainObject(input)) return deepFreeze({ results: [], capped: false });
  const { findings, facts } = input;
  if (!plainObject(findings)) return deepFreeze({ results: [], capped: false });
  const [{ observations }] = architectureObservations({ findings, facts });
  const { observations: bounded, capped } = boundedObservations(observations);
  const results = bounded.length > 0 ? [createProviderResult({
    providerId: ANALYSIS_PROVIDER_IDS.architecture,
    dimensionId: ANALYSIS_DIMENSION_IDS[0],
    observations: bounded,
  })] : [];
  return deepFreeze({ results, capped });
}

// ---------------------------------------------------------------------------
// Conventions — import style, naming, error handling, module system, comments
// ---------------------------------------------------------------------------

/**
 * Derive DIM-conventions-v1 provider observations from the conventions scanner
 * result (`scanConventions().findings`). Raw source samples are never copied.
 * Pure and deterministic.
 * @param {object} findings - the conventions scanner findings.
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen); empty for
 *   foreign input.
 */
export function conventionsObservations(findings) {
  if (!plainObject(findings)) return [];
  const model = findings;
  const observations = [];

  const importStyle = plain(model.importStyle);
  if (importStyle) {
    observations.push(observation('import_style', null, 'import-style', {
      type: typeof importStyle.type === 'string' ? importStyle.type : null,
      esmCount: safeInteger(importStyle.esmCount),
      cjsCount: safeInteger(importStyle.cjsCount),
      hasTypeImports: typeof importStyle.hasTypeImports === 'boolean' ? importStyle.hasTypeImports : null,
      hasDynamicImports: typeof importStyle.hasDynamicImports === 'boolean' ? importStyle.hasDynamicImports : null,
    }, 'source'));
    const byEcosystem = plain(importStyle.byEcosystem);
    if (byEcosystem) {
      for (const ecosystem of Object.keys(byEcosystem).sort(compareAscii)) {
        const entry = plain(byEcosystem[ecosystem]);
        if (!entry) continue;
        const counts = {};
        for (const [key, value] of Object.entries(entry)) {
          if (key === 'type' || !Number.isSafeInteger(value)) continue;
          counts[key] = value;
        }
        observations.push(observation('import_style', null, `import-style:${boundedKey(ecosystem)}`, {
          ecosystem,
          type: typeof entry.type === 'string' ? entry.type : null,
          counts,
        }, 'source'));
      }
    }
  }

  const fileNaming = plain(model.fileNaming);
  if (fileNaming) {
    observations.push(observation('file_naming', null, 'file-naming', {
      dominant: typeof fileNaming.dominant === 'string' ? fileNaming.dominant : null,
      patterns: plain(fileNaming.patterns),
      total: safeInteger(fileNaming.total),
    }, 'source'));
  }

  const errorHandling = plain(model.errorHandling);
  if (errorHandling) {
    observations.push(observation('error_handling', null, 'error-handling', {
      patterns: Array.isArray(errorHandling.patterns) ? errorHandling.patterns.slice() : [],
      counts: plain(errorHandling.counts),
    }, 'source'));
  }

  const moduleSystem = plain(model.moduleSystem);
  if (moduleSystem) {
    observations.push(observation('module_system', null, 'module-system', {
      packageJsonType: typeof moduleSystem.packageJsonType === 'string' ? moduleSystem.packageJsonType : null,
      inferred: typeof moduleSystem.inferred === 'string' ? moduleSystem.inferred : null,
    }, 'source'));
  }

  if (typeof model.commentDensity === 'string') {
    observations.push(observation('comment', null, 'comment-density', {
      density: model.commentDensity,
    }, 'source'));
  }

  const docstrings = plain(model.docstrings);
  if (docstrings) {
    observations.push(observation('comment', null, 'docstrings', {
      patterns: plain(docstrings.patterns),
      coverage: plain(docstrings.coverage),
    }, 'source'));
  }

  return deepFreeze([{ dimensionId: ANALYSIS_DIMENSION_IDS[1], observations }]);
}

/**
 * Build immutable provider results from the conventions scanner findings.
 * Inert.
 * @param {object} findings - the conventions scanner findings.
 * @returns {object} `{ results, capped }` (deep-frozen).
 */
export function conventionsProviderResults(findings) {
  if (!plainObject(findings)) return deepFreeze({ results: [], capped: false });
  const [{ observations }] = conventionsObservations(findings);
  const { observations: bounded, capped } = boundedObservations(observations);
  const results = bounded.length > 0 ? [createProviderResult({
    providerId: ANALYSIS_PROVIDER_IDS.conventions,
    dimensionId: ANALYSIS_DIMENSION_IDS[1],
    observations: bounded,
  })] : [];
  return deepFreeze({ results, capped });
}

// ---------------------------------------------------------------------------
// Documentation — readme, license, contributing, reference artifacts
// ---------------------------------------------------------------------------

function normalizeRelativePath(repoPath, value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const repo = typeof repoPath === 'string' && repoPath.length > 0 ? String(repoPath).replace(/\/+$/, '') : null;
  let candidate = value;
  if (repo && candidate.startsWith(`${repo}/`)) candidate = candidate.slice(repo.length + 1);
  if (candidate.startsWith('/')) return null;
  try {
    return normalizeEvidencePath(candidate);
  } catch {
    return null;
  }
}

/**
 * Derive DIM-documentation-v1 provider observations from the documentation
 * scanner result (`scanDocumentation().findings`). Absolute paths in scanner
 * findings are normalized to repository-relative paths using `repoPath`.
 * Pure and deterministic.
 * @param {object} input - `{ repoPath, findings }`.
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen); empty for
 *   foreign input.
 */
export function documentationObservations(input) {
  const repoPath = plainObject(input) ? input.repoPath : undefined;
  const model = plainObject(input) && plainObject(input.findings) ? input.findings : null;
  if (!plainObject(model)) return [];
  const observations = [];
  const relative = (value) => normalizeRelativePath(repoPath, value);

  const readme = plain(model.readme);
  if (readme) {
    const { path, ...details } = readme;
    observations.push(observation('readme', relative(path), 'readme', details, 'documentation'));
  }

  const license = plain(model.license);
  if (license) {
    observations.push(observation('license', relative(license.path), 'license', {
      present: license.present === true,
      name: typeof license.name === 'string' ? license.name : null,
    }, 'documentation'));
  }

  const contributing = plain(model.contributing);
  if (contributing) {
    observations.push(observation('contributing', relative(contributing.path), 'contributing', {
      present: contributing.present === true,
    }, 'documentation'));
  }

  if (typeof model.codeOfConduct === 'boolean') {
    observations.push(observation('reference', null, 'reference:code-of-conduct', {
      present: model.codeOfConduct,
    }, 'documentation'));
  }

  const changelog = plain(model.changelog);
  if (changelog) {
    observations.push(observation('reference', relative(changelog.path), 'reference:changelog', {
      present: changelog.present === true,
      format: typeof changelog.format === 'string' ? changelog.format : null,
    }, 'documentation'));
  }

  if (Array.isArray(model.adrs)) {
    const paths = [];
    let count = 0;
    for (const entry of model.adrs) {
      if (!plainObject(entry)) continue;
      if (typeof entry.path === 'string') paths.push(entry.path);
      if (Number.isSafeInteger(entry.count)) count += entry.count;
    }
    observations.push(observation('reference', null, 'reference:adrs', {
      count,
      paths,
    }, 'documentation'));
  }

  const commentRatio = plain(model.commentRatio);
  if (commentRatio) {
    observations.push(observation('reference', null, 'reference:comment-ratio', {
      ratio: typeof commentRatio.ratio === 'number' ? commentRatio.ratio : null,
      commentLines: safeInteger(commentRatio.commentLines),
      codeLines: safeInteger(commentRatio.codeLines),
    }, 'documentation'));
  }

  const docstringDialect = plain(model.docstringDialect);
  if (docstringDialect) {
    observations.push(observation('reference', null, 'reference:docstring-dialect', {
      dominant: typeof docstringDialect.dominant === 'string' ? docstringDialect.dominant : null,
      counts: plain(docstringDialect.counts),
      filesAnalyzed: safeInteger(docstringDialect.filesAnalyzed),
    }, 'documentation'));
  }

  const docStyle = plain(model.docStyle);
  if (docStyle) {
    observations.push(observation('reference', null, 'reference:doc-style', {
      jsdocBlocks: safeInteger(docStyle.jsdocBlocks),
      tsdocBlocks: safeInteger(docStyle.tsdocBlocks),
      dominant: typeof docStyle.dominant === 'string' ? docStyle.dominant : null,
      filesAnalyzed: safeInteger(docStyle.filesAnalyzed),
    }, 'documentation'));
  }

  if (Number.isSafeInteger(model.todoCount)) {
    observations.push(observation('reference', null, 'reference:todo-count', {
      count: model.todoCount,
    }, 'documentation'));
  }

  return deepFreeze([{ dimensionId: ANALYSIS_DIMENSION_IDS[2], observations }]);
}

/**
 * Build immutable provider results from the documentation scanner findings.
 * Inert.
 * @param {object} input - `{ repoPath, findings }`.
 * @returns {object} `{ results, capped }` (deep-frozen).
 */
export function documentationProviderResults(input) {
  if (!plainObject(input)) return deepFreeze({ results: [], capped: false });
  const { repoPath, findings } = input;
  if (!plainObject(findings)) return deepFreeze({ results: [], capped: false });
  const [{ observations }] = documentationObservations({ repoPath, findings });
  const { observations: bounded, capped } = boundedObservations(observations);
  const results = bounded.length > 0 ? [createProviderResult({
    providerId: ANALYSIS_PROVIDER_IDS.documentation,
    dimensionId: ANALYSIS_DIMENSION_IDS[2],
    observations: bounded,
  })] : [];
  return deepFreeze({ results, capped });
}

// ---------------------------------------------------------------------------
// Practices — development practices across the seven claim categories
// ---------------------------------------------------------------------------

/**
 * Derive DIM-practices-v1 provider observations from the practices model via
 * the practices adapter. The adapter maps the model's entries (each carrying
 * privacy-safe structured facts: counts, types and repo-relative paths) into
 * observations; this catalog wrapper applies the shared bounded/`capped`
 * envelope so truncation is disclosed exactly like the sibling dimensions.
 * Pure and deterministic.
 * @param {object} model - the practices model (`{ entries, ... }`).
 * @returns {object} `{ results, capped }` (deep-frozen); empty envelope for
 *   foreign input.
 */
export function practicesProviderResults(model) {
  if (!plainObject(model)) return deepFreeze({ results: [], capped: false });
  const [{ observations }] = practicesObservations(model);
  const { observations: bounded, capped } = boundedObservations(observations);
  const results = bounded.length > 0 ? [createProviderResult({
    providerId: ANALYSIS_PROVIDER_IDS.practices,
    dimensionId: ANALYSIS_DIMENSION_IDS[3],
    observations: bounded,
  })] : [];
  return deepFreeze({ results, capped });
}

// ---------------------------------------------------------------------------
// Combined catalog entry
// ---------------------------------------------------------------------------

/**
 * Assemble provider results for the four analysis dimensions plus the generic
 * documentation fallback for unknown-language repositories.
 *
 * @param {object} input - `{ architecture, conventions, documentation,
 *   practices, generic }` where `architecture` is `{ findings, facts }`,
 *   `conventions` is the conventions findings, `documentation` is
 *   `{ repoPath, findings }`, `practices` is the practices model, and
 *   `generic` is the T210 `genericProviderResults` envelope.
 * @returns {object} `{ results, capped }` (deep-frozen). `results` holds at
 *   most one result per analysis provider plus the generic documentation
 *   result, ordered deterministically.
 */
export function analysisProviderResults(input) {
  const {
    architecture,
    conventions,
    documentation,
    practices,
    generic,
  } = plainObject(input) ? input : {};
  const results = [];
  let capped = false;

  if (plainObject(architecture)) {
    const built = architectureProviderResults(architecture);
    results.push(...built.results);
    capped = capped || built.capped;
  }
  if (plainObject(conventions)) {
    const built = conventionsProviderResults(conventions);
    results.push(...built.results);
    capped = capped || built.capped;
  }
  if (plainObject(documentation)) {
    const built = documentationProviderResults(documentation);
    results.push(...built.results);
    capped = capped || built.capped;
  }
  if (plainObject(practices)) {
    const built = practicesProviderResults(practices);
    results.push(...built.results);
    capped = capped || built.capped;
  }
  if (plainObject(generic) && Array.isArray(generic.results)) {
    for (const result of generic.results) {
      if (plainObject(result) && result.dimensionId === ANALYSIS_DIMENSION_IDS[2]) results.push(result);
    }
    capped = capped || generic.capped === true;
  }

  results.sort((left, right) => compareAscii(left.dimensionId, right.dimensionId)
    || compareAscii(left.providerId, right.providerId));
  return deepFreeze({ results, capped });
}

// ---------------------------------------------------------------------------
// T210 plugin declarative observations
// ---------------------------------------------------------------------------

function validPluginMatch(match) {
  return plainObject(match)
    && typeof match.ruleId === 'string'
    && match.ruleId.length > 0
    && typeof match.category === 'string'
    && typeof match.path === 'string'
    && match.path.length > 0
    && ANALYSIS_DIMENSION_IDS.includes(match.dimensionId);
}

/**
 * Convert T210 `evaluateRules` matches into provider observations for the
 * four analysis dimensions. Matches for other dimensions are ignored.
 * @param {object[]} matches - `{ ruleId, label, dimensionId, category, path }`.
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen), grouped by
 *   dimension in canonical order.
 */
export function analysisPluginObservations(matches) {
  const grouped = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    if (!validPluginMatch(match)) continue;
    const observations = grouped.get(match.dimensionId) ?? [];
    observations.push(observation(
      match.category,
      match.path,
      `plugin:${boundedKey(match.ruleId)}`,
      {
        ruleId: match.ruleId,
        label: typeof match.label === 'string' ? match.label : match.ruleId,
      },
      'artifact_metadata',
    ));
    grouped.set(match.dimensionId, observations);
  }
  return deepFreeze([...grouped.entries()]
    .sort(([left], [right]) => compareAscii(left, right))
    .map(([dimensionId, observations]) => ({ dimensionId, observations })));
}

/**
 * Build immutable plugin provider results for the four analysis dimensions.
 * Category validation (and duplicate rejection) is enforced by the provider
 * foundation, so an unallowlisted plugin category fails with a typed error.
 * @param {object} input - `{ matches, providerId? }`.
 * @returns {object[]} Deep-frozen provider results (possibly empty).
 */
export function analysisPluginProviderResults(input) {
  const matches = plainObject(input) ? input.matches : undefined;
  const providerId = plainObject(input) ? input.providerId : undefined;
  const id = typeof providerId === 'string' ? providerId : ANALYSIS_PLUGIN_PROVIDER_ID;
  return deepFreeze(analysisPluginObservations(matches).map(({ dimensionId, observations }) => (
    createProviderResult({ providerId: id, dimensionId, observations })
  )));
}

/**
 * Deterministically merge built-in analysis results with plugin results for
 * the same dimensions. Built-in observations always stay first; plugin
 * observations are appended (exact duplicates dropped) and never replace or
 * rewrite a built-in finding. Plugin results for a dimension without a built-in
 * result are appended as standalone contributions.
 * @param {object} input - `{ builtin, plugin }` arrays of provider results.
 * @returns {object[]} Deep-frozen merged provider results.
 */
export function mergeAnalysisResults(input) {
  const builtin = plainObject(input) && Array.isArray(input.builtin) ? input.builtin : [];
  const plugin = plainObject(input) && Array.isArray(input.plugin) ? input.plugin : [];
  const byDimension = new Map();
  for (const result of plugin) {
    if (!plainObject(result)) continue;
    const list = byDimension.get(result.dimensionId) ?? [];
    list.push(result);
    byDimension.set(result.dimensionId, list);
  }
  const merged = [];
  const covered = new Set();
  for (const built of builtin) {
    const peers = byDimension.get(built.dimensionId) ?? [];
    let current = built;
    if (peers.length > 0) {
      // Combine all peer observations into ONE plugin result so the built-in
      // observations are merged exactly once and always stay first (chaining
      // `mergeProviderResults` would re-sort the running result and let plugin
      // observations move ahead of built-in findings).
      const observations = [];
      const seen = new Set();
      for (const peer of peers) {
        for (const entry of peer.observations) {
          const identity = JSON.stringify(entry);
          if (seen.has(identity)) continue;
          seen.add(identity);
          observations.push(entry);
        }
      }
      current = mergeProviderResults({
        builtin: built,
        plugin: createProviderResult({
          providerId: ANALYSIS_PLUGIN_PROVIDER_ID,
          dimensionId: built.dimensionId,
          observations,
        }),
      });
    }
    merged.push(current);
    covered.add(built.dimensionId);
  }
  for (const [dimensionId, results] of byDimension) {
    if (covered.has(dimensionId)) continue;
    merged.push(...results);
  }
  merged.sort((left, right) => compareAscii(left.dimensionId, right.dimensionId)
    || compareAscii(left.providerId, right.providerId));
  return deepFreeze(merged);
}
