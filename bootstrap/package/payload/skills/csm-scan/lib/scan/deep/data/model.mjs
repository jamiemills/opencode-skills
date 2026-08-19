// Data Architecture dimension — output model.
//
// T212 owns this module. It is the deterministic, privacy-safe, deep-frozen
// model produced by the data scanner and consumed by the inert data renderer
// and the T210-compatible data provider (`lib/scan/providers/data.mjs`).
// Nothing in the pipeline, CLI, enrich, validate, write, or existing-ten
// renderer consumes it yet; activation happens at T224.
//
// Guarantees:
//   - Records are validated against the DIM-data-v1 category allowlist (T202):
//     cache, entity, field, key, migration, queue, relation, schema, store.
//   - Every rendered record references admissible evidence via
//     `source = { path, line }` (repo-relative path, stable line) and a
//     deterministic `matchedKey`. Name-only relation fixtures produce no
//     relation records and no edges.
//   - ER edges require explicit relation evidence: an edge candidate only
//     becomes an edge when both endpoints resolve to exactly one declared
//     entity in the same scan. Zero candidates are `unresolved`; multiple
//     candidates are `ambiguous`; both stay diagnostics and never become edges.
//   - Migration order uses explicit predecessor edges only (Django
//     `dependencies`, Alembic `down_revision`); filename ordering never infers
//     order. Predecessor references resolve through canonical aliases and
//     require exactly one matching migration.
//   - The model is deterministic (explicit comparators), deep-frozen, and
//     carries bounded caps with disclosed counts plus a T202-compatible
//     `searchSpace`.
//   - Privacy is enforced per record: a record that fails `assertPrivacySafe`
//     is converted into an `unverified` diagnostic with reason `PRIVACY` and is
//     never persisted, matching the T207 privacy-handling pattern.
//
// ESM only. Zero npm deps. node: builtins only (imported here: node:crypto).
// Pure DATA; no filesystem, network, child-process, or executable access.
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

export const DATA_DIMENSION_ID = 'DIM-data-v1';

export const DATA_RECORD_CATEGORIES = Object.freeze([
  'cache',
  'entity',
  'field',
  'key',
  'migration',
  'queue',
  'relation',
  'schema',
  'store',
]);

export const RELATION_KINDS = Object.freeze([
  'belongs_to',
  'belongs_to_many',
  'foreign_key',
  'has_many',
  'has_one',
  'many_to_many',
]);

export const DATA_EDGE_KINDS = Object.freeze([
  ...RELATION_KINDS,
  'migration_predecessor',
]);

export const KEY_KINDS = Object.freeze(['foreign', 'index', 'primary', 'unique']);

export const STORE_KINDS = Object.freeze(['database', 'datasource']);

export const DATA_STATUSES = Object.freeze(['observed', 'unverified']);

export const DATA_LIMITS = deepFreeze({
  caches: 128,
  columns: 64,
  dependencies: 32,
  diagnostics: 512,
  downRevision: 128,
  edges: 1024,
  entities: 512,
  fields: 2048,
  indexColumns: 64,
  keys: 2048,
  label: 128,
  maxBytes: 16 * 1024 * 1024,
  maxDepth: 16,
  maxFiles: 512,
  maxRecords: 500_000,
  migrations: 512,
  perFileDiagnostics: 64,
  perFileRecords: 512,
  queues: 128,
  relations: 1024,
  revision: 128,
  schemas: 128,
  stores: 64,
  type: 128,
});

const DIAGNOSTIC_KEYS = Object.freeze(['line', 'path', 'reason', 'status']);
const RECORD_KEYS = Object.freeze([
  'category', 'details', 'dialect', 'id', 'matchedKey', 'signature', 'source', 'status',
]);
const SOURCE_KEYS = Object.freeze(['line', 'path']);
const EDGE_KEYS = Object.freeze(['evidence', 'from', 'id', 'kind', 'status', 'to']);
const EVIDENCE_KEYS = Object.freeze(['line', 'matchedKey', 'path']);
const CAP_KEYS = Object.freeze([
  'caches', 'edges', 'entities', 'fields', 'files', 'keys', 'migrations', 'queues',
  'records', 'relations', 'schemas', 'stores',
]);
const STORE_DETAILS_KEYS = Object.freeze(['kind', 'label']);
const SCHEMA_DETAILS_KEYS = Object.freeze(['label']);
const ENTITY_DETAILS_KEYS = Object.freeze(['table']);
const FIELD_DETAILS_KEYS = Object.freeze(['nullable', 'type']);
const KEY_DETAILS_KEYS = Object.freeze(['columns', 'kind']);
const RELATION_DETAILS_KEYS = Object.freeze(['kind', 'target']);
const CACHE_DETAILS_KEYS = Object.freeze(['scope']);
const QUEUE_DETAILS_KEYS = Object.freeze(['scope']);
const MIGRATION_DETAILS_KEYS = Object.freeze(['alias', 'dependencies', 'downRevision', 'revision']);

const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#@+%()[\],{}-]*$/;
const DETAILS_PATTERN = /^[\x21-\x7e]+$/;
const DIAGNOSTIC_REASON_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export class DataModelError extends TypeError {
  constructor(code, message) {
    super(`Invalid data model: ${message}`);
    this.name = 'DataModelError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new DataModelError(code, message);
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

function category(value) {
  if (typeof value !== 'string' || !DATA_RECORD_CATEGORIES.includes(value)) {
    fail('UNKNOWN_CATEGORY', 'record category is not allowlisted for the data dimension');
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
  if (typeof value !== 'string' || !DATA_STATUSES.includes(value)) {
    fail('INVALID_STATUS', 'record status must be observed or unverified');
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

function label(value, field = 'label') {
  if (typeof value !== 'string' || value.length === 0 || value.length > DATA_LIMITS.label
      || /[^A-Za-z0-9_.-]/.test(value) || value.startsWith('-') || value.endsWith('.')) {
    fail('INVALID_LABEL', `${field} must be a bounded safe identifier`);
  }
  return value;
}

function detailValue(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > DATA_LIMITS.type
      || !DETAILS_PATTERN.test(value)) {
    fail('INVALID_DETAILS', `${field} must contain bounded stable tokens`);
  }
  return value;
}

function optionalBoolean(value, field) {
  if (typeof value !== 'boolean') fail('INVALID_DETAILS', `${field} must be boolean`);
  return value;
}

function optionalBoundedString(value, maximum, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || !DETAILS_PATTERN.test(value)) {
    fail('INVALID_DETAILS', `${field} must be a bounded stable token`);
  }
  return value;
}

function boundedAlias(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > DATA_LIMITS.label
      || !DETAILS_PATTERN.test(value)) {
    fail('INVALID_EDGE', 'migration predecessor alias must be a bounded stable token');
  }
  return value;
}

function boundedStringList(value, maximum, field) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail('BOUND_EXCEEDED', `${field} exceeds the declared cap`);
  }
  const result = value.map((entry) => {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > DATA_LIMITS.label
        || !DETAILS_PATTERN.test(entry)) {
      fail('INVALID_DETAILS', `${field} must contain bounded stable tokens`);
    }
    return entry;
  });
  if (new Set(result).size !== result.length) {
    fail('DUPLICATE_ID', `${field} contains duplicate entries`);
  }
  return result;
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
    store: STORE_DETAILS_KEYS,
    schema: SCHEMA_DETAILS_KEYS,
    entity: ENTITY_DETAILS_KEYS,
    field: FIELD_DETAILS_KEYS,
    key: KEY_DETAILS_KEYS,
    relation: RELATION_DETAILS_KEYS,
    cache: CACHE_DETAILS_KEYS,
    queue: QUEUE_DETAILS_KEYS,
    migration: MIGRATION_DETAILS_KEYS,
  }[categoryName];
  exactKeys(value, schema, 'details');

  if (categoryName === 'store') {
    if (!STORE_KINDS.includes(value.kind)) fail('INVALID_DETAILS', 'store kind is not allowlisted');
    return { kind: value.kind, label: label(value.label, 'store label') };
  }
  if (categoryName === 'schema') {
    return { label: label(value.label, 'schema label') };
  }
  if (categoryName === 'entity') {
    return { table: value.table === null ? null : label(value.table, 'entity table') };
  }
  if (categoryName === 'field') {
    return {
      type: detailValue(value.type, 'field type'),
      nullable: optionalBoolean(value.nullable, 'field nullable'),
    };
  }
  if (categoryName === 'key') {
    if (!KEY_KINDS.includes(value.kind)) fail('INVALID_DETAILS', 'key kind is not allowlisted');
    return {
      kind: value.kind,
      columns: boundedStringList(value.columns, DATA_LIMITS.indexColumns, 'key columns'),
    };
  }
  if (categoryName === 'relation') {
    if (!RELATION_KINDS.includes(value.kind)) fail('INVALID_DETAILS', 'relation kind is not allowlisted');
    return { kind: value.kind, target: label(value.target, 'relation target') };
  }
  if (categoryName === 'cache' || categoryName === 'queue') {
    if (!['config', 'constructor'].includes(value.scope)) {
      fail('INVALID_DETAILS', 'declaration scope is not allowlisted');
    }
    return { scope: value.scope };
  }
  if (categoryName === 'migration') {
    return {
      alias: optionalBoundedString(value.alias, DATA_LIMITS.label, 'migration alias'),
      revision: optionalBoundedString(value.revision, DATA_LIMITS.revision, 'migration revision'),
      downRevision: optionalBoundedString(value.downRevision, DATA_LIMITS.downRevision, 'migration downRevision'),
      dependencies: boundedStringList(value.dependencies, DATA_LIMITS.dependencies, 'migration dependencies'),
    };
  }
  fail('UNKNOWN_CATEGORY', 'record category is not allowlisted');
}

function recordIdentity(record) {
  return `${record.category}\0${record.dialect}\0${record.signature}\0${record.source.path}\0${record.source.line ?? 0}`;
}

function hashOf(parts) {
  const framed = parts
    .map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`)
    .join('|');
  return createHash('sha256').update(framed).digest('hex');
}

export function recordId(record) {
  return `rec-${hashOf(recordIdentity(record).split('\0')).slice(0, 24)}`;
}

export function matchedKeyFor(categoryName, recordSignature) {
  return `${categoryName}:${recordSignature}`;
}

export function encodeMatchedKey(value) {
  return value.replace(/\{/g, '%7B').replace(/\}/g, '%7D');
}

function normalizeCandidate(candidate) {
  assertDataOnly(candidate, DataModelError, {
    maxArray: DATA_LIMITS.maxRecords,
    maxDepth: 6,
    maxNodes: 4096,
    maxObjectKeys: 16,
    maxString: 512,
  });
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('INVALID_TYPE', 'record candidate must be an object');
  }
  const allowed = Object.freeze([
    'category', 'details', 'dialect', 'line', 'path', 'signature', 'status',
  ]);
  exactKeys(candidate, allowed, 'record candidate');
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
  assertDataOnly(value, DataModelError, {
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

function privacyFilter(records, diagnostics) {
  const kept = [];
  const privacyDiagnostics = [];
  for (const record of records) {
    try {
      assertPrivacySafe(record);
      kept.push(record);
    } catch {
      privacyDiagnostics.push({
        path: redactText(record.source.path),
        status: 'unverified',
        reason: 'PRIVACY',
        line: null,
      });
    }
  }
  const allDiagnostics = [...diagnostics, ...privacyDiagnostics];
  const unique = [];
  const seen = new Set();
  for (const diagnostic of allDiagnostics.sort((left, right) => compareAscii(left.path, right.path)
    || compareAscii(left.status, right.status)
    || compareAscii(left.reason, right.reason)
    || (left.line ?? 0) - (right.line ?? 0))) {
    const key = `${diagnostic.path}\0${diagnostic.status}\0${diagnostic.reason}\0${diagnostic.line ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(diagnostic);
  }
  return { records: kept, diagnostics: unique };
}

function entityIdOf(label) {
  return `entity@${label}`;
}

function migrationIdOf(path) {
  return `migration@${path}`;
}

function privacyFilterEdges(edges, diagnostics) {
  const kept = [];
  const privacyDiagnostics = [];
  for (const edge of edges) {
    try {
      assertPrivacySafe(edge);
      kept.push(edge);
    } catch {
      privacyDiagnostics.push({
        path: redactText(edge.evidence.path),
        status: 'unverified',
        reason: 'PRIVACY',
        line: null,
      });
    }
  }
  return { edges: kept, diagnostics: [...diagnostics, ...privacyDiagnostics] };
}

function normalizeEdgeCandidate(value) {
  assertDataOnly(value, DataModelError, {
    maxArray: 64,
    maxDepth: 6,
    maxNodes: 1024,
    maxObjectKeys: 16,
    maxString: 512,
  });
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', 'edge candidate must be an object');
  }
  const keys = Object.keys(value).sort(compareAscii);
  const migrationEdge = keys.includes('fromAlias');
  const expected = migrationEdge
    ? ['fromAlias', 'kind', 'line', 'matchedKey', 'path', 'toPath']
    : ['from', 'kind', 'line', 'matchedKey', 'path', 'to'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('UNKNOWN_FIELD', 'edge candidate fields do not match the schema');
  }
  if (!DATA_EDGE_KINDS.includes(value.kind)) fail('INVALID_EDGE', 'edge kind is not allowlisted');
  const path = normalizeSourcePath(value.path);
  const line = value.line;
  if (line !== null && (!Number.isSafeInteger(line) || line < 1 || line > 1_000_000)) {
    fail('INVALID_EDGE', 'edge line must be a bounded positive integer or null');
  }
  if (typeof value.matchedKey !== 'string' || value.matchedKey.length === 0
      || value.matchedKey.length > 256 || !IDENTITY_PATTERN.test(value.matchedKey)) {
    fail('INVALID_EDGE', 'edge evidence matchedKey must be a bounded stable token');
  }
  if (migrationEdge) {
    return {
      migration: true,
      fromAlias: boundedAlias(value.fromAlias),
      toPath: normalizeSourcePath(value.toPath),
      kind: value.kind,
      path,
      line,
      matchedKey: value.matchedKey,
    };
  }
  return {
    migration: false,
    from: label(value.from, 'edge source entity'),
    to: label(value.to, 'edge target entity'),
    kind: value.kind,
    path,
    line,
    matchedKey: value.matchedKey,
  };
}

function uniqueRecordKey(record) {
  return `${record.matchedKey}\0${record.source.path}\0${record.source.line ?? 0}`;
}

function normalizeRecords(candidates) {
  const seen = new Set();
  const normalized = [];
  for (const candidate of candidates) {
    const record = {
      category: candidate.category,
      dialect: candidate.dialect,
      signature: candidate.signature,
      status: candidate.status,
      details: candidate.details,
      source: candidate.source,
      matchedKey: matchedKeyFor(candidate.category, candidate.signature),
      id: null,
    };
    record.id = recordId(record);
    exactKeys(record, RECORD_KEYS, 'record');
    const dedupeKey = uniqueRecordKey(record);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push(record);
  }
  return normalized;
}

function resolveRelationEdgeCandidates(candidates, entityCounts, recordsByMatchedKey) {
  const edges = [];
  const diagnostics = [];
  for (const candidate of candidates) {
    const sourceCount = entityCounts.get(candidate.from) ?? 0;
    const targetCount = entityCounts.get(candidate.to) ?? 0;
    if (sourceCount !== 1 || targetCount === 0) {
      diagnostics.push({ path: candidate.path, status: 'unverified', reason: 'UNRESOLVED', line: candidate.line });
      continue;
    }
    if (targetCount > 1) {
      diagnostics.push({ path: candidate.path, status: 'unverified', reason: 'AMBIGUOUS', line: candidate.line });
      continue;
    }
    if (!recordsByMatchedKey.has(candidate.matchedKey)) continue;
    const edge = {
      from: entityIdOf(candidate.from),
      to: entityIdOf(candidate.to),
      kind: candidate.kind,
      status: 'observed',
      evidence: { path: candidate.path, line: candidate.line, matchedKey: candidate.matchedKey },
    };
    edges.push({ ...edge, id: edgeId(edge) });
  }
  return { edges, diagnostics };
}

function resolveMigrationEdgeCandidates(candidates, migrationsByPath, migrationsByAlias, recordsByMatchedKey) {
  const edges = [];
  const diagnostics = [];
  for (const candidate of candidates) {
    const toCount = migrationsByPath.get(candidate.toPath) ?? 0;
    const fromCount = migrationsByAlias.get(candidate.fromAlias) ?? 0;
    if (toCount !== 1 || fromCount === 0) {
      diagnostics.push({ path: candidate.path, status: 'unverified', reason: 'UNRESOLVED', line: candidate.line });
      continue;
    }
    if (fromCount > 1) {
      diagnostics.push({ path: candidate.path, status: 'unverified', reason: 'AMBIGUOUS', line: candidate.line });
      continue;
    }
    if (!recordsByMatchedKey.has(candidate.matchedKey)) continue;
    const edge = {
      from: migrationIdOf(candidate.fromAlias),
      to: migrationIdOf(candidate.toPath),
      kind: candidate.kind,
      status: 'observed',
      evidence: { path: candidate.path, line: candidate.line, matchedKey: candidate.matchedKey },
    };
    edges.push({ ...edge, id: edgeId(edge) });
  }
  return { edges, diagnostics };
}

function normalizeEdge(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', 'edge must be an object');
  }
  exactKeys(value, EDGE_KEYS, 'edge');
  if (typeof value.from !== 'string' || value.from.length === 0 || value.from.length > 256
      || !IDENTITY_PATTERN.test(value.from)
      || typeof value.to !== 'string' || value.to.length === 0 || value.to.length > 256
      || !IDENTITY_PATTERN.test(value.to)) {
    fail('INVALID_EDGE', 'edge endpoints must be bounded stable identifiers');
  }
  if (!DATA_EDGE_KINDS.includes(value.kind)) fail('INVALID_EDGE', 'edge kind is not allowlisted');
  if (value.status !== 'observed') fail('INVALID_STATUS', 'edge status must be observed');
  const evidence = value.evidence;
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail('INVALID_TYPE', 'edge evidence must be an object');
  }
  exactKeys(evidence, EVIDENCE_KEYS, 'edge evidence');
  const path = normalizeSourcePath(evidence.path);
  const matchedKey = evidence.matchedKey;
  if (typeof matchedKey !== 'string' || matchedKey.length === 0 || matchedKey.length > 256
      || !IDENTITY_PATTERN.test(matchedKey)) {
    fail('INVALID_EDGE', 'edge evidence matchedKey must be a bounded stable token');
  }
  const line = evidence.line;
  if (line !== null && (!Number.isSafeInteger(line) || line < 1 || line > 1_000_000)) {
    fail('INVALID_EDGE', 'edge evidence line must be a bounded positive integer or null');
  }
  return {
    from: value.from,
    to: value.to,
    kind: value.kind,
    status: value.status,
    evidence: { path, line, matchedKey },
  };
}

function dedupeEdges(edges) {
  const seen = new Set();
  const result = [];
  for (const edge of edges) {
    const identity = `${edge.from}\0${edge.to}\0${edge.kind}\0${edge.evidence.path}\0${edge.evidence.line ?? 0}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(edge);
  }
  result.sort((left, right) => compareAscii(left.from, right.from)
    || compareAscii(left.to, right.to)
    || compareAscii(left.kind, right.kind)
    || compareAscii(left.evidence.path, right.evidence.path)
    || (left.evidence.line ?? 0) - (right.evidence.line ?? 0));
  return result;
}

function edgeId(edge) {
  return `edg-${hashOf([
    edge.from, edge.to, edge.kind, edge.evidence.path, String(edge.evidence.line ?? 0),
  ]).slice(0, 24)}`;
}

/**
 * Build the deterministic deep-frozen data model.
 *
 * Edge resolution policy: relation edge candidates become edges only when both
 * endpoints resolve to exactly one declared observed entity (or migration alias)
 * in the same scan and their evidence matchedKey references a persisted record.
 * Zero or multiple candidates stay `unresolved`/`ambiguous` diagnostics.
 *
 * @param {object} input - `{ records, edges, diagnostics, searchSpace,
 *   measurement }`. `records` are candidate records produced by the extractor;
 *   `edges` are unresolved relation/migration edge candidates; `searchSpace` is
 *   the T202-compatible search-space object from `readArtifacts`; `measurement`
 *   carries `{ filesInspected, bytesInspected, recordsInspected }` used when no
 *   search space is supplied.
 * @returns {object} The deep-frozen model:
 *   `{ summary, records, edges, diagnostics, searchSpace }` where `records`
 *   are grouped by category under `stores`, `schemas`, `entities`, `fields`,
 *   `keys`, `relations`, `caches`, `queues`, `migrations`.
 * @throws {DataModelError} on malformed candidates, categories, edge kinds, or
 *   search spaces; privacy violations are downgraded to diagnostics and never
 *   abort.
 */
export function buildDataModel({ records = [], edges = [], diagnostics = [], searchSpace = null, measurement = {} } = {}) {
  const candidates = (Array.isArray(records) ? records : []).map(normalizeCandidate);
  const normalized = normalizeRecords(candidates);

  const diagnosticRecords = (Array.isArray(diagnostics) ? diagnostics : []).map(normalizeDiagnostic);
  const { records: privacySafe, diagnostics: uniqueDiagnostics } = privacyFilter(
    normalized,
    diagnosticRecords,
  );

  privacySafe.sort((left, right) => compareAscii(left.matchedKey, right.matchedKey)
    || compareAscii(left.source.path, right.source.path)
    || (left.source.line ?? 0) - (right.source.line ?? 0));

  const entityCounts = new Map();
  const migrationsByPath = new Map();
  const migrationsByAlias = new Map();
  const recordsByMatchedKey = new Set();
  for (const record of privacySafe) {
    recordsByMatchedKey.add(record.matchedKey);
    if (record.category === 'entity' && record.status === 'observed') {
      entityCounts.set(record.signature, (entityCounts.get(record.signature) ?? 0) + 1);
    }
    if (record.category === 'migration') {
      const byPath = migrationsByPath.get(record.source.path) ?? 0;
      migrationsByPath.set(record.source.path, byPath + 1);
      if (record.details.alias !== null) {
        const byAlias = migrationsByAlias.get(record.details.alias) ?? 0;
        migrationsByAlias.set(record.details.alias, byAlias + 1);
      }
    }
  }

  const edgeCandidates = (Array.isArray(edges) ? edges : []).map(normalizeEdgeCandidate);
  const resolvedRelation = resolveRelationEdgeCandidates(
    edgeCandidates.filter((entry) => !entry.migration),
    entityCounts,
    recordsByMatchedKey,
  );
  const resolvedMigration = resolveMigrationEdgeCandidates(
    edgeCandidates.filter((entry) => entry.migration),
    migrationsByPath,
    migrationsByAlias,
    recordsByMatchedKey,
  );
  const allEdges = [...resolvedRelation.edges, ...resolvedMigration.edges];
  const edgeDiagnostics = [...resolvedRelation.diagnostics, ...resolvedMigration.diagnostics];

  const { edges: privacySafeEdges, diagnostics: edgePrivacyDiagnostics } = privacyFilterEdges(
    allEdges,
    edgeDiagnostics,
  );
  const uniqueEdges = dedupeEdges(privacySafeEdges.map(normalizeEdge).map((edge) => ({
    ...edge,
    id: edgeId(edge),
  })));

  const space = searchSpace ?? normalizeEmptySearchSpace(measurement);

  const grouped = Object.fromEntries(DATA_RECORD_CATEGORIES.map((entry) => [entry, []]));
  for (const record of privacySafe) grouped[record.category].push(record);
  const counts = Object.fromEntries(
    DATA_RECORD_CATEGORIES.map((entry) => [entry, grouped[entry].length]),
  );

  const allDiagnostics = [...uniqueDiagnostics, ...edgePrivacyDiagnostics]
    .sort((left, right) => compareAscii(left.path, right.path)
      || compareAscii(left.status, right.status)
      || compareAscii(left.reason, right.reason)
      || (left.line ?? 0) - (right.line ?? 0));

  const capped = {
    stores: counts.store > DATA_LIMITS.stores,
    schemas: counts.schema > DATA_LIMITS.schemas,
    entities: counts.entity > DATA_LIMITS.entities,
    fields: counts.field > DATA_LIMITS.fields,
    keys: counts.key > DATA_LIMITS.keys,
    relations: counts.relation > DATA_LIMITS.relations,
    caches: counts.cache > DATA_LIMITS.caches,
    queues: counts.queue > DATA_LIMITS.queues,
    migrations: counts.migration > DATA_LIMITS.migrations,
    edges: uniqueEdges.length > DATA_LIMITS.edges,
    files: space.capped,
    records: space.recordsInspected >= space.recordLimit,
  };
  exactKeys(capped, CAP_KEYS, 'capped');

  const summary = {
    stores: counts.store,
    schemas: counts.schema,
    entities: counts.entity,
    fields: counts.field,
    keys: counts.key,
    relations: counts.relation,
    caches: counts.cache,
    queues: counts.queue,
    migrations: counts.migration,
    edges: uniqueEdges.length,
    diagnostics: allDiagnostics.length,
    filesInspected: space.filesInspected,
    bytesInspected: space.bytesInspected,
    recordsInspected: space.recordsInspected,
    capped,
  };

  return deepFreeze({
    summary,
    stores: grouped.store,
    schemas: grouped.schema,
    entities: grouped.entity,
    fields: grouped.field,
    keys: grouped.key,
    relations: grouped.relation,
    caches: grouped.cache,
    queues: grouped.queue,
    migrations: grouped.migration,
    edges: uniqueEdges,
    diagnostics: allDiagnostics,
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
    fileLimit: DATA_LIMITS.maxFiles,
    bytesInspected: measurement.bytesInspected ?? 0,
    byteLimit: DATA_LIMITS.maxBytes,
    recordsInspected: measurement.recordsInspected ?? 0,
    recordLimit: DATA_LIMITS.maxRecords,
    omittedCount: 0,
  });
}
