// Assurance & Supply Chain dimension — scanner.
//
// T216 owns this module. It is an inert deep scanner: it enumerates the
// repository, reads a bounded set of content-bearing assurance artifacts
// (manifests, lockfiles, SBOM/VEX/SARIF documents, accessibility statements)
// through the bounded T206 reader, records presence-only artifacts (tool
// configuration, tool results, attestations, license files) directly from the
// enumerated path list, and builds the deterministic assurance model. It is
// exported as a factory-friendly `scanAssurance` for tests and the future T224
// pipeline cutover; nothing in the current pipeline, CLI, enrich, validate,
// write, or existing-ten renderer dispatches it yet.
//
// Read-only: enumeration uses the shared `rg --files` broker; artifact content
// is read through the bounded T206 reader. No package resolution/install,
// advisory lookup, scanner execution, or signature validation is performed.
//
// Per-artifact atomicity: an artifact that is unreadable, unsupported,
// malformed, privacy-violating, or over a declared cap becomes a diagnostic
// without erasing the results of valid peer artifacts.
//
// ESM only. Zero npm deps. node: builtins only.
//
// Source-policy note (T201): this module imports only shared primitives and
// the assurance model/parsers; it never touches node:fs /
// node:child_process / node:process / node:vm / node:module.

import { deepFreeze, normalizeEvidencePath } from '../../contracts/evidence.mjs';
import { readArtifacts } from '../../shared/artifacts.mjs';
import { enumerate } from '../../shared/enum.mjs';
import { assertPrivacySafe, PrivacyError } from '../../shared/privacy.mjs';
import {
  ASSURANCE_LIMITS,
  AssuranceModelError,
  buildAssuranceModel,
} from './model.mjs';
import {
  classifyAssurancePath,
  discoverAssuranceArtifacts,
  extractAssuranceArtifact,
} from './parsers.mjs';

export const ASSURANCE_SCANNER_ID = 'DET-assurance-scan-v1';

const READ_LIMITS = Object.freeze({
  maxBytes: ASSURANCE_LIMITS.maxBytes,
  maxDepth: ASSURANCE_LIMITS.maxDepth,
  maxFiles: ASSURANCE_LIMITS.maxFiles,
  maxRecords: ASSURANCE_LIMITS.maxRecords,
});

// Presence-only kinds never need content reads; their records are derived
// directly from the enumerated path.
const PRESENCE_ONLY_KINDS = new Set(['attestation', 'configuration', 'license', 'tool_result']);

function requestOf(entry) {
  if (typeof entry === 'string') {
    const classification = classifyAssurancePath(entry);
    if (classification === null) throw new AssuranceModelError('INVALID_REQUEST', 'not an assurance artifact path');
    return { path: entry, format: classification.format, sensitivity: 'internal' };
  }
  if (entry !== null && typeof entry === 'object' && typeof entry.path === 'string') {
    const classification = classifyAssurancePath(entry.path);
    return {
      path: entry.path,
      format: entry.format ?? classification?.format ?? 'text',
      sensitivity: entry.sensitivity ?? 'internal',
    };
  }
  throw new AssuranceModelError('INVALID_REQUEST', 'assurance requests must be paths or request objects');
}

function artifactFailure(path, status, reason) {
  return { path, status, reason };
}

const STATUS_REASON = Object.freeze({
  capped: 'CAP',
  malformed: 'MALFORMED',
  unreadable: 'UNREADABLE',
  unsupported: 'UNSUPPORTED',
});

function presenceRecord(path, kind) {
  return extractAssuranceArtifact({
    path,
    text: '',
    value: null,
    format: 'text',
    kind,
  });
}

/**
 * Scan assurance artifacts and build a repository-level model.
 *
 * @param {object} input - `{ root, files, requests, options }`.
 *   `files` is an optional list of repository-relative paths (discovery);
 *   `requests` is an optional list of paths or `{ path, format, sensitivity }`
 *   records. `options` is a `ASSURANCE_LIMITS`-shaped bounds object.
 * @returns {object} A deep-frozen `{ artifacts, model, searchSpace }`
 *   envelope. `artifacts` holds per-artifact results; `model` is the
 *   deterministic assurance model; `searchSpace` is the T202-compatible read
 *   search space.
 */
export async function scanAssurance({
  root,
  files = [],
  requests = [],
  options = ASSURANCE_LIMITS,
} = {}) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new AssuranceModelError('INVALID_ROOT', 'repository root is required');
  }
  const paths = new Map();
  for (const candidate of discoverAssuranceArtifacts(files)) paths.set(candidate, true);
  for (const entry of requests) {
    let normalized;
    try {
      normalized = normalizeEvidencePath(requestOf(entry).path);
    } catch {
      throw new AssuranceModelError('INVALID_PATH', 'assurance request path is not normalized');
    }
    paths.set(normalized, true);
  }
  const sorted = [...paths.keys()].sort();
  if (sorted.length > options.maxFiles) {
    throw new AssuranceModelError('ARTIFACT_LIMIT', 'assurance artifact count exceeds the declared cap');
  }

  const artifacts = [];
  const records = [];
  const diagnostics = [];

  const contentRequests = [];
  for (const path of sorted) {
    const classification = classifyAssurancePath(path);
    if (classification === null) {
      artifacts.push(artifactFailure(path, 'unsupported', 'NO_EXTRACTOR'));
      diagnostics.push({ path, status: 'unsupported', reason: 'NO_EXTRACTOR' });
      continue;
    }
    if (PRESENCE_ONLY_KINDS.has(classification.kind) || classification.format === 'binary') {
      const extracted = presenceRecord(path, classification.kind);
      records.push(...extracted.records);
      diagnostics.push(...extracted.diagnostics);
      artifacts.push({ path, status: 'parsed', reason: null });
      continue;
    }
    contentRequests.push(requestOf(path));
  }

  if (contentRequests.length > 0) {
    const read = await readArtifacts(root, contentRequests, {
      maxBytes: options.maxBytes,
      maxDepth: options.maxDepth,
      maxFiles: options.maxFiles,
      maxRecords: options.maxRecords,
    });
    for (const result of read.results) {
      if (result.status !== 'read') {
        const reason = STATUS_REASON[result.status] ?? result.status.toUpperCase();
        artifacts.push(artifactFailure(result.path, result.status, result.status));
        diagnostics.push({ path: result.path, status: result.status, reason });
        continue;
      }
      const classification = classifyAssurancePath(result.path);
      if (classification === null) {
        artifacts.push(artifactFailure(result.path, 'unsupported', 'NO_EXTRACTOR'));
        diagnostics.push({ path: result.path, status: 'unsupported', reason: 'NO_EXTRACTOR' });
        continue;
      }
      try {
        const extracted = extractAssuranceArtifact({
          path: result.path,
          text: classification.format === 'text' ? result.value : '',
          value: classification.format === 'json' ? result.value : null,
          format: classification.format,
          kind: classification.kind,
        });
        const combined = {
          records: [...records, ...extracted.records],
          diagnostics: [...diagnostics, ...extracted.diagnostics],
        };
        assertPrivacySafe(combined);
        records.push(...extracted.records);
        diagnostics.push(...extracted.diagnostics);
        artifacts.push({ path: result.path, status: 'parsed', reason: null });
      } catch (error) {
        if (error instanceof PrivacyError) {
          artifacts.push(artifactFailure(result.path, 'unverified', 'privacy'));
          diagnostics.push({ path: result.path, status: 'unverified', reason: 'PRIVACY' });
        } else {
          artifacts.push(artifactFailure(result.path, 'malformed', 'PARSE_UNSUPPORTED'));
          diagnostics.push({ path: result.path, status: 'malformed', reason: 'PARSE_UNSUPPORTED' });
        }
      }
    }
    const searchSpace = read.searchSpace;
    const model = buildAssuranceModel({ records, diagnostics, searchSpace });
    return deepFreeze({ artifacts, model, searchSpace });
  }

  const model = buildAssuranceModel({
    records,
    diagnostics,
    measurement: { filesInspected: sorted.length, bytesInspected: 0, recordsInspected: sorted.length },
  });
  return deepFreeze({ artifacts, model, searchSpace: model.searchSpace });
}

/**
 * Scan a repository's assurance & supply-chain artifacts.
 *
 * @param {string} repoPath - absolute repository root.
 * @param {object} overview - survey overview (used for the enumerated file
 *   list when available).
 * @returns {Promise<object>} `{ dimension, signal, findings }` where
 *   `findings` is the deep-frozen assurance model.
 */
export async function scan(repoPath, overview = {}) {
  const enumerated = overview && Array.isArray(overview.files) && overview.files.length > 0
    ? { files: overview.files }
    : await enumerate(repoPath);
  const { model } = await scanAssurance({ root: repoPath, files: enumerated.files });
  const total = model.summary.records;
  return {
    dimension: 'assurance',
    signal: total > 0 ? 'high' : 'low',
    findings: model,
  };
}
