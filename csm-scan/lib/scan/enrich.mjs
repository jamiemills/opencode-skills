import { DIMENSION_REGISTRY } from './registry/dimensions.mjs';

const ALL_DIMENSIONS = [
  'structure', 'stack', 'config', 'testing', 'conventions',
  'git', 'architecture', 'documentation', 'security', 'operations',
];

const UNREPORTED_STRINGS = new Set([
  '',
  'n/a',
  'not applicable',
  'not scanned',
  'unknown',
  'unverified',
]);

export function isNullishFinding(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    return UNREPORTED_STRINGS.has(value.trim().toLowerCase());
  }
  return false;
}

function findingCoverage(findings) {
  if (!findings || typeof findings !== 'object' || Array.isArray(findings)) return 0;
  const keys = Object.keys(findings);
  if (keys.length === 0) return 0;
  const reported = keys.filter((key) => !isNullishFinding(findings[key])).length;
  return Math.round((reported / keys.length) * 100);
}

function countImportEdges(archFindings) {
  if (!archFindings) return 0;
  const graph = archFindings.importGraph?.graph;
  if (graph && typeof graph === 'object') {
    return Object.values(graph).reduce(
      (sum, deps) => sum + (Array.isArray(deps) ? deps.length : 0),
      0,
    );
  }
  return archFindings.layers?.totalEdges ?? 0;
}

export async function enrich(deepResults, overview) {
  const enriched = [...deepResults];
  const contradictions = [];
  const gaps = [];
  const inferredPatterns = [];
  const coverage = {};

  const dim = {};
  for (const d of enriched) {
    dim[d.dimension] = d;
  }

  for (const name of ALL_DIMENSIONS) {
    if (!dim[name]) {
      gaps.push({ dimension: name, reason: 'Not scanned — dimension missing from deep results' });
    }
  }

  // 1. Config TS strict vs conventions
  const cfg = dim.config?.findings;
  const conv = dim.conventions?.findings;
  if (cfg?.typescript?.strict && conv) {
    if (conv.importStyle?.type === 'CJS (require/module.exports)') {
      contradictions.push({
        description: 'tsconfig has strict:true; conventions import style is CJS (require/module.exports)',
        dimensions: ['config', 'conventions'],
      });
    }
  }

  // 2. Test framework detected but no test files
  const tst = dim.testing?.findings;
  if (tst) {
    const fw = tst.framework;
    const count = tst.fileCount;
    if (fw && fw.length && fw[0] !== 'unknown' && count === 0) {
      contradictions.push({
        description: `testing framework detected as "${fw[0]}"; testing.fileCount is 0`,
        dimensions: ['testing', 'structure'],
      });
    }
  }

  // 3. Git commit style vs changelog format
  const gitFindings = dim.git?.findings;
  const docFindings = dim.documentation?.findings;
  if (gitFindings?.commitStyle === 'Conventional Commits' && docFindings?.changelog?.present) {
    const cl = docFindings.changelog;
    if (cl.format !== 'Keep a Changelog' && cl.format !== 'conventional') {
      contradictions.push({
        description: `git commit style is Conventional Commits; changelog format is "${cl.format}"`,
        dimensions: ['git', 'documentation'],
      });
    }
  }

  // 4. Stack declares module but conventions shows different import pattern
  const stk = dim.stack?.findings;
  if (conv?.importStyle && stk) {
    if (conv.importStyle.type === 'ESM (import/export)' && stk.type === 'commonjs') {
      contradictions.push({
        description: 'conventions import style is ESM (import/export); package.json type is "commonjs"',
        dimensions: ['conventions', 'stack'],
      });
    }
    if (conv.importStyle.type === 'CJS (require/module.exports)' && stk.type === 'module') {
      contradictions.push({
        description: 'conventions import style is CJS (require/module.exports); package.json type is "module"',
        dimensions: ['conventions', 'stack'],
      });
    }
  }

  // 5. Stack framework detection vs architecture layers
  if (stk?.framework && stk.framework !== '(none)' && stk.framework !== 'unknown') {
    const arch = dim.architecture?.findings;
    if (arch?.layers && arch.layers.totalFiles === 0) {
      contradictions.push({
        description: `stack framework "${stk.framework}" detected; architecture.layers.totalFiles is 0`,
        dimensions: ['stack', 'architecture'],
      });
    }
  }

  // 6. Operations dockerfiles found but security docker scanning is empty
  const ops = dim.operations?.findings;
  const sec = dim.security?.findings;
  if (ops?.dockerfiles?.length > 0 && sec) {
    if (!sec.dockerfilesScanned) {
      gaps.push({ dimension: 'security', reason: 'dockerfiles present; security docker analysis not performed' });
    }
  }

  // --- Semantic contradictions (ecosystem / manifest aware) ---

  const langPrimary = String(overview?.languages?.[0] || '').toLowerCase();
  const ecoPrimary = String(overview?.ecosystems?.primary || '').toLowerCase();

  // 7. Stack runtime mentions Node but primary language/ecosystem is not JS/TS
  if (stk && typeof stk.runtime === 'string' && /\bnode\b/i.test(stk.runtime)) {
    const isJsTs =
      langPrimary.includes('javascript') ||
      langPrimary.includes('typescript') ||
      ecoPrimary === 'javascript' ||
      ecoPrimary === 'typescript';
    if (!isJsTs) {
      contradictions.push({
        description: `stack runtime "${stk.runtime}" references Node; overview primary language is "${overview?.languages?.[0] || 'unknown'}"`,
        dimensions: ['stack'],
      });
    }
  }

  // 8. Testing framework reported as unknown yet test files exist
  if (tst && Array.isArray(tst.framework) && tst.framework.includes('unknown') && (tst.fileCount ?? 0) > 0) {
    contradictions.push({
      description: `testing framework reported as "unknown"; test files present (fileCount = ${tst.fileCount})`,
      dimensions: ['testing'],
    });
  }

  // 9. Package manager unknown despite a manifest carrying dependencies
  if (stk?.packageManager === 'unknown') {
    const man = overview?.manifest;
    const depCount = man?.dependencies && typeof man.dependencies === 'object'
      ? Object.keys(man.dependencies).length
      : 0;
    if (depCount > 0) {
      contradictions.push({
        description: `stack.packageManager reported as "unknown"; manifest declares ${depCount} dependencies`,
        dimensions: ['stack'],
      });
    }
  }

  // 10. Architecture import graph has 0 edges despite a sizable codebase
  const archFindings = dim.architecture?.findings;
  if (archFindings) {
    const edges = countImportEdges(archFindings);
    if (edges === 0 && (overview?.totalFiles ?? 0) > 20) {
      contradictions.push({
        description: `architecture import graph has 0 edges; overview.totalFiles is ${overview.totalFiles}`,
        dimensions: ['architecture'],
      });
    }
  }

  // Scan notes describe missing scanner output without grading scanner signal.
  for (const d of enriched) {
    if (!d.findings || Object.keys(d.findings).length === 0) {
      gaps.push({ dimension: d.dimension, reason: 'No findings produced by scanner' });
    }
  }

  // Coverage is strictly the fraction of top-level scanner fields reported.
  // All present dimensions are measured (the ten established dimensions plus any
  // additional registered dimensions), while the canonical ten are always keyed
  // so the T201 fixed-input baseline keeps its exact coverage shape.
  const presentDimensions = enriched.map((entry) => entry.dimension);
  for (const name of ALL_DIMENSIONS) {
    coverage[name] = findingCoverage(dim[name]?.findings);
  }
  for (const name of presentDimensions) {
    if (!ALL_DIMENSIONS.includes(name)) coverage[name] = findingCoverage(dim[name]?.findings);
  }

  // Infer missing patterns
  if (conv?.fileNaming?.dominant && conv.fileNaming.dominant !== 'unknown') {
    const dist = conv.fileNaming.patterns || {};
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    const top = total > 0 ? Math.max(...Object.values(dist)) : 0;
    const conf = total > 0 ? top / total : 0.5;
    inferredPatterns.push({
      dimension: 'conventions',
      pattern: `File naming: ${conv.fileNaming.dominant} (${Math.round(conf * 100)}% of sampled files)`,
      confidence: conf,
    });
  }

  if (conv?.importStyle?.type && conv.importStyle.type !== 'unknown') {
    inferredPatterns.push({
      dimension: 'conventions',
      pattern: `Import style: ${conv.importStyle.type}`,
      confidence: conv.importStyle.type === 'Mixed (ESM + CJS)' ? 0.5 : 0.8,
    });
  }

  const commitStyle = gitFindings?.commitStyle;
  if (typeof commitStyle === 'string' && !isNullishFinding(commitStyle)) {
    inferredPatterns.push({
      dimension: 'git',
      pattern: `Commit convention: ${commitStyle}`,
      confidence: gitFindings.logCount > 20 ? 0.8 : 0.4,
    });
  }

  if (dim.testing?.findings?.framework && dim.testing.findings.framework[0] !== 'unknown') {
    inferredPatterns.push({
      dimension: 'testing',
      pattern: `Test framework: ${dim.testing.findings.framework.join(', ')}`,
      confidence: dim.testing.signal === 'high' ? 0.9 : 0.5,
    });
  }

  if (cfg?.typescript?.strict) {
    inferredPatterns.push({
      dimension: 'config',
      pattern: 'TypeScript strict mode enabled',
      confidence: 0.9,
    });
  }

  // Ecosystem-aware inference (trivial): surface the detected primary ecosystem
  if (ecoPrimary && ecoPrimary !== 'unknown') {
    inferredPatterns.push({
      dimension: 'stack',
      pattern: `Primary ecosystem: ${ecoPrimary}`,
      confidence: 0.85,
    });
  }

  return {
    enriched,
    contradictions,
    gaps,
    coverage,
    cohesiveness: { ...coverage },
    inferredPatterns,
  };
}

// ---------------------------------------------------------------------------
// Expected-claim coverage (registry-owned) — T224.
//
// Computes coverage over the T222 registry's expected claim IDs using T202
// status semantics: `observed`/`not_detected` claims are complete,
// `unverified` claims are incomplete, `unsupported` claims are unsupported,
// and `not_applicable` claims are excluded. Only complete and incomplete
// claims are eligible for the ratio, exactly like `computeCoverage`.
// ---------------------------------------------------------------------------

function applicabilityStatus(dimension, overview) {
  const facts = [];
  if (typeof overview.isGit === 'boolean') facts.push({ field: 'is_git', present: true, value: overview.isGit });
  if (typeof overview.repositoryKind === 'string') facts.push({ field: 'repository_kind', present: true, value: overview.repositoryKind });
  const outcomes = dimension.applicability.rules.map((rule) => {
    const selected = facts.filter((fact) => fact.field === rule.field && fact.present);
    if (selected.length === 0) return null;
    if (rule.operator === 'exists') return selected.some((fact) => fact.present === rule.value);
    if (rule.operator === 'equals') return selected.some((fact) => fact.value === rule.value);
    if (rule.operator === 'not_equals') return selected.every((fact) => fact.value !== rule.value);
    return selected.some((fact) => rule.value.includes(fact.value));
  });
  if (dimension.applicability.mode === 'all') {
    return outcomes.some((outcome) => outcome === false) ? 'not_applicable' : 'applicable';
  }
  return outcomes.every((outcome) => outcome === false) ? 'not_applicable' : 'applicable';
}

function searchCompleteness(searchSpace) {
  if (searchSpace === null || searchSpace === undefined || typeof searchSpace !== 'object') {
    return 'complete';
  }
  const s = searchSpace;
  const cleanComplete = s.supported === true && s.readable === true && s.complete === true
    && s.capped !== true && s.error !== true && s.malformed !== true
    && s.ambiguous !== true && (s.omittedCount ?? 0) === 0;
  const cleanUnsupported = s.supported === false && s.readable === false && s.complete === false
    && s.capped !== true && s.error !== true && s.malformed !== true
    && s.ambiguous !== true && (s.filesInspected ?? 0) === 0
    && (s.bytesInspected ?? 0) === 0 && (s.recordsInspected ?? 0) === 0
    && (s.omittedCount ?? 0) === 0;
  const incomplete = s.supported === true && (!s.readable || !s.complete
    || s.capped === true || s.error === true || s.malformed === true
    || s.ambiguous === true || (s.omittedCount ?? 0) > 0);
  if (cleanUnsupported) return 'unsupported';
  if (incomplete) return 'incomplete';
  if (cleanComplete) return 'complete';
  return 'complete';
}

function dataRecordCount(findings) {
  const summary = findings.summary;
  if (summary === null || typeof summary !== 'object') return 0;
  return ['entities', 'fields', 'keys', 'relations', 'migrations', 'stores',
    'schemas', 'caches', 'queues', 'edges']
    .reduce((sum, key) => sum + (Number.isSafeInteger(summary[key]) ? summary[key] : 0), 0);
}

function positiveEvidence(dimension, findings) {
  if (findings === null || findings === undefined || typeof findings !== 'object') return false;
  switch (dimension) {
    case 'api':
      return Array.isArray(findings.operations) && findings.operations.length > 0;
    case 'data':
      return dataRecordCount(findings) > 0;
    case 'deployment': {
      const counts = findings.counts;
      if (counts === null || typeof counts !== 'object') return false;
      return Object.values(counts).some((value) => typeof value === 'number' && value > 0);
    }
    case 'maintainability':
      return Number.isSafeInteger(findings.summary?.filesMeasured) && findings.summary.filesMeasured > 0;
    case 'governance':
      return Number.isSafeInteger(findings.summary?.entries) && findings.summary.entries > 0;
    case 'assurance':
      return Number.isSafeInteger(findings.summary?.records) && findings.summary.records > 0;
    case 'practices':
      return Array.isArray(findings.entries) && findings.entries.length > 0;
    default:
      return Object.keys(findings).some((key) => !isNullishFinding(findings[key]));
  }
}

function claimStatusFor(dimension, result, overview) {
  if (result === null || result === undefined) return 'unverified';
  const findings = result.findings;
  if (applicabilityStatus(dimension, overview) === 'not_applicable') return 'not_applicable';
  const searchSpace = findings && typeof findings === 'object' && !Array.isArray(findings)
    ? findings.searchSpace ?? null
    : null;
  const completeness = searchCompleteness(searchSpace);
  if (completeness === 'unsupported') return 'unsupported';
  if (completeness === 'incomplete') return 'unverified';
  const short = dimension.id.replace(/^DIM-/, '').replace(/-v[1-9]\d*$/, '');
  return positiveEvidence(short, findings) ? 'observed' : 'not_detected';
}

/**
 * Compute coverage over the registry-owned expected claims for a set of deep
 * results. Pure and deterministic for a fixed registry and input order.
 * @param {object[]} deepResults - `{ dimension, signal, findings }` records.
 * @param {object} [overview] - survey overview carrying applicability facts.
 * @param {object[]} [registry] - the T222 dimension registry snapshot.
 * @returns {object} A frozen `{ expected, eligible, complete, incomplete,
 *   unsupported, excluded, ratio, perDimension }` coverage report.
 */
export function computeExpectedClaimCoverage(deepResults, overview = {}, registry = DIMENSION_REGISTRY) {
  const byDimension = new Map(deepResults.map((entry) => [entry.dimension, entry]));
  let expected = 0;
  let complete = 0;
  let incomplete = 0;
  let unsupported = 0;
  let excluded = 0;
  const perDimension = {};
  for (const dimension of registry) {
    const short = dimension.id.replace(/^DIM-/, '').replace(/-v[1-9]\d*$/, '');
    const status = claimStatusFor(dimension, byDimension.get(short), overview);
    const claims = dimension.expectedClaimIds.length;
    expected += claims;
    perDimension[short] = { status, claims };
    if (status === 'not_applicable') excluded += claims;
    else if (status === 'unsupported') unsupported += claims;
    else if (status === 'unverified') incomplete += claims;
    else complete += claims;
  }
  const eligible = complete + incomplete;
  const ratio = eligible === 0 ? null : complete / eligible;
  return Object.freeze({
    expected,
    eligible,
    complete,
    incomplete,
    unsupported,
    excluded,
    ratio,
    perDimension: Object.freeze(perDimension),
  });
}
