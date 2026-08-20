// Maintainability dimension — scanner.
//
// T214 owns this module. It is an inert deep scanner: it enumerates the
// repository, reads a bounded set of supported-language source files,
// tokenizes them, computes the lexical branch-point approximation, derives
// per-file per-function cyclomatic-complexity distributions and unused-code
// markers (declared tool-config signals plus per-dialect lexical marker
// counts), detects exact token duplicates, classifies generated/vendor
// boundaries from exact evidence, probes committed tool-config declarations,
// and builds the deterministic maintainability model. It is exported as a
// factory-friendly `scan` function for tests and the future T224 pipeline
// cutover; nothing in the current pipeline, CLI, enrich, validate, write, or
// existing-ten renderer dispatches it yet.
//
// Read-only: enumeration uses the shared `rg --files` broker; artifact content
// is read through the bounded T206 reader. No target command is executed.
//
// The measurement universe is fully disclosed: eligible vs measured source
// files, bytes/records inspected, omitted counts, read caps, and unsupported
// languages excluded from measurement. Excluded-language extensions are
// sanitized at the scanner boundary: extensionless files map to the
// `no-extension` sentinel and any extension outside the model's disclosed
// charset (editor backups, non-ASCII) maps to the `other` sentinel. Tool-config
// declarations are probed against a fixed candidate list (including hidden
// dotfiles that `rg` does not enumerate); absent candidates are treated as
// non-declarations, never as errors, and the probe's own search space is
// discarded so it never marks the source measurement partial. When source
// coverage is partial the model sets `partialCoverage` so the renderer never
// draws a repository-wide conclusion.
//
// ESM only. Zero npm deps. node: builtins only. Source-policy note (T201):
// this module imports only shared primitives and the maintainability
// modules; it never touches node:fs / node:child_process / node:process /
// node:vm / node:module, so the recurring capability gate remains closed.

import { compareAscii } from '../../contracts/evidence.mjs';
import { readArtifacts } from '../../shared/artifacts.mjs';
import { enumerate } from '../../shared/enum.mjs';
import {
  MAINTAINABILITY_LIMITS,
  NO_EXTENSION_LABEL,
  OTHER_EXTENSION_LABEL,
  buildMaintainabilityModel,
  complexityDistribution,
  detectDeadCodeConfigSignals,
  detectDeadCodeSourceSignals,
  detectGeneratedBoundary,
  detectToolEvidence,
  isValidExcludedExtension,
  sizeBucketFor,
  toolConfigCandidatePaths,
} from './model.mjs';
import { countBranchPoints, countFunctionComplexity, dialectForPath, tokenize } from './tokenizer.mjs';
import { findDuplicateGroups } from './duplicates.mjs';

export const MAINTAINABILITY_SCANNER_ID = 'DET-maintainability-scan-v1';

const READ_LIMITS = Object.freeze({
  maxBytes: MAINTAINABILITY_LIMITS.maxBytes,
  maxDepth: MAINTAINABILITY_LIMITS.maxDepth,
  maxFiles: MAINTAINABILITY_LIMITS.files,
  maxRecords: MAINTAINABILITY_LIMITS.maxRecords,
});

const MAX_TOOL_CANDIDATES = 96;

function extensionOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

function diagnostic(path, status, reason, line = null) {
  return { path, status, reason, line };
}

function sourceRequests(files) {
  const requests = [];
  for (const path of files) {
    if (dialectForPath(path) === null) continue;
    requests.push({ path, format: 'text', sensitivity: 'internal' });
    if (requests.length >= MAINTAINABILITY_LIMITS.files) break;
  }
  return requests;
}

function probeRequests() {
  return toolConfigCandidatePaths().slice(0, MAX_TOOL_CANDIDATES).map((path) => ({
    path,
    format: path === 'package.json' || path === 'tsconfig.json' || path === 'jsconfig.json'
      ? 'json' : 'text',
    sensitivity: 'internal',
  }));
}

// Map a raw extension to a disclosed excluded-language label. Extensions that
// fail the model's validator (for example editor backups `*.js~`, `*.bak~` or
// non-ASCII extensions such as `*.日本語`) are collapsed into the disclosed
// `other` sentinel at the scanner boundary, so an unusual filename can never
// abort the dimension through `normalizeExcludedLanguage`.
function disclosedExtension(path) {
  const raw = extensionOf(path);
  if (raw === '') return NO_EXTENSION_LABEL;
  return isValidExcludedExtension(raw) ? raw : OTHER_EXTENSION_LABEL;
}

function excludedLanguages(files) {
  const counts = new Map();
  for (const path of files) {
    if (dialectForPath(path) !== null) continue;
    const extension = disclosedExtension(path);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts.entries()]
    .toSorted(([left], [right]) => compareAscii(left, right))
    .map(([extension, count]) => ({ extension, count }));
}

function sizeDistribution(byBytes) {
  const counts = new Map();
  for (const bytes of byBytes) {
    const bucket = sizeBucketFor(bytes);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return [...counts.entries()]
    .toSorted(([left], [right]) => compareAscii(left, right))
    .map(([bucket, count]) => ({ bucket, count }));
}

/**
 * Scan a repository's maintainability measurements.
 *
 * @param {string} repoPath - absolute repository root.
 * @param {object} _overview - survey overview (unused; retained for the shared
 *   scanner contract).
 * @returns {Promise<object>} `{ dimension: 'maintainability', signal, findings }`
 *   where `findings` is the deep-frozen maintainability model.
 */
export async function scan(repoPath, _overview) {
  const { files } = await enumerate(repoPath);
  const requests = sourceRequests(files);
  const { results, searchSpace } = await readArtifacts(repoPath, requests, READ_LIMITS);

  const fileRecords = [];
  const branchRecords = [];
  const complexityRecords = [];
  const deadCode = [];
  const boundaryRecords = [];
  const tokenFiles = [];
  const diagnostics = [];
  const measuredBytes = [];
  let measuredFiles = 0;

  for (const result of results) {
    if (result.status !== 'read') {
      const reason = result.status === 'unreadable' ? 'UNREADABLE'
        : result.status === 'malformed' ? 'MALFORMED'
        : result.status === 'capped' ? 'CAP' : 'UNSUPPORTED';
      const status = ['capped', 'unreadable', 'malformed'].includes(result.status)
        ? 'unverified' : 'unsupported';
      diagnostics.push(diagnostic(result.path, status, reason));
      continue;
    }

    const dialect = dialectForPath(result.path);
    if (dialect === null) continue;

    const text = typeof result.value === 'string' ? result.value : '';
    const { tokens, truncated } = tokenize(text, dialect);
    const counts = countBranchPoints(tokens, dialect);
    const { functions } = countFunctionComplexity(text, dialect, tokens);
    const lines = result.records > 0 ? result.records : 1;
    const bytes = result.bytes;

    fileRecords.push({
      path: result.path,
      dialect,
      bytes,
      lines,
      tokens: tokens.length,
      sizeBucket: sizeBucketFor(bytes),
    });
    branchRecords.push({
      path: result.path,
      dialect,
      tokens: tokens.length,
      counts,
      capped: truncated,
    });
    const maxFunctions = MAINTAINABILITY_LIMITS.complexityFunctions;
    const functionsCapped = functions.length > maxFunctions;
    complexityRecords.push({
      path: result.path,
      dialect,
      functions: functionsCapped ? functions.slice(0, maxFunctions) : functions,
      distribution: complexityDistribution(functions.map((entry) => entry.complexity)),
      functionsCapped,
    });
    if (functionsCapped) {
      diagnostics.push(diagnostic(result.path, 'unverified', 'COMPLEXITY_CAP'));
    }
    deadCode.push(...detectDeadCodeSourceSignals({ path: result.path, dialect, text }));
    tokenFiles.push({ path: result.path, tokens });
    measuredBytes.push(bytes);
    measuredFiles++;

    const boundary = detectGeneratedBoundary(result.path, text);
    if (boundary !== null) boundaryRecords.push(boundary);

    if (truncated) {
      diagnostics.push(diagnostic(result.path, 'unverified', 'TOKEN_LIMIT'));
    }
  }

  const toolRecords = [];
  let configFilesInspected = 0;
  const probe = await readArtifacts(repoPath, probeRequests(), READ_LIMITS);
  for (const result of probe.results) {
    if (result.status !== 'read') {
      if (result.status === 'malformed' || result.status === 'capped') {
        diagnostics.push(diagnostic(
          result.path,
          result.status === 'malformed' ? 'unverified' : 'unverified',
          result.status === 'malformed' ? 'MALFORMED' : 'CAP',
        ));
      }
      continue;
    }
    configFilesInspected++;
    toolRecords.push(...detectToolEvidence({
      path: result.path,
      format: result.format,
      value: result.value,
      text: typeof result.value === 'string' ? result.value : '',
    }));
    deadCode.push(...detectDeadCodeConfigSignals({
      path: result.path,
      format: result.format,
      value: result.value,
      text: typeof result.value === 'string' ? result.value : '',
    }));
  }

  const duplicateResult = findDuplicateGroups(tokenFiles, {
    maxGroups: MAINTAINABILITY_LIMITS.duplicateGroups,
    maxSpansPerGroup: MAINTAINABILITY_LIMITS.spansPerGroup,
    maxWindows: MAINTAINABILITY_LIMITS.maxWindows,
  });

  const eligibleFiles = files.filter((path) => dialectForPath(path) !== null).length;

  const model = buildMaintainabilityModel({
    files: fileRecords,
    branchPoints: branchRecords,
    complexityRecords,
    deadCode,
    duplicateGroups: duplicateResult.groups,
    duplicateCaps: duplicateResult.capped,
    generatedBoundaries: boundaryRecords,
    toolEvidence: toolRecords,
    measurement: {
      filesInspected: searchSpace.filesInspected,
      bytesInspected: searchSpace.bytesInspected,
      recordsInspected: searchSpace.recordsInspected,
      eligibleFiles,
      measuredFiles,
      omittedCount: searchSpace.omittedCount,
      excludedLanguages: excludedLanguages(files),
      configFilesInspected,
    },
    sizeDistribution: sizeDistribution(measuredBytes),
    diagnostics,
    searchSpace,
  });

  return {
    dimension: 'maintainability',
    signal: model.summary.filesMeasured > 0 ? 'high' : 'low',
    findings: model,
  };
}
