import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { enrich, computeExpectedClaimCoverage } from '../enrich.mjs';
import { createCommandBroker, commandBroker } from '../shared/command.mjs';
import { assertPrivacySafe } from '../shared/privacy.mjs';
import { enumerate } from '../shared/enum.mjs';
import { survey } from '../survey.mjs';
import { validate } from '../validate.mjs';
import { writeNORMS, WRITE_RENDER_CONTEXT } from '../write.mjs';
import { synthesizeCrossRepository } from '../cross-repo/edges.mjs';
import { createCrossRepositoryRenderer } from '../cross-repo/render.mjs';
import { DIMENSION_REGISTRY } from '../registry/dimensions.mjs';
import { createRenderRegistry } from '../render/registry.mjs';
import { compareAscii } from '../contracts/evidence.mjs';
import { DEFAULT_RENDER_CONTEXT } from '../render/base.mjs';
import { evaluateRules, RULE_EVALUATION_LIMITS } from '../providers/rules.mjs';
import {
  GENERIC_PROVIDER_ID,
  genericProviderResults,
  isUnknownLanguageEcosystem,
} from '../providers/generic.mjs';
import {
  pluginObservationsFromMatches,
  runtimeCatalogResults,
} from '../providers/runtime-catalog.mjs';
import {
  analysisPluginObservations,
  analysisProviderResults,
} from '../providers/analysis-catalog.mjs';
import {
  assurancePluginObservations,
  assuranceCatalogResults,
} from '../providers/assurance-catalog.mjs';
import { scan as scanApi } from '../deep/api/scanner.mjs';
import { buildApiModel } from '../deep/api/model.mjs';
import { scan as scanData } from '../deep/data/scanner.mjs';
import { buildDataModel } from '../deep/data/model.mjs';
import { scanDeploymentTopology } from '../deep/deployment/scanner.mjs';
import { createArtifactResult, mergeTopology } from '../deep/deployment/model.mjs';
import { scan as scanMaintainability } from '../deep/maintainability/scanner.mjs';
import { buildMaintainabilityModel } from '../deep/maintainability/model.mjs';
import { scan as scanGovernance } from '../deep/governance/scanner.mjs';
import { buildGovernanceModel } from '../deep/governance/model.mjs';
import { scan as scanAssurance } from '../deep/assurance/scanner.mjs';
import { buildAssuranceModel } from '../deep/assurance/model.mjs';
import { scan as scanPractices } from '../deep/practices/scanner.mjs';
import { buildPracticesModel } from '../deep/practices/model.mjs';
import { deepScan } from './existing-ten.mjs';

export const MAX_RETRIES = 2;

export const DEFAULT_CLOCK = () => new Date().toISOString().split('T')[0];

export const DEFAULT_SINK = writeNORMS;

export class PipelineError extends TypeError {
  constructor(code, message) {
    super(`Pipeline failed: ${message}`);
    this.name = 'PipelineError';
    this.code = code;
  }
}

export function createScanContext({
  commandRunner = null,
  clock = DEFAULT_CLOCK,
  pluginRegistry = [],
} = {}) {
  return Object.freeze({ commandRunner, clock, pluginRegistry });
}

function resolveBroker(commandRunner) {
  if (commandRunner === null || commandRunner === undefined) return commandBroker;
  if (typeof commandRunner.execute === 'function') return commandRunner;
  return createCommandBroker({ runner: commandRunner });
}

function runnerFlag(commandRunner) {
  return typeof commandRunner === 'function'
    || (commandRunner !== null && commandRunner !== undefined && typeof commandRunner.run === 'function')
    || (commandRunner !== null && commandRunner !== undefined && typeof commandRunner.execute === 'function');
}

function shortName(dimensionId) {
  return dimensionId.replace(/^DIM-/, '').replace(/-v[1-9]\d*$/, '');
}

function dimensionShorts(registry) {
  return registry.map(({ id }) => shortName(id));
}

/**
 * Shared enrich → validate → retry engine used by the expanded production
 * path (and formerly by the retired ten-dimension entry points). Exported so
 * the retry-loop contract (re-dispatch below-threshold dimensions, cap at
 * `MAX_RETRIES`) stays testable through the same production seam the pipeline
 * itself uses.
 */
export async function enrichValidateRetry({
  overview,
  deepResults,
  path,
  broker,
  rescan = (dimension, repoPath, repoOverview, brokerOverride) => (
    repoPath === null ? null : deepScan(dimension, repoPath, repoOverview, brokerOverride)
  ),
  reporter = null,
}) {
  const trace = [];
  const firstEnriched = await enrich(deepResults, overview);
  let enriched = firstEnriched;
  let validated = await validate(enriched);
  let retryCount = 0;
  while (validated.needsRetry.length > 0 && retryCount < MAX_RETRIES) {
    const retryDimensions = validated.needsRetry;
    if (reporter) reporter.progress(`[CSM] retrying ${retryDimensions.length} dimensions below the coverage threshold: ${retryDimensions.join(', ')}`);
    for (const dimension of retryDimensions) {
      trace.push({ dimension, phase: 'retry' });
    }
    const retryResults = (await Promise.all(
      retryDimensions.map((dimension) => rescan(dimension, path, overview, broker)),
    )).filter(Boolean);

    const merged = validated.findings.map((f) => {
      const retry = retryResults.find((r) => r.dimension === f.dimension);
      if (retry) {
        const providerObservations = f.findings?.providerObservations;
        return {
          dimension: f.dimension,
          signal: retry.signal,
          findings: providerObservations
            ? { ...retry.findings, providerObservations }
            : retry.findings,
        };
      }
      return { dimension: f.dimension, signal: f.signal, findings: f.findings };
    });
    for (const r of retryResults) {
      if (!merged.some((m) => m.dimension === r.dimension)) {
        merged.push({ dimension: r.dimension, signal: r.signal, findings: r.findings });
      }
    }

    enriched = await enrich(merged, overview);
    validated = await validate(enriched);
    retryCount++;
  }
  return { enriched: firstEnriched, validated, trace };
}

// ---------------------------------------------------------------------------
// Expanded 17-dimension pipeline — the T224 production cutover. The legacy
// ten-dimension entry points were retired in T002; `enrichValidateRetry` below
// is the shared retry engine used by the expanded path.
// ---------------------------------------------------------------------------

async function scanDimension(dimension, repoPath, overview, broker = null) {
  switch (dimension) {
    case 'structure':
    case 'stack':
    case 'config':
    case 'testing':
    case 'conventions':
    case 'git':
    case 'architecture':
    case 'documentation':
    case 'security':
    case 'operations':
      return deepScan(dimension, repoPath, overview, broker);
    case 'api':
      return scanApi(repoPath, overview);
    case 'data':
      return scanData(repoPath, overview);
    case 'deployment': {
      const files = Array.isArray(overview?.files) && overview.files.length > 0
        ? overview.files
        : (await enumerate(repoPath)).files;
      const { topology } = await scanDeploymentTopology({ root: repoPath, files });
      const counts = topology.counts ?? {};
      const hasRecords = Object.values(counts).some((value) => typeof value === 'number' && value > 0);
      return { dimension: 'deployment', signal: hasRecords ? 'high' : 'low', findings: topology };
    }
    case 'maintainability':
      return scanMaintainability(repoPath, overview);
    case 'governance':
      return scanGovernance(repoPath, overview, broker ?? commandBroker);
    case 'assurance':
      return scanAssurance(repoPath, overview);
    case 'practices':
      return scanPractices(repoPath, overview);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// New-dimension scan resilience (T224).
//
// The six new dimensions are activated by this cutover. Their scanners are
// declaration-backed and already privacy-filter their models, but a realistic
// repository can still trip a parser cap or an unreadable-artifact path. Per
// the T202 contract, "parser failures yield unverified, never absence": a
// crashed new-dimension scan degrades to a disclosed `SCANNER_FAILURE` model
// with an incomplete search space (so its claims stay `unverified`) instead of
// aborting the whole run. The ten established dimensions keep their stable
// fail-closed behavior: a legacy scanner failure is a genuine regression and
// must surface as a pipeline error.
// ---------------------------------------------------------------------------

const FAILURE_DIAGNOSTIC_LINE = Object.freeze({
  path: 'scan-failure',
  status: 'unverified',
  reason: 'SCANNER_FAILURE',
  line: null,
});

const FAILURE_DIAGNOSTIC_NO_LINE = Object.freeze({
  path: 'scan-failure',
  status: 'unverified',
  reason: 'SCANNER_FAILURE',
});

const FAILURE_SEARCH_SPACE = Object.freeze({
  supported: true,
  readable: false,
  complete: false,
  capped: false,
  error: true,
  malformed: false,
  ambiguous: false,
  filesInspected: 0,
  fileLimit: 4096,
  bytesInspected: 0,
  byteLimit: 16 * 1024 * 1024,
  recordsInspected: 0,
  recordLimit: 20000,
  omittedCount: 0,
});

function fallbackDimension(dimension) {
  switch (dimension) {
    case 'api':
      return buildApiModel({
        operations: [],
        diagnostics: [FAILURE_DIAGNOSTIC_LINE],
        searchSpace: FAILURE_SEARCH_SPACE,
      });
    case 'data':
      return buildDataModel({
        records: [],
        edges: [],
        diagnostics: [FAILURE_DIAGNOSTIC_LINE],
        searchSpace: FAILURE_SEARCH_SPACE,
      });
    case 'deployment': {
      const artifact = createArtifactResult({
        path: 'scan-failure',
        kind: 'unsupported',
        status: 'unverified',
        reason: 'SCANNER_FAILURE',
        lineCount: 0,
        resources: [],
        images: [],
        services: [],
        edges: [],
        stubs: [],
        indicators: [],
        diagnostics: [{ path: 'scan-failure', status: 'unverified', reason: 'SCANNER_FAILURE', doc: null }],
      });
      return { ...mergeTopology([artifact]), searchSpace: FAILURE_SEARCH_SPACE };
    }
    case 'maintainability':
      return buildMaintainabilityModel({
        files: [],
        branchPoints: [],
        duplicateGroups: [],
        generatedBoundaries: [],
        toolEvidence: [],
        measurement: {},
        sizeDistribution: [],
        diagnostics: [FAILURE_DIAGNOSTIC_LINE],
        searchSpace: FAILURE_SEARCH_SPACE,
      });
    case 'governance':
      return buildGovernanceModel({
        artifacts: [],
        ownership: [],
        diagnostics: [FAILURE_DIAGNOSTIC_LINE],
        searchSpace: FAILURE_SEARCH_SPACE,
        isGit: false,
        defaultBranch: null,
      });
    case 'assurance':
      return buildAssuranceModel({
        records: [],
        diagnostics: [FAILURE_DIAGNOSTIC_NO_LINE],
        searchSpace: FAILURE_SEARCH_SPACE,
      });
    case 'practices':
      return buildPracticesModel({
        entries: [],
        diagnostics: [FAILURE_DIAGNOSTIC_LINE],
        searchSpace: FAILURE_SEARCH_SPACE,
      });
    default:
      return {};
  }
}

async function safeScanDimension(dimension, repoPath, overview, broker) {
  if (!PRIVACY_ENFORCED_DIMENSIONS.includes(dimension)) {
    return scanDimension(dimension, repoPath, overview, broker);
  }
  try {
    const result = await scanDimension(dimension, repoPath, overview, broker);
    if (result && typeof result === 'object' && result.dimension) return result;
    return null;
  } catch {
    return { dimension, signal: 'low', findings: fallbackDimension(dimension) };
  }
}

async function scanAllDimensions(repoPath, overview, broker) {
  const results = await Promise.all(
    dimensionShorts(DIMENSION_REGISTRY).map((dimension) => (
      safeScanDimension(dimension, repoPath, overview, broker)
    )),
  );
  return results.filter(Boolean);
}

async function processExpandedRepo({
  overview,
  deepResults,
  path,
  broker,
  reporter = null,
}) {
  const { enriched, validated, trace } = await enrichValidateRetry({
    overview,
    deepResults,
    path,
    broker,
    rescan: safeScanDimension,
    reporter,
  });
  const repo = { overview, deep: validated.findings };
  if (validated.contradictions.length > 0) {
    repo.crossObservations = validated.contradictions;
  }
  if (reporter) {
    for (const contradiction of validated.contradictions) {
      reporter.observation(`  [CROSS-OBSERVATION] ${contradiction.description}`);
    }
    for (const gap of enriched.gaps) {
      reporter.note(`  [SCAN-NOTE] ${gap.dimension}: ${gap.reason}`);
    }
    for (const pattern of enriched.inferredPatterns) {
      reporter.inferred(`  [INFERRED] ${pattern.dimension}: ${pattern.pattern}`);
    }
    reporter.coverage(`  Detection coverage: ${JSON.stringify(validated.coverage)}`);
  }
  return { repo, enriched, validated, trace };
}

function assertAllDimensionsPresent(deep) {
  const present = new Set(deep.map((entry) => entry.dimension));
  const missing = dimensionShorts(DIMENSION_REGISTRY).filter((dimension) => !present.has(dimension));
  if (missing.length > 0) {
    throw new PipelineError('MISSING_DIMENSION', `scanner results are missing dimensions: ${missing.join(', ')}`);
  }
}

const PRIVACY_ENFORCED_DIMENSIONS = Object.freeze([
  'api', 'data', 'deployment', 'maintainability', 'governance', 'assurance', 'practices',
]);

/**
 * Fail-before-write privacy gate over an assembled `findings` envelope. The six
 * new-dimension models are T206 privacy-enforced at scan time; this validator
 * re-checks them plus the global cross-repository snapshot so a privacy leak
 * aborts before the sole write. The ten legacy dimensions are grandfathered
 * (their T201 supersession records cover historical leak classes).
 * @param {object} findings - `{ generated, repos, global }`.
 */
export function assertFindingsPrivacy(findings) {
  for (const repo of findings.repos) {
    for (const entry of repo.deep) {
      if (!PRIVACY_ENFORCED_DIMENSIONS.includes(entry.dimension)) continue;
      try {
        const { providerObservations, ...core } = entry.findings ?? {};
        assertPrivacySafe(core);
        // providerObservations are privacy-filtered at merge time and can carry
        // up to PROVIDER_OBSERVATIONS_BOUND records, so they are re-checked with
        // a node budget proportional to their bound instead of the default gate.
        if (Array.isArray(providerObservations)) {
          assertPrivacySafe(providerObservations, {
            maxArray: PROVIDER_OBSERVATIONS_BOUND,
            maxDepth: 8,
            maxNodes: PROVIDER_OBSERVATIONS_BOUND * 12,
            maxObjectKeys: 64,
            maxString: 2048,
          });
        }
      } catch {
        throw new PipelineError('PRIVACY_LEAK', 'scanner findings contain prohibited sensitive data');
      }
    }
  }
  try {
    assertPrivacySafe(findings.global);
  } catch {
    throw new PipelineError('PRIVACY_LEAK', 'global snapshot contains prohibited sensitive data');
  }
}

function scanIdFor(overview) {
  const seed = typeof overview.path === 'string' && overview.path.length > 0
    ? overview.path
    : String(overview.name ?? 'unknown');
  return `scan-${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

function safeReferencePath(path) {
  if (typeof path !== 'string' || path.length === 0) return null;
  try {
    assertPrivacySafe(path);
    return path;
  } catch {
    return null;
  }
}

function collectGlobalSnapshot(scanEntries) {
  const repositories = [];
  const references = [];
  for (const { overview, deep } of scanEntries) {
    const byDimension = new Map(deep.map((entry) => [entry.dimension, entry.findings]));
    const scanId = scanIdFor(overview);
    const gitFindings = byDimension.get('git');
    const apiFindings = byDimension.get('api');

    const vcs = gitFindings && typeof gitFindings.remote === 'string'
      && gitFindings.remote !== 'N/A' && gitFindings.remote.length > 0
      ? gitFindings.remote
      : null;

    const manifests = [];
    const manifest = overview.manifest;
    if (manifest && typeof manifest.name === 'string' && manifest.name.length > 0) {
      manifests.push({
        ecosystem: overview.ecosystems?.primary ?? null,
        name: manifest.name,
        version: typeof manifest.version === 'string' ? manifest.version : null,
        root: null,
      });
    }

    const contracts = [];
    const events = [];
    if (apiFindings && Array.isArray(apiFindings.operations)) {
      for (const operation of apiFindings.operations) {
        if (operation.category === 'rpc' && typeof operation.details?.service === 'string') {
          contracts.push(operation.details.service);
        }
        if (operation.category === 'event' && typeof operation.details?.emitter === 'string') {
          events.push(operation.details.emitter);
        }
      }
    }

    repositories.push({
      scanId,
      vcs,
      componentRoots: [],
      manifests,
      workspaceNames: [],
      contracts,
      events,
      iac: [],
    });

    if (apiFindings && Array.isArray(apiFindings.operations)) {
      for (const operation of apiFindings.operations) {
        const path = safeReferencePath(operation.source?.path);
        if (operation.category === 'rpc' && typeof operation.details?.service === 'string') {
          references.push({
            scanId,
            kind: 'contract',
            value: operation.details.service,
            path,
            sourceKind: 'contract',
          });
        }
        if (operation.category === 'event' && typeof operation.details?.emitter === 'string') {
          references.push({
            scanId,
            kind: 'event',
            value: operation.details.emitter,
            path,
            sourceKind: 'source',
          });
        }
      }
    }
  }
  return synthesizeCrossRepository({ repositories, references });
}

function aggregateExpectedClaimCoverage(perRepoCoverage) {
  const totals = { expected: 0, complete: 0, incomplete: 0, unsupported: 0, excluded: 0 };
  for (const entry of perRepoCoverage) {
    totals.expected += entry.expected;
    totals.complete += entry.complete;
    totals.incomplete += entry.incomplete;
    totals.unsupported += entry.unsupported;
    totals.excluded += entry.excluded;
  }
  const eligible = totals.complete + totals.incomplete;
  return Object.freeze({
    ...totals,
    eligible,
    ratio: eligible === 0 ? null : totals.complete / eligible,
    repos: Object.freeze(perRepoCoverage),
  });
}

// ---------------------------------------------------------------------------
// T225 provider wiring — catalog observations reach the output.
//
// The three production provider catalogs (runtime/analysis/assurance) are
// consumed after the deep scans. Only PLUGIN and GENERIC observations are
// merged into each provider dimension's findings as additional records carrying
// provenance (providerId + evidence path). Built-in catalog observations are
// never merged: the built-in scanner findings already carry that evidence and
// remain authoritative first, so built-in ecosystem runs (five fixtures, no
// plugins) stay byte-identical. The merge is deterministic, privacy-filtered,
// bounded, deduplicated, and appends after (never replaces) scanner findings.
// ---------------------------------------------------------------------------

const RUNTIME_DIMENSION_IDS = Object.freeze([
  'DIM-stack-v1', 'DIM-config-v1', 'DIM-testing-v1',
]);

const PROVIDER_OBSERVATIONS_BOUND = 2048;

const PLUGIN_MATCHED_KEY_PREFIXES = Object.freeze(['plugin-rule:', 'plugin:']);

function isPluginObservation(observation) {
  return typeof observation?.matchedKey === 'string'
    && PLUGIN_MATCHED_KEY_PREFIXES.some((prefix) => observation.matchedKey.startsWith(prefix));
}

// The catalogs decide the generic fallback from detected languages. Survey
// reports known-language names only; when it detects none (unknown fixture
// languages, empty repos), the stack scanner's own derived language is the
// best available signal so the artifact-only generic fallback still fires.
function catalogLanguages(overview, stackFindings) {
  const detected = overview?.languages;
  if (Array.isArray(detected) && detected.length > 0) return detected;
  if (stackFindings && typeof stackFindings === 'object' && typeof stackFindings.language === 'string'
      && stackFindings.language.length > 0) {
    return [stackFindings.language];
  }
  return [];
}

// ruleId -> { providerId, plugin } so every plugin observation can be attributed
// to the plugin that owns its rule (provenance) after catalog observation
// builders strip the rule identity down to details.ruleId.
function pluginProvenanceIndex(pluginRegistry) {
  const index = new Map();
  for (const plugin of Array.isArray(pluginRegistry) ? pluginRegistry : []) {
    const providers = Array.isArray(plugin.providers) ? plugin.providers : [];
    for (const rule of Array.isArray(plugin.rules) ? plugin.rules : []) {
      if (!rule || typeof rule.id !== 'string' || typeof rule.dimensionId !== 'string') continue;
      const provider = providers.find((entry) => Array.isArray(entry.dimensions)
        && entry.dimensions.some((dimension) => dimension.dimensionId === rule.dimensionId));
      const providerId = provider?.id
        ?? (typeof plugin.id === 'string' ? `PRV-${plugin.id}-v1` : null);
      index.set(rule.id, { providerId, plugin: plugin.id });
    }
  }
  return index;
}

// Bounded artifact read for declarative rule evaluation: at most
// maxArtifacts files, each truncated at the evaluation content bound, using
// only the T201-allowed read APIs (statSync + readFile).
async function readPluginArtifacts(repoPath, files) {
  const artifacts = [];
  const limit = RULE_EVALUATION_LIMITS.maxArtifacts;
  for (const relativePath of files) {
    if (artifacts.length >= limit) break;
    let size;
    try {
      size = statSync(join(repoPath, relativePath)).size;
    } catch {
      continue;
    }
    let content = '';
    if (size <= RULE_EVALUATION_LIMITS.contentBytes) {
      try {
        content = (await readFile(join(repoPath, relativePath), 'utf8'))
          .slice(0, RULE_EVALUATION_LIMITS.contentBytes);
      } catch {
        content = '';
      }
    }
    artifacts.push({ path: relativePath, size, content });
  }
  return artifacts;
}

function withProvenance(observations, dimensionId, provenance) {
  return observations.map((observation) => {
    const ruleId = observation?.details && typeof observation.details === 'object'
      && typeof observation.details.ruleId === 'string'
      ? observation.details.ruleId
      : null;
    const tagged = ruleId !== null && provenance ? provenance.get(ruleId) : null;
    return {
      providerId: tagged?.providerId ?? observation.providerId ?? GENERIC_PROVIDER_ID,
      plugin: tagged?.plugin ?? null,
      dimensionId,
      category: observation.category,
      path: observation.path ?? null,
      matchedKey: observation.matchedKey,
      details: observation.details ?? null,
      sourceKind: observation.sourceKind,
    };
  });
}

function collectProviderEvidence({ matches, pluginRegistry, catalogResults }) {
  const byDimension = new Map();
  const add = (dimensionId, records) => {
    if (!Array.isArray(records) || records.length === 0) return;
    const dimension = shortName(dimensionId);
    const list = byDimension.get(dimension) ?? [];
    list.push(...records);
    byDimension.set(dimension, list);
  };

  const provenance = pluginProvenanceIndex(pluginRegistry);

  // Plugin observations are always taken from the evaluated matches so they
  // survive the generic fallback (which ignores pluginObservations).
  for (const dimensionId of RUNTIME_DIMENSION_IDS) {
    add(dimensionId, withProvenance(
      pluginObservationsFromMatches(matches.filter((match) => match.dimensionId === dimensionId)),
      dimensionId,
      provenance,
    ));
  }
  for (const { dimensionId, observations } of analysisPluginObservations(matches)) {
    add(dimensionId, withProvenance(observations, dimensionId, provenance));
  }
  for (const { dimensionId, observations } of assurancePluginObservations(matches)) {
    add(dimensionId, withProvenance(observations, dimensionId, provenance));
  }
  // Generic artifact-only observations come from the catalogs' generic fallback.
  for (const result of catalogResults) {
    if (!result || typeof result !== 'object' || result.providerId !== GENERIC_PROVIDER_ID) continue;
    add(result.dimensionId, withProvenance(result.observations, result.dimensionId, null));
  }

  const normalized = new Map();
  for (const [dimension, records] of byDimension) {
    const seen = new Set();
    const unique = [];
    for (const record of records) {
      const identity = JSON.stringify([
        record.providerId, record.plugin, record.category, record.path,
        record.matchedKey, record.details,
      ]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      unique.push(record);
    }
    unique.sort((left, right) => compareAscii(
      `${left.providerId}\0${left.plugin ?? ''}\0${left.category}\0${left.matchedKey}\0${left.path ?? ''}`,
      `${right.providerId}\0${right.plugin ?? ''}\0${right.category}\0${right.matchedKey}\0${right.path ?? ''}`,
    ));
    // Privacy-safe: a record that trips the shared privacy gate is dropped
    // rather than leaking or aborting the scan. A plugin observation that
    // cannot be attributed to a non-generic provider is also dropped (it must
    // never masquerade as generic evidence).
    normalized.set(dimension, unique
      .filter((record) => !isPluginObservation(record) || record.providerId !== GENERIC_PROVIDER_ID)
      .filter((record) => {
        try {
          assertPrivacySafe(record);
          return true;
        } catch {
          return false;
        }
      })
      .slice(0, PROVIDER_OBSERVATIONS_BOUND));
  }
  return normalized;
}

async function buildProviderEvidence({ repoPath, overview, deepResults, pluginRegistry }) {
  const byDimension = Object.fromEntries(deepResults.map((entry) => [entry.dimension, entry.findings]));
  const languages = catalogLanguages(overview, byDimension.stack);
  const ecosystems = Array.isArray(overview?.ecosystems?.all) ? overview.ecosystems.all : [];
  const manifestEcosystems = Array.isArray(overview?.manifest?.ecosystems)
    ? overview.manifest.ecosystems
    : [];
  const files = Array.isArray(overview?.files) ? overview.files : [];

  let matches = [];
  let pluginRulesCapped = false;
  if (Array.isArray(pluginRegistry) && pluginRegistry.length > 0) {
    const artifacts = await readPluginArtifacts(repoPath, files);
    for (const plugin of pluginRegistry) {
      if (!Array.isArray(plugin.rules) || plugin.rules.length === 0) continue;
      const evaluated = evaluateRules({ rules: plugin.rules, artifacts });
      if (evaluated.capped) pluginRulesCapped = true;
      matches.push(...evaluated.matches);
    }
    matches.sort((left, right) => compareAscii(
      `${left.dimensionId}\0${left.category}\0${left.ruleId}\0${left.path}`,
      `${right.dimensionId}\0${right.category}\0${right.ruleId}\0${right.path}`,
    ));
  }

  const runtimePluginObservations = {};
  for (const dimensionId of RUNTIME_DIMENSION_IDS) {
    runtimePluginObservations[dimensionId] = pluginObservationsFromMatches(
      matches.filter((match) => match.dimensionId === dimensionId),
    );
  }
  const assuranceObservationsByDimension = {};
  for (const group of assurancePluginObservations(matches)) {
    assuranceObservationsByDimension[group.dimensionId] = group.observations;
  }

  let catalogResults = [];
  try {
    const runtime = runtimeCatalogResults({
      stack: byDimension.stack,
      config: byDimension.config,
      testing: byDimension.testing,
      languages,
      ecosystems,
      manifestEcosystems,
      files,
      pluginObservations: runtimePluginObservations,
    });
    const assurance = assuranceCatalogResults({
      security: byDimension.security,
      operations: byDimension.operations,
      api: byDimension.api,
      data: byDimension.data,
      deployment: byDimension.deployment,
      maintainability: byDimension.maintainability,
      governance: byDimension.governance,
      assurance: byDimension.assurance,
      languages,
      ecosystems,
      manifestEcosystems,
      files,
      pluginObservations: assuranceObservationsByDimension,
    });
    const generic = isUnknownLanguageEcosystem({ languages, ecosystems, manifestEcosystems })
      ? genericProviderResults({ languages, ecosystems, manifestEcosystems, files })
      : null;
    const analysis = analysisProviderResults({
      architecture: { findings: byDimension.architecture, facts: {} },
      conventions: byDimension.conventions,
      documentation: { repoPath, findings: byDimension.documentation },
      practices: byDimension.practices,
      generic,
    });
    catalogResults = [
      ...(Array.isArray(runtime.results) ? runtime.results : []),
      ...(Array.isArray(assurance.results) ? assurance.results : []),
      ...(Array.isArray(analysis.results) ? analysis.results : []),
    ];
  } catch {
    // Provider wiring is best-effort and deterministic: a catalog failure
    // degrades to no generic evidence, never an aborted scan. Plugin evidence
    // is computed independently and is unaffected.
    catalogResults = [];
  }

  return { evidence: collectProviderEvidence({ matches, pluginRegistry, catalogResults }), pluginRulesCapped };
}

function mergeProviderEvidence(deepResults, evidenceByDimension) {
  return deepResults.map((entry) => {
    const records = evidenceByDimension.get(entry.dimension);
    if (!records || records.length === 0) return entry;
    const findings = entry.findings && typeof entry.findings === 'object' && !Array.isArray(entry.findings)
      ? entry.findings
      : {};
    return {
      ...entry,
      findings: {
        ...findings,
        providerObservations: records,
      },
    };
  });
}

function providerEvidenceSection(dimResult) {
  const records = dimResult?.findings?.providerObservations;
  if (!Array.isArray(records) || records.length === 0) return '';
  const { escapeField } = DEFAULT_RENDER_CONTEXT;
  const lines = [];
  lines.push('### Provider Evidence');
  lines.push('');
  lines.push('| Provider | Source | Category | Rule / Metric | Evidence |');
  lines.push('|----------|--------|----------|---------------|----------|');
  for (const record of records) {
    const source = record.plugin ?? record.providerId;
    const rule = record.details?.ruleId ?? record.matchedKey ?? '';
    const evidence = record.path ? `\`${escapeField(record.path, { inTable: true })}\`` : '—';
    lines.push(`| \`${escapeField(record.providerId, { inTable: true })}\` | ${escapeField(source, { inTable: true })} | ${escapeField(record.category, { inTable: true })} | \`${escapeField(rule, { inTable: true })}\` | ${evidence} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function compositeRenderer(renderRegistry, globalRenderer) {
  return Object.freeze({
    render(deep, options) {
      const sections = renderRegistry.render(deep, options);
      return sections.map((section, index) => {
        const evidence = providerEvidenceSection(deep[index]);
        return evidence.length > 0 ? `${section}\n\n${evidence}` : section;
      });
    },
    renderGlobal(snapshot) {
      return globalRenderer.render(snapshot);
    },
  });
}

/**
 * Run the canonical expanded pipeline over all 17 dimensions in T222 registry
 * order for one or more repositories, followed by global cross-repository
 * synthesis and a single deterministic write.
 *
 * @param {object} input
 *   - `repos`: non-empty array of repository paths.
 *   - `out`: optional output path passed to the sink.
 *   - `clock`: injectable clock returning the generated date.
 *   - `commandRunner`: injectable broker runner seam (inert like T204).
 *   - `pluginRegistry`: plugin records; declarative rules are evaluated over
 *     the repository and the resulting plugin/generic observations are merged
 *     into provider-dimension findings before enrich/validate/render.
 *   - `sink`: default `writeNORMS`; the composite renderer is passed through.
 *   - `reporter`: optional privacy-safe reporter for progress/diagnostics.
 * @returns {Promise<object>} `{ generated, repos, markdown, trace, semantic,
 *   context, global, findings, expectedClaimCoverage }`.
 */
export async function runExpandedPipeline({
  repos,
  out = undefined,
  clock = DEFAULT_CLOCK,
  commandRunner = null,
  pluginRegistry = [],
  sink = DEFAULT_SINK,
  reporter = null,
} = {}) {
  if (!Array.isArray(repos) || repos.length === 0) {
    throw new TypeError('runExpandedPipeline requires a non-empty repos array');
  }
  const generated = clock();
  const context = createScanContext({ commandRunner, clock, pluginRegistry });
  const broker = resolveBroker(commandRunner);
  const runner = runnerFlag(commandRunner);
  const plugins = pluginRegistry.length;
  // T005 cutover: the production registry renders every dimension through the
  // write-path privacy context so all escapeField surfaces (dep names+specs,
  // import samples, workflow fields, package name/main) run the sanitizer.
  const renderRegistry = createRenderRegistry({ context: WRITE_RENDER_CONTEXT });
  const globalRenderer = createCrossRepositoryRenderer();

  const repoResults = [];
  const scanEntries = [];
  const trace = [];
  const semantic = [];
  const perRepoCoverage = [];
  let providerCapped = false;

  if (reporter) reporter.phase(`[CSM] survey phase`);
  for (const [index, rawPath] of repos.entries()) {
    const resolvedPath = resolve(rawPath);
    const overview = await survey(resolvedPath, broker);
    if (reporter) reporter.progress(`[CSM] survey complete — repository ${overview.name}`);
    if (reporter) reporter.progress(`  Languages: ${overview.languages.join(', ') || 'none detected'}`);
    if (reporter) reporter.progress(`  Files: ${overview.totalFiles}`);

    const deepResults = await scanAllDimensions(resolvedPath, overview, broker);
    if (reporter) reporter.phase(`[CSM] deep phase — dispatching ${deepResults.length} scanners`);
    for (const entry of deepResults) {
      trace.push({ repoIndex: index, dimension: entry.dimension, phase: 'initial', runner, plugins });
      if (reporter) reporter.progress(`  ${entry.dimension}: scanned`);
    }

    // T225 provider wiring: consume the three production catalogs after the
    // deep scans and merge plugin/generic observations into each provider
    // dimension's findings before enrich/validate/render.
    const providerEvidence = await buildProviderEvidence({
      repoPath: resolvedPath,
      overview,
      deepResults,
      pluginRegistry: context.pluginRegistry,
    });
    const mergedDeep = mergeProviderEvidence(deepResults, providerEvidence.evidence);
    if (providerEvidence.pluginRulesCapped) {
      providerCapped = true;
      if (reporter) reporter.progress('  provider evidence: plugin rule match cap reached');
    }
    if (reporter && providerEvidence.evidence.size > 0) {
      reporter.progress(`  provider evidence: ${[...providerEvidence.evidence.values()].reduce((sum, records) => sum + records.length, 0)} observation(s) across ${providerEvidence.evidence.size} dimension(s)`);
    }

    const processed = await processExpandedRepo({
      overview,
      deepResults: mergedDeep,
      path: resolvedPath,
      broker,
      reporter,
    });
    for (const entry of processed.trace) {
      trace.push({
        repoIndex: index,
        dimension: entry.dimension,
        phase: entry.phase,
        runner,
        plugins,
      });
    }

    repoResults.push(processed.repo);
    scanEntries.push({ overview, deep: processed.repo.deep });
    semantic.push({
      overview,
      deepResults,
      enriched: processed.enriched,
      validated: processed.validated,
    });
    perRepoCoverage.push(computeExpectedClaimCoverage(processed.repo.deep, overview));
  }

  // Fail-before-write: every repo must carry all registered dimensions.
  for (const entry of scanEntries) {
    assertAllDimensionsPresent(entry.deep);
  }

  const global = collectGlobalSnapshot(scanEntries);
  const findings = { generated, repos: repoResults, global };

  // Fail-before-write: scanner models and the global snapshot must be privacy-safe.
  assertFindingsPrivacy(findings);

  const expectedClaimCoverage = aggregateExpectedClaimCoverage(perRepoCoverage);
  if (reporter) {
    reporter.coverage(`  Expected claim coverage: ${JSON.stringify({
      expected: expectedClaimCoverage.expected,
      eligible: expectedClaimCoverage.eligible,
      complete: expectedClaimCoverage.complete,
      incomplete: expectedClaimCoverage.incomplete,
      unsupported: expectedClaimCoverage.unsupported,
      excluded: expectedClaimCoverage.excluded,
      ratio: expectedClaimCoverage.ratio,
    })}`);
  }

  const markdown = await sink(findings, out, compositeRenderer(renderRegistry, globalRenderer));
  return {
    generated,
    repos: repoResults,
    markdown,
    trace,
    semantic,
    context,
    global,
    findings,
    expectedClaimCoverage,
    providerEvidenceCapped: providerCapped,
  };
}
