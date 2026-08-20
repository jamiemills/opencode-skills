// API Surface dimension — output model.
//
// T211 owns this module. It is the deterministic, privacy-safe, deep-frozen
// model produced by the API scanner and consumed by the inert API renderer and
// the T210-compatible API provider (`lib/scan/providers/api.mjs`). Nothing in
// the pipeline, CLI, enrich, validate, write, or existing-ten renderer consumes
// it yet; activation happens at T224.
//
// Guarantees:
//   - Operations are validated against the DIM-api-v1 category allowlist
//     (T202): cli_command, contract, event, public_export, route, rpc.
//   - Every rendered operation references admissible evidence via
//     `source = { path, line }` (repo-relative path, stable line) and a
//     deterministic `matchedKey`. Name-only fixtures produce no records.
//   - Identities are prefixed stable tokens (e.g. `GET:/api/users`), never bare
//     absolute-path-shaped strings, so they pass the T206 privacy primitive.
//   - The model is deterministic (explicit comparators), deep-frozen, and
//     carries bounded caps with disclosed counts plus a T202-compatible
//     `searchSpace`.
//   - Privacy is enforced per operation: a record that fails `assertPrivacySafe`
//     is converted into an `unverified` diagnostic with reason `PRIVACY` and is
//     never persisted, matching the T207 privacy-handling pattern.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
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

export const API_DIMENSION_ID = 'DIM-api-v1';

export const API_OPERATION_CATEGORIES = Object.freeze([
  'cli_command',
  'contract',
  'event',
  'public_export',
  'route',
  'rpc',
]);

export const API_STATUSES = Object.freeze(['observed', 'unverified']);

export const API_LIMITS = deepFreeze({
  cliCommands: 256,
  contracts: 256,
  diagnostics: 512,
  events: 256,
  maxBytes: 16 * 1024 * 1024,
  maxDepth: 16,
  maxFiles: 512,
  maxRecords: 500_000,
  perFileContracts: 16,
  perFileDiagnostics: 32,
  perFileOperations: 256,
  publicExports: 512,
  routes: 512,
  rpcs: 256,
});

const DIAGNOSTIC_KEYS = Object.freeze(['line', 'path', 'reason', 'status']);
const OPERATION_KEYS = Object.freeze([
  'category', 'details', 'dialect', 'id', 'matchedKey', 'signature', 'source', 'status',
]);
const SOURCE_KEYS = Object.freeze(['line', 'path']);
const CAP_KEYS = Object.freeze([
  'cliCommands', 'contracts', 'events', 'files', 'operations', 'publicExports', 'routes', 'rpcs',
]);
const ROUTE_DETAILS_KEYS = Object.freeze(['method', 'operationId']);
const CONTRACT_DETAILS_KEYS = Object.freeze(['format', 'version']);
const RPC_DETAILS_KEYS = Object.freeze(['method', 'service']);
const EVENT_DETAILS_KEYS = Object.freeze(['emitter']);
const CLI_DETAILS_KEYS = Object.freeze(['command']);
const EXPORT_DETAILS_KEYS = Object.freeze(['kind', 'module']);

const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#@+%()[\],{}-]*$/;
const DETAILS_PATTERN = /^[\x21-\x7e]+$/;
const DIAGNOSTIC_REASON_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export class ApiModelError extends TypeError {
  constructor(code, message) {
    super(`Invalid API model: ${message}`);
    this.name = 'ApiModelError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ApiModelError(code, message);
}

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).toSorted(compareAscii);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('UNKNOWN_FIELD', `${label} fields do not match the schema`);
  }
}

function plainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', `${label} must be an object`);
  }
}

function category(value) {
  if (typeof value !== 'string' || !API_OPERATION_CATEGORIES.includes(value)) {
    fail('UNKNOWN_CATEGORY', 'operation category is not allowlisted for the API dimension');
  }
  return value;
}

function dialect(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 48
      || !DETAILS_PATTERN.test(value)) {
    fail('INVALID_DIALECT', 'dialect must be a bounded stable token');
  }
  return value;
}

function status(value) {
  if (typeof value !== 'string' || !API_STATUSES.includes(value)) {
    fail('INVALID_STATUS', 'operation status must be observed or unverified');
  }
  return value;
}

function signature(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256
      || !IDENTITY_PATTERN.test(value)) {
    fail('INVALID_IDENTITY', 'signature must be a bounded stable token');
  }
  return value;
}

function detailValue(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 128
      || !DETAILS_PATTERN.test(value)) {
    fail('INVALID_DETAILS', 'details must contain bounded stable tokens');
  }
  return value;
}

function normalizeSourcePath(value) {
  try {
    return normalizeEvidencePath(value);
  } catch {
    fail('INVALID_PATH', 'source path must be a normalized repository-relative POSIX path');
  }
}

function source(value) {
  plainObject(value, 'source');
  exactKeys(value, SOURCE_KEYS, 'source');
  const path = normalizeSourcePath(value.path);
  const line = value.line;
  if (line !== null && (!Number.isSafeInteger(line) || line < 1 || line > 1_000_000)) {
    fail('INVALID_SOURCE', 'source line must be a bounded positive integer or null');
  }
  return { path, line };
}

function detailsFor(categoryName, value) {
  plainObject(value, 'details');
  const schema = {
    route: ROUTE_DETAILS_KEYS,
    contract: CONTRACT_DETAILS_KEYS,
    rpc: RPC_DETAILS_KEYS,
    event: EVENT_DETAILS_KEYS,
    cli_command: CLI_DETAILS_KEYS,
    public_export: EXPORT_DETAILS_KEYS,
  }[categoryName];
  exactKeys(value, schema, 'details');
  return Object.fromEntries(
    schema.map((key) => [key, detailValue(value[key])]),
  );
}

function operationIdentity(op) {
  return `${op.category}\0${op.dialect}\0${op.signature}\0${op.source.path}\0${op.source.line ?? 0}`;
}

function hashOf(parts) {
  const framed = parts
    .map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`)
    .join('|');
  return createHash('sha256').update(framed).digest('hex');
}

export function operationId(op) {
  return `op-${hashOf(operationIdentity(op).split('\0')).slice(0, 24)}`;
}

export function matchedKeyFor(categoryName, opIdentity) {
  return `${categoryName}:${opIdentity}`;
}

export function encodeMatchedKey(value) {
  return value.replace(/\{/g, '%7B').replace(/\}/g, '%7D');
}

/**
 * True when a signature is a valid bounded stable-token charset value that
 * `buildApiModel` will accept. The extractor uses this predicate to degrade
 * wildcard/glob/oversized literals to DYNAMIC diagnostics instead of letting
 * an unrepresentable signature reach the model and crash it.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidSignatureToken(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && IDENTITY_PATTERN.test(value);
}

/**
 * True when a detail value is within the model's legal charset/bounds
 * (`null` for optional absent details, bounded printable ASCII strings).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidDetailValue(value) {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 128
    && DETAILS_PATTERN.test(value));
}

function normalizeCandidate(candidate) {
  assertDataOnly(candidate, ApiModelError, {
    maxArray: 512,
    maxDepth: 6,
    maxNodes: 4096,
    maxObjectKeys: 16,
    maxString: 512,
  });
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('INVALID_TYPE', 'operation candidate must be an object');
  }
  const allowed = Object.freeze([
    'category', 'details', 'dialect', 'line', 'path', 'signature', 'status',
  ]);
  exactKeys(candidate, allowed, 'operation candidate');
  const categoryName = category(candidate.category);
  return {
    category: categoryName,
    dialect: dialect(candidate.dialect),
    signature: signature(candidate.signature),
    status: status(candidate.status),
    details: detailsFor(categoryName, candidate.details),
    source: source({ path: candidate.path, line: candidate.line ?? null }),
  };
}

export function createMatchedKey(candidate) {
  const normalized = normalizeCandidate(candidate);
  return matchedKeyFor(normalized.category, normalized.signature);
}

function normalizeDiagnostic(value) {
  assertDataOnly(value, ApiModelError, {
    maxArray: 64,
    maxDepth: 4,
    maxNodes: 256,
    maxObjectKeys: 8,
    maxString: 512,
  });
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', 'diagnostic must be an object');
  }
  exactKeys(value, DIAGNOSTIC_KEYS, 'diagnostic');
  const path = normalizeSourcePath(value.path);
  if (!['unsupported', 'unverified'].includes(value.status)) {
    fail('INVALID_STATUS', 'diagnostic status must be unsupported or unverified');
  }
  if (typeof value.reason !== 'string' || value.reason.length === 0 || value.reason.length > 64
      || !DIAGNOSTIC_REASON_PATTERN.test(value.reason)) {
    fail('INVALID_REASON', 'diagnostic reason must be a bounded uppercase token');
  }
  const line = value.line;
  if (line !== null && (!Number.isSafeInteger(line) || line < 1 || line > 1_000_000)) {
    fail('INVALID_DIAGNOSTIC', 'diagnostic line must be a bounded positive integer or null');
  }
  return { path, status: value.status, reason: value.reason, line };
}

function privacyFilter(operations, diagnostics) {
  const kept = [];
  const privacyDiagnostics = [];
  for (const operation of operations) {
    try {
      assertPrivacySafe(operation);
      kept.push(operation);
    } catch {
      privacyDiagnostics.push({
        path: redactText(operation.source.path),
        status: 'unverified',
        reason: 'PRIVACY',
        line: null,
      });
    }
  }
  const allDiagnostics = [...diagnostics, ...privacyDiagnostics];
  const unique = [];
  const seen = new Set();
  for (const diagnostic of allDiagnostics.toSorted((left, right) => compareAscii(left.path, right.path)
    || compareAscii(left.status, right.status)
    || compareAscii(left.reason, right.reason)
    || (left.line ?? 0) - (right.line ?? 0))) {
    const key = `${diagnostic.path}\0${diagnostic.status}\0${diagnostic.reason}\0${diagnostic.line ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(diagnostic);
  }
  return { operations: kept, diagnostics: unique };
}

/**
 * Build the deterministic deep-frozen API model.
 *
 * @param {object} input - `{ operations, diagnostics, searchSpace, measurement }`.
 *   `operations` are candidate raw records produced by the extractor;
 *   `searchSpace` is the T202-compatible search-space object from
 *   `readArtifacts`; `measurement` carries `{ filesInspected, bytesInspected,
 *   recordsInspected }` used when no search space is supplied.
 * @returns {object} The deep-frozen model:
 *   `{ summary, operations, diagnostics, searchSpace }`.
 * @throws {ApiModelError} on malformed candidates, categories, or search
 *   spaces; privacy violations are downgraded to diagnostics and never abort.
 */
export function buildApiModel({ operations = [], diagnostics = [], searchSpace = null, measurement = {} } = {}) {
  const candidates = (Array.isArray(operations) ? operations : []).map(normalizeCandidate);

  const seen = new Set();
  const normalizedOperations = [];
  for (const candidate of candidates) {
    const matchedKey = matchedKeyFor(candidate.category, candidate.signature);
    const operation = {
      category: candidate.category,
      dialect: candidate.dialect,
      signature: candidate.signature,
      status: candidate.status,
      details: candidate.details,
      source: candidate.source,
      matchedKey,
      id: operationId(candidate),
    };
    exactKeys(operation, OPERATION_KEYS, 'operation');
    const dedupeKey = `${matchedKey}\0${operation.source.path}\0${operation.source.line ?? 0}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalizedOperations.push(operation);
  }

  const diagnosticRecords = (Array.isArray(diagnostics) ? diagnostics : []).map(normalizeDiagnostic);
  const { operations: privacySafe, diagnostics: uniqueDiagnostics } = privacyFilter(
    normalizedOperations,
    diagnosticRecords,
  );

  privacySafe.sort((left, right) => compareAscii(left.matchedKey, right.matchedKey)
    || compareAscii(left.source.path, right.source.path)
    || (left.source.line ?? 0) - (right.source.line ?? 0));

  const space = searchSpace ?? normalizeEmptySearchSpace(measurement);

  const counts = { contracts: 0, routes: 0, rpcs: 0, events: 0, cliCommands: 0, publicExports: 0 };
  for (const operation of privacySafe) {
    counts[operation.category === 'cli_command' ? 'cliCommands'
      : operation.category === 'public_export' ? 'publicExports'
      : `${operation.category}s`]++;
  }

  const capped = {
    contracts: counts.contracts > API_LIMITS.contracts,
    events: counts.events > API_LIMITS.events,
    operations: privacySafe.length > API_LIMITS.operations,
    routes: counts.routes > API_LIMITS.routes,
    rpcs: counts.rpcs > API_LIMITS.rpcs,
    cliCommands: counts.cliCommands > API_LIMITS.cliCommands,
    publicExports: counts.publicExports > API_LIMITS.publicExports,
    files: space.capped,
  };
  exactKeys(capped, CAP_KEYS, 'capped');

  const summary = {
    operations: privacySafe.length,
    contracts: counts.contracts,
    routes: counts.routes,
    rpcs: counts.rpcs,
    events: counts.events,
    cliCommands: counts.cliCommands,
    publicExports: counts.publicExports,
    diagnostics: uniqueDiagnostics.length,
    filesInspected: space.filesInspected,
    bytesInspected: space.bytesInspected,
    recordsInspected: space.recordsInspected,
    capped,
  };

  return deepFreeze({
    summary,
    operations: privacySafe,
    diagnostics: uniqueDiagnostics,
    searchSpace: space,
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
    fileLimit: API_LIMITS.maxFiles,
    bytesInspected: measurement.bytesInspected ?? 0,
    byteLimit: API_LIMITS.maxBytes,
    recordsInspected: measurement.recordsInspected ?? 0,
    recordLimit: API_LIMITS.maxRecords,
    omittedCount: 0,
  });
}
