// Assurance & Supply Chain dimension — output model.
//
// T216 owns this module. It is the deterministic, privacy-safe, deep-frozen
// model produced by the assurance scanner and consumed by the inert assurance
// renderer and the T210-compatible assurance provider
// (`lib/scan/providers/assurance.mjs`). Nothing in the pipeline, CLI, enrich,
// validate, write, or existing-ten renderer consumes it yet; activation
// happens at T224.
//
// Guarantees:
//   - Every record category is validated against the DIM-assurance-v1 category
//     allowlist (T202): accessibility, attestation, configuration, license,
//     lock, manifest, pin, sarif, sbom, source, standard, tool_result, vex.
//   - Records carry a stable identity (`matchedKey`), a repo-relative `path`,
//     a bounded per-category `details` object, and a `status` of `observed` or
//     `unverified`. Search-state records carry a T202-compatible search space.
//   - Malformed result artifacts (SBOM/VEX/SARIF/tool results) become
//     diagnostics without invalidating manifest/lock/pin evidence from valid
//     peers (per-artifact atomicity).
//   - Standards records reference T200 registry IDs with `disposition:
//     'metadata_only'` and never claim compliance/conformance/compatibility or
//     any vulnerability verdict; the model contains no verdict vocabulary.
//   - The model is deterministic (explicit comparators), deep-frozen, and
//     carries bounded caps with disclosed counts.
//   - Privacy is enforced per record: a record that fails `assertPrivacySafe`
//     is dropped and converted into an `unverified` diagnostic with reason
//     `PRIVACY`, matching the T207/T211 privacy-handling pattern.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none).
//
// Source-policy note (T201): this module imports only contracts and the shared
// privacy primitive; it never touches node:fs / node:child_process /
// node:process / node:vm / node:module, so the recurring capability gate
// remains closed.

import { createHash } from 'node:crypto';

import {
  assertDataOnly,
  compareAscii,
  deepFreeze,
  normalizeEvidencePath,
} from '../../contracts/evidence.mjs';
import { assertPrivacySafe, redactText } from '../../shared/privacy.mjs';

export const ASSURANCE_DIMENSION_ID = 'DIM-assurance-v1';

export const ASSURANCE_CATEGORIES = Object.freeze([
  'accessibility',
  'attestation',
  'configuration',
  'license',
  'lock',
  'manifest',
  'pin',
  'sarif',
  'sbom',
  'source',
  'standard',
  'tool_result',
  'vex',
]);

export const ASSURANCE_STATUSES = Object.freeze(['observed', 'unverified']);

export const DIAGNOSTIC_STATUSES = Object.freeze([
  'capped', 'malformed', 'unreadable', 'unsupported', 'unverified',
]);

export const ASSURANCE_LIMITS = deepFreeze({
  accessibility: 128,
  attestations: 128,
  configurations: 128,
  diagnostics: 512,
  licenses: 256,
  locks: 128,
  manifests: 256,
  maxBytes: 16 * 1024 * 1024,
  maxDepth: 16,
  maxFiles: 256,
  maxRecords: 10_000,
  perFile: 256,
  pins: 2048,
  sarifs: 64,
  sboms: 64,
  sources: 256,
  standards: 128,
  toolResults: 128,
  vexes: 64,
});

const MANIFEST_DETAILS_KEYS = Object.freeze(['ecosystem', 'format']);
const LOCK_DETAILS_KEYS = Object.freeze(['format']);
const PIN_DETAILS_KEYS = Object.freeze(['package', 'scope', 'version']);
const SOURCE_DETAILS_KEYS = Object.freeze(['host', 'kind', 'label']);
const LICENSE_DETAILS_KEYS = Object.freeze(['declared', 'identifier']);
const SBOM_DETAILS_KEYS = Object.freeze(['format', 'projection', 'specVersion']);
const VEX_DETAILS_KEYS = Object.freeze(['format', 'specVersion', 'statementCount']);
const SARIF_DETAILS_KEYS = Object.freeze(['projection', 'version']);
const CONFIG_DETAILS_KEYS = Object.freeze(['tool']);
const RESULT_DETAILS_KEYS = Object.freeze(['format', 'tool']);
const ACCESSIBILITY_DETAILS_KEYS = Object.freeze(['declared', 'kind']);
const ATTESTATION_DETAILS_KEYS = Object.freeze(['format', 'kind']);
const STANDARD_DETAILS_KEYS = Object.freeze(['disposition', 'editionKey', 'registryId']);

const DETAILS_KEYS = Object.freeze({
  accessibility: ACCESSIBILITY_DETAILS_KEYS,
  attestation: ATTESTATION_DETAILS_KEYS,
  configuration: CONFIG_DETAILS_KEYS,
  license: LICENSE_DETAILS_KEYS,
  lock: LOCK_DETAILS_KEYS,
  manifest: MANIFEST_DETAILS_KEYS,
  pin: PIN_DETAILS_KEYS,
  sarif: SARIF_DETAILS_KEYS,
  sbom: SBOM_DETAILS_KEYS,
  source: SOURCE_DETAILS_KEYS,
  standard: STANDARD_DETAILS_KEYS,
  tool_result: RESULT_DETAILS_KEYS,
  vex: VEX_DETAILS_KEYS,
});

const DETAILS_TOKEN_PATTERN = /^[\x21-\x7e]{1,256}$/;
const DIAGNOSTIC_REASON_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export class AssuranceModelError extends TypeError {
  constructor(code, message) {
    super(`Invalid assurance model: ${message}`);
    this.name = 'AssuranceModelError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new AssuranceModelError(code, message);
}

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).sort(compareAscii);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('UNKNOWN_FIELD', `${label} fields do not match the schema`);
  }
}

function plainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', `${label} must be an object`);
  }
}

function categoryOf(value) {
  if (typeof value !== 'string' || !ASSURANCE_CATEGORIES.includes(value)) {
    fail('UNKNOWN_CATEGORY', 'record category is not allowlisted for the assurance dimension');
  }
  return value;
}

function statusOf(value) {
  if (typeof value !== 'string' || !ASSURANCE_STATUSES.includes(value)) {
    fail('INVALID_STATUS', 'record status must be observed or unverified');
  }
  return value;
}

function normalizedPath(value) {
  try {
    return normalizeEvidencePath(value);
  } catch {
    fail('INVALID_PATH', 'record path must be a normalized repository-relative POSIX path');
  }
}

function detailToken(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 256
      || !DETAILS_TOKEN_PATTERN.test(value)) {
    fail('INVALID_DETAILS', `${label} must contain bounded printable ASCII`);
  }
  return value;
}

function detailsObject(value, expected, label) {
  plainObject(value, label);
  exactKeys(value, expected, label);
  return Object.fromEntries(expected.map((key) => [key, detailToken(value[key], key)]));
}

function projectionDetails(value) {
  assertDataOnly(value, AssuranceModelError, {
    maxArray: 4096,
    maxDepth: 12,
    maxNodes: 16_384,
    maxObjectKeys: 256,
    maxString: 512,
  });
  return value;
}

function normalizeDetails(categoryName, details) {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) {
    fail('INVALID_DETAILS', 'record details must be an object');
  }
  if (categoryName === 'sbom' || categoryName === 'sarif') {
    const keys = categoryName === 'sbom' ? SBOM_DETAILS_KEYS : SARIF_DETAILS_KEYS;
    plainObject(details, 'details');
    exactKeys(details, keys, 'details');
    const normalized = {};
    for (const key of keys) {
      if (key === 'projection') normalized.projection = projectionDetails(details.projection);
      else normalized[key] = detailToken(details[key], key);
    }
    return normalized;
  }
  if (categoryName === 'vex') {
    plainObject(details, 'details');
    exactKeys(details, VEX_DETAILS_KEYS, 'details');
    if (!Number.isSafeInteger(details.statementCount) || details.statementCount < 0
        || details.statementCount > 10_000_000) {
      fail('INVALID_DETAILS', 'vex statementCount must be a bounded non-negative integer');
    }
    return {
      format: detailToken(details.format, 'format'),
      specVersion: detailToken(details.specVersion, 'specVersion'),
      statementCount: details.statementCount,
    };
  }
  if (categoryName === 'standard') {
    plainObject(details, 'details');
    exactKeys(details, STANDARD_DETAILS_KEYS, 'details');
    return {
      registryId: detailToken(details.registryId, 'registryId'),
      editionKey: detailToken(details.editionKey, 'editionKey'),
      disposition: detailToken(details.disposition, 'disposition'),
    };
  }
  return detailsObject(details, DETAILS_KEYS[categoryName], 'details');
}

function identityFor(categoryName, details) {
  switch (categoryName) {
    case 'manifest': return `manifest:${details.format}`;
    case 'lock': return `lock:${details.format}`;
    case 'pin': return `pin:${details.package}:${details.version}`;
    case 'source': return `source:${details.kind}:${details.host}`;
    case 'license': return `license:${details.declared}:${details.identifier}`;
    case 'sbom': return `sbom:${details.format}:${details.specVersion ?? 'unknown'}`;
    case 'vex': return `vex:${details.format}:${details.specVersion ?? 'unknown'}`;
    case 'sarif': return `sarif:${details.version ?? 'unknown'}`;
    case 'configuration': return `configuration:${details.tool}`;
    case 'tool_result': return `tool_result:${details.tool}:${details.format ?? 'unknown'}`;
    case 'accessibility': return `accessibility:${details.kind}:${details.declared ?? 'none'}`;
    case 'attestation': return `attestation:${details.format}:${details.kind}`;
    case 'standard': return `standard:${details.registryId}`;
    default: fail('UNKNOWN_CATEGORY', 'record category is not supported');
  }
}

function encodeMatchedKey(value) {
  return value.replace(/\{/g, '%7B').replace(/\}/g, '%7D');
}

function hashOf(parts) {
  const framed = parts
    .map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`)
    .join('|');
  return createHash('sha256').update(framed).digest('hex');
}

export function recordId(record) {
  return `asc-${hashOf([record.category, record.matchedKey, record.path]).slice(0, 24)}`;
}

function normalizeCandidate(candidate) {
  assertDataOnly(candidate, AssuranceModelError, {
    maxArray: 512,
    maxDepth: 6,
    maxNodes: 4096,
    maxObjectKeys: 16,
    maxString: 512,
  });
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('INVALID_TYPE', 'assurance candidate must be an object');
  }
  const allowed = Object.freeze(['category', 'details', 'path', 'status']);
  exactKeys(candidate, allowed, 'assurance candidate');
  const categoryName = categoryOf(candidate.category);
  const details = normalizeDetails(categoryName, candidate.details);
  return {
    category: categoryName,
    path: normalizedPath(candidate.path),
    status: statusOf(candidate.status),
    details,
  };
}

export function createMatchedKey(candidate) {
  const normalized = normalizeCandidate(candidate);
  return encodeMatchedKey(identityFor(normalized.category, normalized.details));
}

function normalizeDiagnostic(value) {
  assertDataOnly(value, AssuranceModelError, {
    maxArray: 64,
    maxDepth: 4,
    maxNodes: 256,
    maxObjectKeys: 8,
    maxString: 512,
  });
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', 'diagnostic must be an object');
  }
  exactKeys(value, ['path', 'reason', 'status'], 'diagnostic');
  const path = normalizedPath(value.path);
  if (!DIAGNOSTIC_STATUSES.includes(value.status)) {
    fail('INVALID_STATUS', 'diagnostic status is not allowlisted');
  }
  if (typeof value.reason !== 'string' || value.reason.length === 0 || value.reason.length > 64
      || !DIAGNOSTIC_REASON_PATTERN.test(value.reason)) {
    fail('INVALID_REASON', 'diagnostic reason must be a bounded uppercase token');
  }
  return { path, status: value.status, reason: value.reason };
}

function privacyFilter(records, diagnostics) {
  const kept = [];
  const privacyDiagnostics = [];
  for (const record of records) {
    try {
      assertPrivacySafe(record);
      kept.push(record);
    } catch {
      privacyDiagnostics.push({
        path: redactText(record.path),
        status: 'unverified',
        reason: 'PRIVACY',
      });
    }
  }
  const allDiagnostics = [...diagnostics, ...privacyDiagnostics];
  const unique = [];
  const seen = new Set();
  for (const diagnostic of allDiagnostics.sort((left, right) => compareAscii(left.path, right.path)
    || compareAscii(left.status, right.status)
    || compareAscii(left.reason, right.reason))) {
    const key = `${diagnostic.path}\0${diagnostic.status}\0${diagnostic.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(diagnostic);
  }
  return { records: kept, diagnostics: unique };
}

function capRecords(records, maximum) {
  const capped = records.length > maximum;
  return { records: capped ? records.slice(0, maximum) : records, capped };
}

/**
 * Build the deterministic deep-frozen assurance model.
 *
 * @param {object} input - `{ records, diagnostics, searchSpace, measurement }`.
 *   `records` are candidate raw records produced by the parsers (category,
 *   path, status, details); `diagnostics` are per-artifact diagnostics;
 *   `searchSpace` is the T202-compatible search space from `readArtifacts`;
 *   `measurement` carries `{ filesInspected, bytesInspected,
 *   recordsInspected }` used when no search space is supplied.
 * @returns {object} The deep-frozen model:
 *   `{ summary, ...collections, diagnostics, searchSpace }`.
 * @throws {AssuranceModelError} on malformed candidates, categories, or search
 *   spaces; privacy violations are downgraded to diagnostics and never abort.
 */
export function buildAssuranceModel({
  records = [],
  diagnostics = [],
  searchSpace = null,
  measurement = {},
} = {}) {
  const candidates = (Array.isArray(records) ? records : []).map(normalizeCandidate);

  const seen = new Set();
  const normalizedRecords = [];
  for (const candidate of candidates) {
    const matchedKey = encodeMatchedKey(identityFor(candidate.category, candidate.details));
    const record = {
      category: candidate.category,
      path: candidate.path,
      status: candidate.status,
      details: candidate.details,
      matchedKey,
    };
    const dedupeKey = `${record.category}\0${record.matchedKey}\0${record.path}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalizedRecords.push({ ...record, id: recordId(record) });
  }

  const diagnosticRecords = (Array.isArray(diagnostics) ? diagnostics : []).map(normalizeDiagnostic);
  const { records: privacySafe, diagnostics: uniqueDiagnostics } = privacyFilter(
    normalizedRecords,
    diagnosticRecords,
  );

  privacySafe.sort((left, right) => compareAscii(left.category, right.category)
    || compareAscii(left.matchedKey, right.matchedKey)
    || compareAscii(left.path, right.path));

  const space = searchSpace ?? normalizeEmptySearchSpace(measurement);

  const grouped = Object.fromEntries(ASSURANCE_CATEGORIES.map((category) => [category, []]));
  for (const record of privacySafe) grouped[record.category].push(record);

  const capped = { files: space.capped, records: false, diagnostics: false };
  const boundedDiagnostics = uniqueDiagnostics.length > ASSURANCE_LIMITS.diagnostics
    ? (capped.diagnostics = true, uniqueDiagnostics.slice(0, ASSURANCE_LIMITS.diagnostics))
    : uniqueDiagnostics;
  const summaryCounts = { diagnostics: boundedDiagnostics.length };
  for (const category of ASSURANCE_CATEGORIES) {
    const limitKey = {
      accessibility: 'accessibility',
      attestation: 'attestations',
      configuration: 'configurations',
      license: 'licenses',
      lock: 'locks',
      manifest: 'manifests',
      pin: 'pins',
      sarif: 'sarifs',
      sbom: 'sboms',
      source: 'sources',
      standard: 'standards',
      tool_result: 'toolResults',
      vex: 'vexes',
    }[category];
    const { records: cappedList, capped: hit } = capRecords(grouped[category], ASSURANCE_LIMITS[limitKey]);
    grouped[category] = cappedList;
    capped[limitKey] = hit;
    summaryCounts[limitKey] = cappedList.length;
  }
  summaryCounts.records = ASSURANCE_CATEGORIES
    .reduce((sum, category) => sum + grouped[category].length, 0);
  const allCapped = Object.values(capped).some(Boolean);
  if (privacySafe.length > ASSURANCE_LIMITS.perFile * 8) capped.records = true;

  const summary = {
    ...summaryCounts,
    filesInspected: space.filesInspected,
    bytesInspected: space.bytesInspected,
    recordsInspected: space.recordsInspected,
    capped,
  };

  return deepFreeze({
    summary,
    ...Object.fromEntries(ASSURANCE_CATEGORIES.map((category) => [category, grouped[category]])),
    diagnostics: boundedDiagnostics,
    searchSpace: space,
    cappedTotal: allCapped,
  });
}

function normalizeEmptySearchSpace(measurement) {
  return deepFreeze({
    supported: true,
    readable: true,
    complete: true,
    capped: false,
    error: false,
    malformed: false,
    ambiguous: false,
    filesInspected: measurement.filesInspected ?? 0,
    fileLimit: ASSURANCE_LIMITS.maxFiles,
    bytesInspected: measurement.bytesInspected ?? 0,
    byteLimit: ASSURANCE_LIMITS.maxBytes,
    recordsInspected: measurement.recordsInspected ?? 0,
    recordLimit: ASSURANCE_LIMITS.maxRecords,
    omittedCount: 0,
  });
}
