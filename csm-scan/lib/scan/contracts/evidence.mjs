import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const EVIDENCE_SCHEMA_VERSION = 1;

export const DATA_LIMITS = Object.freeze({
  maxArray: 4096,
  maxDepth: 12,
  maxNodes: 4096,
  maxObjectKeys: 256,
  maxString: 512,
});

export const EVIDENCE_LIMITS = Object.freeze({
  count: 4096,
  files: 1_000_000,
  bytes: 1_099_511_627_776,
  records: 10_000_000,
  omitted: 10_000_000,
});

export const APPLICABILITY_FACT_FIELDS = Object.freeze([
  'artifact_kind',
  'ecosystem',
  'is_git',
  'language',
  'repository_kind',
]);

export const EVIDENCE_SOURCE_KINDS = Object.freeze([
  'artifact_metadata', 'config', 'container', 'contract', 'documentation',
  'file_metadata', 'git_metadata', 'infrastructure', 'lockfile', 'manifest',
  'migration', 'policy', 'repository_metadata', 'schema', 'search_result',
  'source', 'tool_result', 'version_file', 'workflow',
]);

export const DIMENSION_EVIDENCE_CATEGORIES = deepFreeze({
  'DIM-structure-v1': ['artifact', 'directory_structure', 'file_inventory'],
  'DIM-stack-v1': ['framework', 'language', 'package_manager', 'runtime'],
  'DIM-config-v1': ['configuration', 'editor', 'environment', 'format', 'lint'],
  'DIM-testing-v1': ['configuration', 'coverage', 'fixture', 'framework', 'test_directory', 'test_file'],
  'DIM-conventions-v1': ['comment', 'error_handling', 'file_naming', 'import_style', 'module_system'],
  'DIM-git-v1': ['history', 'repository_metadata'],
  'DIM-architecture-v1': ['coupling', 'design_pattern', 'dynamic_indicator', 'entry_point', 'graph', 'import_edge', 'module'],
  'DIM-documentation-v1': ['contributing', 'license', 'readme', 'reference'],
  'DIM-security-v1': ['authentication', 'authorization', 'dependency_lock', 'secret_pattern', 'security_tool', 'validation'],
  'DIM-operations-v1': ['container', 'deployment_declaration', 'health_check', 'monitoring', 'workflow'],
  'DIM-api-v1': ['cli_command', 'contract', 'event', 'public_export', 'route', 'rpc'],
  'DIM-data-v1': ['cache', 'entity', 'field', 'key', 'migration', 'queue', 'relation', 'schema', 'store'],
  'DIM-deployment-v1': ['image', 'resource', 'service', 'template_indicator', 'topology_edge'],
  'DIM-maintainability-v1': ['branch_point', 'dead_code', 'duplicate_span', 'file_metric', 'generated_boundary', 'measurement_universe', 'tool_result'],
  'DIM-governance-v1': ['contribution', 'decision', 'funding', 'ownership', 'policy', 'reference', 'release', 'review', 'runbook', 'support'],
  'DIM-assurance-v1': ['accessibility', 'attestation', 'configuration', 'license', 'lock', 'manifest', 'pin', 'sarif', 'sbom', 'source', 'standard', 'tool_result', 'vex'],
  'DIM-practices-v1': ['agent_workflow', 'automation', 'enforcement', 'methodology', 'quality_gate', 'ritual', 'style_guide'],
});

export const EVIDENCE_CATEGORIES = Object.freeze([
  ...new Set([
    'applicability',
    'search_space',
    ...Object.values(DIMENSION_EVIDENCE_CATEGORIES).flat(),
  ]),
].sort(compareAscii));

const EVIDENCE_KEYS = Object.freeze([
  'category', 'claimId', 'details', 'detectorId', 'id', 'locator', 'matchedKey',
  'path', 'sourceKind',
]);
const CREATE_KEYS = Object.freeze(EVIDENCE_KEYS.filter((key) => key !== 'id'));
const SEARCH_KEYS = Object.freeze([
  'ambiguous', 'byteLimit', 'bytesInspected', 'capped', 'complete', 'error',
  'fileLimit', 'filesInspected', 'malformed', 'omittedCount', 'readable',
  'recordLimit', 'recordsInspected', 'supported',
]);
const FACT_KEYS = Object.freeze(['field', 'present', 'value']);
const DETAILS_KEYS = Object.freeze(['facts']);
const CLAIM_ID_PATTERN = /^CLM-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;
const DETECTOR_ID_PATTERN = /^DET-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;
const EVIDENCE_ID_PATTERN = /^EVD-v1-[a-f0-9]{64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/;
const SAFE_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export class EvidenceContractError extends TypeError {
  constructor(code, message) {
    super(`Invalid evidence contract: ${message}`);
    this.name = 'EvidenceContractError';
    this.code = code;
  }
}

function fail(ErrorType, code, message) {
  throw new ErrorType(code, message);
}

export function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  const seen = new Set();
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === 'object') stack.push(child);
    }
    Object.freeze(current);
  }
  return value;
}

export function assertDataOnly(value, ErrorType = EvidenceContractError, limits = DATA_LIMITS) {
  const maximums = {
    maxArray: limits.maxArray ?? DATA_LIMITS.maxArray,
    maxDepth: limits.maxDepth ?? DATA_LIMITS.maxDepth,
    maxNodes: limits.maxNodes ?? DATA_LIMITS.maxNodes,
    maxObjectKeys: limits.maxObjectKeys ?? DATA_LIMITS.maxObjectKeys,
    maxString: limits.maxString ?? DATA_LIMITS.maxString,
  };
  const stack = [{ value, depth: 0, ancestors: new Set() }];
  let nodes = 0;

  while (stack.length > 0) {
    const item = stack.pop();
    if (++nodes > maximums.maxNodes) fail(ErrorType, 'NODE_LIMIT', 'input exceeds the data node limit');
    if (item.depth > maximums.maxDepth) fail(ErrorType, 'DEPTH_LIMIT', 'input exceeds the data depth limit');
    const current = item.value;
    if (typeof current === 'string') {
      if (current.length > maximums.maxString) fail(ErrorType, 'STRING_LIMIT', 'input exceeds the string limit');
      continue;
    }
    if (current === null || typeof current === 'boolean' || typeof current === 'number') continue;
    if (typeof current !== 'object') fail(ErrorType, 'DATA_ONLY', 'input must contain data only');
    if (types.isProxy(current)) fail(ErrorType, 'PROXY', 'proxy values are not allowed');
    if (item.ancestors.has(current)) fail(ErrorType, 'DATA_ONLY', 'input must be an acyclic data tree');

    const array = Array.isArray(current);
    let prototype;
    let symbols;
    let names;
    try {
      prototype = Object.getPrototypeOf(current);
    } catch {
      fail(ErrorType, 'REFLECTION', 'input could not be safely inspected');
    }
    if (array && current.length > maximums.maxArray) {
      fail(ErrorType, 'ARRAY_LIMIT', 'input exceeds the array limit');
    }
    if ((array && prototype !== Array.prototype)
        || (!array && prototype !== Object.prototype && prototype !== null)) {
      fail(ErrorType, 'DATA_ONLY', 'input must contain plain data only');
    }
    if (!array) {
      let enumerableKeys = 0;
      try {
        for (const key in current) {
          if (Object.hasOwn(current, key) && ++enumerableKeys > maximums.maxObjectKeys) break;
        }
      } catch {
        fail(ErrorType, 'REFLECTION', 'input could not be safely inspected');
      }
      if (enumerableKeys > maximums.maxObjectKeys) {
        fail(ErrorType, 'OBJECT_KEY_LIMIT', 'input exceeds the object key limit');
      }
    }
    try {
      symbols = Object.getOwnPropertySymbols(current);
      names = Object.getOwnPropertyNames(current);
    } catch {
      fail(ErrorType, 'REFLECTION', 'input could not be safely inspected');
    }
    if (symbols.length > 0) fail(ErrorType, 'DATA_ONLY', 'symbol fields are not allowed');
    if (array) {
      if (names.length !== current.length + 1 || !names.includes('length')) {
        fail(ErrorType, 'DATA_ONLY', 'arrays must be dense and contain only canonical indices');
      }
      for (let index = 0; index < current.length; index++) {
        if (!Object.hasOwn(current, String(index))) {
          fail(ErrorType, 'DATA_ONLY', 'arrays must be dense and contain only canonical indices');
        }
      }
    } else if (names.length > maximums.maxObjectKeys) {
      fail(ErrorType, 'OBJECT_KEY_LIMIT', 'input exceeds the object key limit');
    }
    const ancestors = new Set(item.ancestors);
    ancestors.add(current);
    for (const key of names) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key);
      } catch {
        fail(ErrorType, 'REFLECTION', 'input could not be safely inspected');
      }
      if (!Object.hasOwn(descriptor, 'value')) fail(ErrorType, 'DATA_ONLY', 'accessor fields are not allowed');
      if (array && key === 'length') continue;
      if (array && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= current.length
          || descriptor.enumerable !== true)) {
        fail(ErrorType, 'DATA_ONLY', 'arrays must be dense and contain only canonical indices');
      }
      if (!array && descriptor.enumerable !== true) fail(ErrorType, 'DATA_ONLY', 'hidden fields are not allowed');
      stack.push({ value: descriptor.value, depth: item.depth + 1, ancestors });
    }
  }
}

function exactKeys(value, expected, ErrorType = EvidenceContractError, label = 'value') {
  const keys = Object.keys(value).sort(compareAscii);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(ErrorType, 'UNKNOWN_FIELD', `${label} fields do not match the schema`);
  }
}

function stableId(value, pattern, field) {
  if (typeof value !== 'string' || value.length > 96 || !pattern.test(value)) {
    fail(EvidenceContractError, 'INVALID_ID', `${field} must be a stable versioned ASCII identifier`);
  }
  return value;
}

function stableToken(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !TOKEN_PATTERN.test(value)) {
    fail(EvidenceContractError, 'INVALID_TOKEN', `${field} must be bounded stable ASCII`);
  }
  return value;
}

function factValue(field, value) {
  if (field === 'is_git') {
    if (typeof value !== 'boolean') {
      fail(EvidenceContractError, 'INVALID_DETAILS', 'is_git fact value must be boolean');
    }
    return value;
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || !SAFE_VALUE_PATTERN.test(value)) {
    fail(EvidenceContractError, 'INVALID_DETAILS', `${field} must be a bounded safe scalar`);
  }
  return value;
}

function boundedInteger(value, maximum, field, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > maximum) {
    fail(EvidenceContractError, 'INVALID_SEARCH_SPACE', `${field} is outside the explicit search bound`);
  }
  return value;
}

export function normalizeSearchSpace(value) {
  assertDataOnly(value);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(EvidenceContractError, 'INVALID_SEARCH_SPACE', 'search-space details must be an object');
  }
  exactKeys(value, SEARCH_KEYS, EvidenceContractError, 'search-space');
  for (const key of ['ambiguous', 'capped', 'complete', 'error', 'malformed', 'readable', 'supported']) {
    if (typeof value[key] !== 'boolean') fail(EvidenceContractError, 'INVALID_SEARCH_SPACE', 'search-space state must be boolean');
  }
  const result = {
    supported: value.supported,
    readable: value.readable,
    complete: value.complete,
    capped: value.capped,
    error: value.error,
    malformed: value.malformed,
    ambiguous: value.ambiguous,
    filesInspected: boundedInteger(value.filesInspected, EVIDENCE_LIMITS.files, 'filesInspected'),
    fileLimit: boundedInteger(value.fileLimit, EVIDENCE_LIMITS.files, 'fileLimit', true),
    bytesInspected: boundedInteger(value.bytesInspected, EVIDENCE_LIMITS.bytes, 'bytesInspected'),
    byteLimit: boundedInteger(value.byteLimit, EVIDENCE_LIMITS.bytes, 'byteLimit', true),
    recordsInspected: boundedInteger(value.recordsInspected, EVIDENCE_LIMITS.records, 'recordsInspected'),
    recordLimit: boundedInteger(value.recordLimit, EVIDENCE_LIMITS.records, 'recordLimit', true),
    omittedCount: boundedInteger(value.omittedCount, EVIDENCE_LIMITS.omitted, 'omittedCount'),
  };
  if (result.filesInspected > result.fileLimit || result.bytesInspected > result.byteLimit
      || result.recordsInspected > result.recordLimit) {
    fail(EvidenceContractError, 'INVALID_SEARCH_SPACE', 'inspected counts must not exceed disclosed limits');
  }
  if (result.complete && (result.capped || result.error || result.malformed || result.ambiguous
      || !result.readable || result.omittedCount !== 0)) {
    fail(EvidenceContractError, 'INVALID_SEARCH_SPACE', 'complete search-space state is inconsistent');
  }
  if (result.omittedCount > 0 && !result.capped) {
    fail(EvidenceContractError, 'INVALID_SEARCH_SPACE', 'omitted records require a capped search');
  }
  return deepFreeze(result);
}

function normalizeApplicabilityDetails(value) {
  assertDataOnly(value);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(EvidenceContractError, 'INVALID_DETAILS', 'applicability details must be an object');
  }
  exactKeys(value, DETAILS_KEYS, EvidenceContractError, 'applicability details');
  if (!Array.isArray(value.facts) || value.facts.length === 0 || value.facts.length > 16) {
    fail(EvidenceContractError, 'INVALID_DETAILS', 'applicability facts must be a bounded non-empty array');
  }
  const facts = value.facts.map((fact) => {
    if (fact === null || typeof fact !== 'object' || Array.isArray(fact)) {
      fail(EvidenceContractError, 'INVALID_DETAILS', 'applicability fact must be an object');
    }
    exactKeys(fact, FACT_KEYS, EvidenceContractError, 'applicability fact');
    if (!APPLICABILITY_FACT_FIELDS.includes(fact.field) || typeof fact.present !== 'boolean') {
      fail(EvidenceContractError, 'INVALID_DETAILS', 'applicability fact is not allowlisted');
    }
    if (!fact.present && fact.value !== null) {
      fail(EvidenceContractError, 'INVALID_DETAILS', 'absent applicability fact must have null value');
    }
    return { field: fact.field, present: fact.present, value: fact.present ? factValue(fact.field, fact.value) : null };
  }).sort((left, right) => compareAscii(
    `${left.field}:${left.present}:${JSON.stringify(left.value)}`,
    `${right.field}:${right.present}:${JSON.stringify(right.value)}`,
  ));
  const identities = facts.map((fact) => JSON.stringify(fact));
  if (new Set(identities).size !== identities.length) {
    fail(EvidenceContractError, 'DUPLICATE_ID', 'applicability facts must be unique');
  }
  for (const field of APPLICABILITY_FACT_FIELDS) {
    const selected = facts.filter((fact) => fact.field === field);
    if (selected.some((fact) => !fact.present) && selected.some((fact) => fact.present)) {
      fail(EvidenceContractError, 'INVALID_DETAILS', 'applicability facts must not conflict');
    }
  }
  return deepFreeze({ facts });
}

function normalizeDetails(category, details) {
  if (category === 'search_space') return normalizeSearchSpace(details);
  if (category === 'applicability') return normalizeApplicabilityDetails(details);
  if (details !== null) fail(EvidenceContractError, 'INVALID_DETAILS', 'ordinary evidence details must be null');
  return null;
}

export function normalizeEvidencePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255
      || value.includes('\0') || value.includes('\\') || value.startsWith('/')
      || value.startsWith('//') || /^[A-Za-z]:/.test(value)
      || (value !== '.' && value.split('/').some((part) => part === '' || part === '.' || part === '..'))
      || /[^\x21-\x7e]/.test(value)) {
    fail(EvidenceContractError, 'INVALID_PATH', 'path must be a normalized POSIX repository-relative path');
  }
  return value;
}

function normalizeCore(fields) {
  const claimId = stableId(fields.claimId, CLAIM_ID_PATTERN, 'claimId');
  const detectorId = stableId(fields.detectorId, DETECTOR_ID_PATTERN, 'detectorId');
  if (!EVIDENCE_SOURCE_KINDS.includes(fields.sourceKind)) {
    fail(EvidenceContractError, 'UNKNOWN_SOURCE_KIND', 'sourceKind is not allowlisted');
  }
  if (!EVIDENCE_CATEGORIES.includes(fields.category)) {
    fail(EvidenceContractError, 'UNKNOWN_CATEGORY', 'category is not allowlisted');
  }
  if ((fields.category === 'search_space') !== (fields.sourceKind === 'search_result')) {
    fail(EvidenceContractError, 'INVALID_CATEGORY_SOURCE', 'search evidence category and source kind must agree');
  }
  return {
    claimId,
    detectorId,
    sourceKind: fields.sourceKind,
    category: fields.category,
    path: normalizeEvidencePath(fields.path),
    locator: stableToken(fields.locator, 'locator'),
    matchedKey: stableToken(fields.matchedKey, 'matchedKey'),
    details: normalizeDetails(fields.category, fields.details),
  };
}

function identityFor(core) {
  const parts = [
    core.claimId, core.detectorId, core.sourceKind, core.category, core.path,
    core.locator, core.matchedKey, JSON.stringify(core.details),
  ];
  const framed = parts.map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`).join('|');
  return `EVD-v1-${createHash('sha256').update(framed).digest('hex')}`;
}

export function createEvidenceId(fields) {
  assertDataOnly(fields);
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    fail(EvidenceContractError, 'INVALID_TYPE', 'evidence identity input must be an object');
  }
  exactKeys(fields, CREATE_KEYS, EvidenceContractError, 'evidence identity input');
  return identityFor(normalizeCore(fields));
}

export function validateEvidence(record) {
  assertDataOnly(record);
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    fail(EvidenceContractError, 'INVALID_TYPE', 'evidence must be an object');
  }
  exactKeys(record, EVIDENCE_KEYS, EvidenceContractError, 'evidence');
  const core = normalizeCore(record);
  const id = stableId(record.id, EVIDENCE_ID_PATTERN, 'id');
  if (id !== identityFor(core)) fail(EvidenceContractError, 'ID_MISMATCH', 'id does not match canonical evidence content');
  return deepFreeze({ id, ...core });
}

export function createEvidence(fields) {
  assertDataOnly(fields);
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    fail(EvidenceContractError, 'INVALID_TYPE', 'evidence input must be an object');
  }
  exactKeys(fields, CREATE_KEYS, EvidenceContractError, 'evidence input');
  const core = normalizeCore(fields);
  return deepFreeze({ id: identityFor(core), ...core });
}

export function validateEvidenceList(records) {
  if (types.isProxy(records)) fail(EvidenceContractError, 'PROXY', 'proxy values are not allowed');
  if (!Array.isArray(records) || records.length > EVIDENCE_LIMITS.count) {
    fail(EvidenceContractError, 'BOUND_EXCEEDED', 'evidence must be a bounded array');
  }
  assertDataOnly(records, EvidenceContractError, {
    ...DATA_LIMITS,
    maxArray: EVIDENCE_LIMITS.count,
    maxNodes: EVIDENCE_LIMITS.count * 32,
  });
  const result = records.map(validateEvidence);
  if (new Set(result.map(({ id }) => id)).size !== result.length) {
    fail(EvidenceContractError, 'DUPLICATE_ID', 'evidence contains a duplicate identifier');
  }
  return deepFreeze(result.sort((left, right) => compareAscii(left.id, right.id)));
}
