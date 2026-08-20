// API Surface dimension — scanner.
//
// T211 owns this module. It is an inert deep scanner: it enumerates the
// repository, reads a bounded set of contract/source/package artifacts, runs
// the declaration-backed extractors, and builds the deterministic API model.
// It is exported as a factory-friendly `scan` function for tests and the
// future T224 pipeline cutover; nothing in the current pipeline, CLI, enrich,
// validate, write, or existing-ten renderer dispatches it yet.
//
// Read-only: enumeration uses the shared `rg --files` broker; artifact content
// is read through the bounded T206 reader. No target command is executed.
//
// ESM only. Zero npm deps. node: builtins only.

import { compareAscii } from '../../contracts/evidence.mjs';
import { readArtifacts } from '../../shared/artifacts.mjs';
import { enumerate } from '../../shared/enum.mjs';
import { API_LIMITS, buildApiModel } from './model.mjs';
import { classifyPath, extractApiSurface } from './extractor.mjs';

export const API_SCANNER_ID = 'DET-api-scan-v1';
export const API_SOURCE_FILE_LIMIT = 512;

/**
 * Map a bounded reader outcome to a distinct diagnostic reason. Unreadable
 * files, capped/skipped files, malformed artifacts, and unsupported formats
 * are reported separately so callers can distinguish real read failures from
 * disclosed truncation or content problems.
 * @param {object} result - a `readArtifacts` outcome with a `status` field.
 * @returns {object} `{ path, status: 'unverified', reason, line: null }`.
 */
export function diagnosticForOutcome(result) {
  const reasons = {
    capped: 'CAP',
    malformed: 'MALFORMED',
    unreadable: 'UNREADABLE',
    unsupported: 'UNSUPPORTED',
  };
  return {
    path: result.path,
    status: 'unverified',
    reason: reasons[result.status] ?? 'UNREADABLE',
    line: null,
  };
}

const READ_LIMITS = Object.freeze({
  maxBytes: API_LIMITS.maxBytes,
  maxDepth: API_LIMITS.maxDepth,
  maxFiles: API_LIMITS.maxFiles,
  maxRecords: API_LIMITS.maxRecords,
});

function basenameOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function sourcePriority(path) {
  const base = basenameOf(path).toLowerCase();
  let score = 0;
  if (/^(?:app|server|index|main|router|routes|route)\./.test(base)) score += 8;
  if (/^(?:urls|views|api|endpoints|controllers)\./.test(base)) score += 6;
  if (/^(?:lib|mod)\.rs$/.test(base)) score += 6;
  if (/^(?:cli|__main__|manage|wsgi|asgi)\./.test(base)) score += 4;
  if (/(?:^|\/)(?:routes?|controllers?|views|endpoints?|handlers?|middleware|api)\//.test(path)) score += 5;
  if (/(?:^|\/)(?:cli|cmd|bin|commands?|management\/commands)\//.test(path)) score += 3;
  return score;
}

function sortedCandidates(files) {
  return [...files].toSorted((left, right) => {
    const byScore = sourcePriority(right) - sourcePriority(left);
    return byScore !== 0 ? byScore : compareAscii(left, right);
  });
}

function contractRequests(files) {
  const requests = [];
  for (const path of files) {
    const classification = classifyPath(path);
    if (classification.kind !== 'contract') continue;
    requests.push({ path, format: classification.format, sensitivity: 'internal' });
  }
  return requests;
}

function sourceRequests(files) {
  const requests = [];
  for (const path of sortedCandidates(files)) {
    const classification = classifyPath(path);
    if (classification.kind !== 'source') continue;
    requests.push({ path, format: classification.format, sensitivity: 'internal' });
    if (requests.length >= API_SOURCE_FILE_LIMIT) break;
  }
  return requests;
}

function packageRequest(files) {
  const hit = files.find((path) => path === 'package.json');
  return hit === undefined ? null : { path: hit, format: 'json', sensitivity: 'internal' };
}

function requestList(files) {
  const requests = [...contractRequests(files)];
  const pkg = packageRequest(files);
  if (pkg !== null) requests.push(pkg);
  requests.push(...sourceRequests(files));
  requests.sort((left, right) => compareAscii(left.path, right.path));
  const seen = new Set();
  return requests.filter(({ path }) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

function extractionFor(result) {
  if (result.status !== 'read') {
    return {
      operations: [],
      diagnostics: [diagnosticForOutcome(result)],
      capped: {},
    };
  }
  const classification = classifyPath(result.path);
  return extractApiSurface({
    path: result.path,
    text: classification.format === 'text' ? result.value : '',
    value: classification.format === 'json' ? result.value : null,
    format: classification.format,
    ecosystem: classification.ecosystem,
  });
}

function modelFromResults(results, searchSpace) {
  const operations = [];
  const diagnostics = [];
  for (const result of results) {
    const extracted = extractionFor(result);
    operations.push(...extracted.operations);
    diagnostics.push(...extracted.diagnostics);
  }
  return buildApiModel({ operations, diagnostics, searchSpace });
}

function sourceEligibleCount(files) {
  let count = 0;
  for (const path of files) {
    if (classifyPath(path).kind === 'source') count++;
  }
  return count;
}

/**
 * The scanner samples at most `API_SOURCE_FILE_LIMIT` source files by priority.
 * `readArtifacts` only sees the requested subset, so its `searchSpace` would
 * overclaim completeness whenever eligible source files were skipped. This
 * merges the sampling disclosure into the search space: incomplete, capped,
 * and an omittedCount that includes every skipped eligible source file.
 * @param {string[]} files - the enumerated repository-relative file list.
 * @param {object} searchSpace - the deep-frozen read search space.
 * @returns {object} A (possibly updated) search space with the sampling cap
 *   surfaced; never claims completeness when files were skipped.
 */
function discloseSourceSampling(files, searchSpace) {
  const eligibleSources = sourceEligibleCount(files);
  const requestedSources = Math.min(eligibleSources, API_SOURCE_FILE_LIMIT);
  const skipped = eligibleSources - requestedSources;
  if (skipped <= 0) return searchSpace;
  return {
    ...searchSpace,
    complete: false,
    capped: true,
    omittedCount: searchSpace.omittedCount + skipped,
  };
}

/**
 * Scan a repository's declaration-backed API surface.
 *
 * @param {string} repoPath - absolute repository root.
 * @param {object} _overview - survey overview (unused; retained for the shared
 *   scanner contract).
 * @returns {Promise<object>} `{ dimension: 'api', signal, findings }` where
 *   `findings` is the deep-frozen API model.
 */
export async function scan(repoPath, _overview) {
  const { files } = await enumerate(repoPath);
  const requests = requestList(files);
  const { results, searchSpace } = await readArtifacts(repoPath, requests, READ_LIMITS);
  const disclosedSpace = discloseSourceSampling(files, searchSpace);
  const model = modelFromResults(results, disclosedSpace);
  return {
    dimension: 'api',
    signal: model.summary.operations > 0 ? 'high' : 'low',
    findings: model,
  };
}
