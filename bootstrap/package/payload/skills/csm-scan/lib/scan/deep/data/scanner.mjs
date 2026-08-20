// Data Architecture dimension — scanner.
//
// T212 owns this module. It is an inert deep scanner: it enumerates the
// repository, reads a bounded set of SQL/ORM/migration artifacts, runs the
// declaration-backed extractors, and builds the deterministic data model.
// It is exported as a factory-friendly `scan` function for tests and the
// future T224 pipeline cutover; nothing in the current pipeline, CLI, enrich,
// validate, write, or existing-ten renderer dispatches it yet.
//
// Read-only: enumeration uses the shared `rg --files` broker; artifact content
// is read through the bounded T206 reader. No database is contacted and no
// migration is executed.
//
// ESM only. Zero npm deps. node: builtins only.

import { compareAscii } from '../../contracts/evidence.mjs';
import { readArtifacts } from '../../shared/artifacts.mjs';
import { enumerate } from '../../shared/enum.mjs';
import { DATA_LIMITS, buildDataModel } from './model.mjs';
import { classifyDataPath, extractDataArtifact, migrationKindOf } from './extractor.mjs';

export const DATA_SCANNER_ID = 'DET-data-scan-v1';
export const DATA_SOURCE_FILE_LIMIT = 512;

/**
 * Map a bounded reader outcome to a distinct diagnostic reason. Mirrors the
 * API scanner so capped, malformed, unreadable, and unsupported outcomes are
 * reported separately instead of being collapsed into a single reason.
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
  maxBytes: DATA_LIMITS.maxBytes,
  maxDepth: DATA_LIMITS.maxDepth,
  maxFiles: DATA_LIMITS.maxFiles,
  maxRecords: DATA_LIMITS.maxRecords,
});

function basenameOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function sourcePriority(path) {
  const base = basenameOf(path).toLowerCase();
  let score = 0;
  if (base === 'schema.prisma' || base === 'schema.rs' || base === 'db.rs') score += 8;
  if (/^(?:models?|model)\./.test(base)) score += 8;
  if (/^(?:db|database|schema|repository|entities?|domain)\./.test(base)) score += 6;
  if (/^(?:migrations?|alembic)\//.test(path)) score += 4;
  if (/(?:^|\/)(?:models?|entities?|domain|repositories?|migrations?)\//.test(path)) score += 5;
  return score;
}

function sortedCandidates(files) {
  return [...files].toSorted((left, right) => {
    const byScore = sourcePriority(right) - sourcePriority(left);
    return byScore !== 0 ? byScore : compareAscii(left, right);
  });
}

function dataRequests(files) {
  const requests = [];
  const seen = new Set();
  for (const path of sortedCandidates(files)) {
    const classification = classifyDataPath(path);
    if (classification.kind === 'other') continue;
    if (seen.has(path)) continue;
    seen.add(path);
    requests.push({ path, format: 'text', sensitivity: 'internal' });
  }
  const migrations = [];
  const sql = [];
  const source = [];
  for (const request of requests) {
    if (migrationKindOf(request.path) !== null) migrations.push(request);
    else if (classifyDataPath(request.path).kind === 'sql' || classifyDataPath(request.path).kind === 'prisma') {
      sql.push(request);
    } else {
      source.push(request);
    }
  }
  const ordered = [...migrations, ...sql, ...source.slice(0, DATA_SOURCE_FILE_LIMIT)];
  ordered.sort((left, right) => compareAscii(left.path, right.path));
  const unique = [];
  const dedupe = new Set();
  for (const request of ordered) {
    if (dedupe.has(request.path)) continue;
    dedupe.add(request.path);
    unique.push(request);
  }
  return unique;
}

function extractionFor(result) {
  if (result.status !== 'read') {
    return {
      records: [],
      edges: [],
      diagnostics: [diagnosticForOutcome(result)],
      capped: {},
    };
  }
  return extractDataArtifact({
    path: result.path,
    text: result.value,
    value: null,
    format: 'text',
    ecosystem: classifyDataPath(result.path).ecosystem,
  });
}

function modelFromResults(results, searchSpace) {
  const records = [];
  const edges = [];
  const diagnostics = [];
  for (const result of results) {
    const extracted = extractionFor(result);
    records.push(...extracted.records);
    edges.push(...extracted.edges);
    diagnostics.push(...extracted.diagnostics);
  }
  return buildDataModel({ records, edges, diagnostics, searchSpace });
}

function sourceEligibleCount(files) {
  let count = 0;
  for (const path of files) {
    const classification = classifyDataPath(path);
    if (classification.kind === 'other') continue;
    if (migrationKindOf(path) !== null) continue;
    if (classification.kind === 'sql' || classification.kind === 'prisma') continue;
    count++;
  }
  return count;
}

/**
 * The scanner samples at most `DATA_SOURCE_FILE_LIMIT` data-source files by
 * priority. `readArtifacts` only sees the requested subset, so its
 * `searchSpace` would overclaim completeness whenever eligible source files
 * were skipped. This mirrors the API scanner's sampling disclosure: the
 * search space is marked incomplete, capped, and the omitted count includes
 * every skipped eligible data-source file.
 * @param {string[]} files - the enumerated repository-relative file list.
 * @param {object} searchSpace - the deep-frozen read search space.
 * @returns {object} A (possibly updated) search space with the sampling cap
 *   surfaced; never claims completeness when files were skipped.
 */
function discloseSourceSampling(files, searchSpace) {
  const eligibleSources = sourceEligibleCount(files);
  const requestedSources = Math.min(eligibleSources, DATA_SOURCE_FILE_LIMIT);
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
 * Scan a repository's declaration-backed data architecture.
 *
 * @param {string} repoPath - absolute repository root.
 * @param {object} _overview - survey overview (unused; retained for the shared
 *   scanner contract).
 * @returns {Promise<object>} `{ dimension: 'data', signal, findings }` where
 *   `findings` is the deep-frozen data model.
 */
export async function scan(repoPath, _overview) {
  const { files } = await enumerate(repoPath);
  const requests = dataRequests(files);
  const { results, searchSpace } = await readArtifacts(repoPath, requests, READ_LIMITS);
  const disclosedSpace = discloseSourceSampling(files, searchSpace);
  const model = modelFromResults(results, disclosedSpace);
  const recordCount = model.entities.length + model.fields.length + model.keys.length
    + model.relations.length + model.stores.length + model.schemas.length
    + model.migrations.length + model.caches.length + model.queues.length;
  return {
    dimension: 'data',
    signal: recordCount > 0 || model.edges.length > 0 ? 'high' : 'low',
    findings: model,
  };
}
