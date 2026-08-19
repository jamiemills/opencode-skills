// Governance & Ownership dimension — output model and pure parsing helpers.
//
// T215 owns this module. It defines the deterministic, privacy-safe,
// deep-frozen governance model produced by the governance scanner and consumed
// by the inert governance renderer and the T210-compatible governance provider
// (`lib/scan/providers/governance.mjs`). Nothing in the pipeline, CLI, enrich,
// validate, write, or existing-ten renderer consumes it yet; activation happens
// at T224.
//
// Privacy contract (T206): identities never survive the model. Raw CODEOWNERS
// owner handles and emails are consumed only by `createOpaqueOwnerSummary` and
// become report-local `Owner-###` labels plus aggregate counts. Field names
// avoid the T206 sensitive vocabulary (`owner(s)`, `codeowners`, `identity`,
// `name`, `email`, `token`, ...). Patterns are normalized to a repo-relative
// display form (no leading `/`) so records pass `assertPrivacySafe`; dates and
// statuses are reported as declared facts, never as verdicts.
//
// Scope discipline: this dimension inventories declarations and explicit
// links. It never queries remote organization APIs and never infers ownership
// from commits.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none).
//
// Source-policy note (T201): this module imports only contracts and the shared
// privacy primitive; it never touches node:fs / node:child_process /
// node:process / node:vm / node:module.

import {
  assertDataOnly,
  compareAscii,
  deepFreeze,
  normalizeEvidencePath,
} from '../../contracts/evidence.mjs';
import {
  assertPrivacySafe,
  createOpaqueOwnerSummary,
  redactText,
  sanitizeUrl,
} from '../../shared/privacy.mjs';
import { ARTIFACT_LIMITS } from '../../shared/artifacts.mjs';
import { defaultOwners } from './codeowners.mjs';

export const GOVERNANCE_DIMENSION_ID = 'DIM-governance-v1';

export const GOVERNANCE_CATEGORIES = Object.freeze([
  'contribution',
  'decision',
  'funding',
  'ownership',
  'policy',
  'reference',
  'release',
  'review',
  'runbook',
  'support',
]);

export const GOVERNANCE_STATUSES = Object.freeze(['observed', 'unverified', 'unsupported']);

export const GOVERNANCE_DIALECTS = Object.freeze([
  'adr',
  'changelog',
  'code-of-conduct',
  'codeowners',
  'contributing',
  'funding',
  'governance',
  'issue-template',
  'link',
  'pr-template',
  'release',
  'runbook',
  'security-policy',
  'support',
]);

export const GOVERNANCE_LIMITS = deepFreeze({
  maxArtifacts: 256,
  maxAssignments: 4096,
  maxBytes: ARTIFACT_LIMITS.maxBytes,
  maxDepth: ARTIFACT_LIMITS.maxDepth,
  maxDiagnostics: 256,
  maxEntries: 512,
  maxFiles: ARTIFACT_LIMITS.maxFiles,
  maxLinkUrl: 400,
  maxLinks: 512,
  maxLinksPerFile: 64,
  maxOwners: 256,
  maxPatterns: 512,
  maxRecords: ARTIFACT_LIMITS.maxRecords,
  maxRules: 512,
});

const ENTRY_KEYS = Object.freeze(['category', 'details', 'dialect', 'matchedKey', 'path', 'source', 'status']);
const SOURCE_KEYS = Object.freeze(['line', 'path']);
const ARTIFACT_KEYS = Object.freeze(['category', 'details', 'dialect', 'line', 'path', 'status']);
const DIAGNOSTIC_KEYS = Object.freeze(['line', 'path', 'reason', 'status']);
const SIMPLE_DETAILS_KEYS = Object.freeze(['kind']);
const ADR_DETAILS_KEYS = Object.freeze(['date', 'id', 'kind', 'status']);
const REFERENCE_DETAILS_KEYS = Object.freeze(['kind', 'url']);
const OWNERSHIP_DETAILS_KEYS = Object.freeze(['defaultLabels', 'kind', 'malformedLines', 'patterns']);
const RULE_KEYS = Object.freeze(['anchored', 'labels', 'line', 'path', 'pattern']);
const ASSIGNEE_KEYS = Object.freeze(['count', 'label']);

const TOKEN_PATTERN = /^[\x21-\x7e]+$/;
const STATUS_TOKEN = /^[A-Za-z][A-Za-z0-9-]{0,47}$/;
const REASON_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/;

export class GovernanceModelError extends TypeError {
  constructor(code, message) {
    super(`Invalid governance model: ${message}`);
    this.name = 'GovernanceModelError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new GovernanceModelError(code, message);
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

function token(value, label, maximum = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || !TOKEN_PATTERN.test(value)) {
    fail('INVALID_DETAILS', `${label} must be a bounded printable ASCII token`);
  }
  return value;
}

function nullableToken(value, label, maximum = 256) {
  if (value === null) return null;
  return token(value, label, maximum);
}

function status(value) {
  if (typeof value !== 'string' || !GOVERNANCE_STATUSES.includes(value)) {
    fail('INVALID_STATUS', 'entry status must be observed, unverified, or unsupported');
  }
  return value;
}

function category(value) {
  if (typeof value !== 'string' || !GOVERNANCE_CATEGORIES.includes(value)) {
    fail('UNKNOWN_CATEGORY', 'entry category is not allowlisted for the governance dimension');
  }
  return value;
}

function dialect(value) {
  if (typeof value !== 'string' || !GOVERNANCE_DIALECTS.includes(value)) {
    fail('UNKNOWN_DIALECT', 'entry dialect is not allowlisted for the governance dimension');
  }
  return value;
}

function normalizedPath(value) {
  try {
    return normalizeEvidencePath(value);
  } catch {
    fail('INVALID_PATH', 'entry path must be a normalized repository-relative POSIX path');
  }
}

function boundedLine(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    fail('INVALID_SOURCE', 'source line must be a bounded positive integer or null');
  }
  return value;
}

function boundedCount(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail('BOUND_EXCEEDED', `${label} is outside the explicit bound`);
  }
  return value;
}

function reason(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || !REASON_PATTERN.test(value)) {
    fail('INVALID_REASON', 'diagnostic reason must be a bounded uppercase token');
  }
  return value;
}

function normalizeDiagnostic(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', 'diagnostic must be an object');
  }
  exactKeys(value, DIAGNOSTIC_KEYS, 'diagnostic');
  if (!['unverified', 'unsupported'].includes(value.status)) {
    fail('INVALID_STATUS', 'diagnostic status must be unverified or unsupported');
  }
  return {
    path: normalizedPath(value.path),
    status: value.status,
    reason: reason(value.reason),
    line: boundedLine(value.line),
  };
}

function simpleDetails(value) {
  plainObject(value, 'details');
  exactKeys(value, SIMPLE_DETAILS_KEYS, 'details');
  return { kind: token(value.kind, 'details.kind') };
}

function adrDetails(value) {
  plainObject(value, 'details');
  exactKeys(value, ADR_DETAILS_KEYS, 'details');
  const id = value.id === null ? null : token(value.id, 'details.id', 16);
  if (id !== null && !ID_PATTERN.test(id)) fail('INVALID_DETAILS', 'ADR id must be a bounded stable token');
  const date = value.date === null ? null : token(value.date, 'details.date', 16);
  if (date !== null && !DATE_PATTERN.test(date)) fail('INVALID_DETAILS', 'ADR date must be YYYY-MM-DD or null');
  return {
    kind: token(value.kind, 'details.kind'),
    id,
    date,
    status: nullableToken(value.status, 'details.status', 48),
  };
}

function referenceDetails(value) {
  plainObject(value, 'details');
  exactKeys(value, REFERENCE_DETAILS_KEYS, 'details');
  const url = token(value.url, 'details.url', 512);
  if (!/^https?:\/\//.test(url)) fail('INVALID_DETAILS', 'reference url must be an absolute http(s) URL');
  return { kind: token(value.kind, 'details.kind'), url };
}

function normalizeDetails(categoryName, value) {
  if (value === null) return null;
  if (categoryName === 'decision') return adrDetails(value);
  if (categoryName === 'reference') return referenceDetails(value);
  return simpleDetails(value);
}

const ARTIFACT_DATA_LIMITS = Object.freeze({
  maxArray: 64,
  maxDepth: 4,
  maxNodes: 256,
  maxObjectKeys: 8,
  maxString: 512,
});

function normalizeArtifactShape(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', 'governance artifact must be an object');
  }
  exactKeys(value, ARTIFACT_KEYS, 'governance artifact');
  const categoryName = category(value.category);
  if (categoryName === 'ownership') fail('UNKNOWN_CATEGORY', 'ownership entries are derived from parsed CODEOWNERS');
  return {
    category: categoryName,
    dialect: dialect(value.dialect),
    path: normalizedPath(value.path),
    line: boundedLine(value.line),
    status: status(value.status),
    details: value.details,
  };
}

function artifactDiagnosticPath(artifact) {
  if (typeof artifact?.path === 'string' && artifact.path.length > 0 && artifact.path.length <= 255) {
    try {
      return normalizeEvidencePath(artifact.path);
    } catch {
      // fall through to the safe placeholder
    }
  }
  return 'UNKNOWN';
}

function artifactDiagnostic(artifact, reason) {
  return {
    path: artifactDiagnosticPath(artifact),
    line: Number.isSafeInteger(artifact?.line) && artifact.line >= 1 ? artifact.line : null,
    status: 'unverified',
    reason,
  };
}

function entryFor(artifact, matchedKey) {
  return {
    category: artifact.category,
    dialect: artifact.dialect,
    matchedKey,
    path: artifact.path,
    status: artifact.status,
    details: artifact.details,
    source: { path: artifact.path, line: artifact.line },
  };
}

function privacyFilter(entries) {
  const kept = [];
  const diagnostics = [];
  for (const entry of entries) {
    try {
      assertPrivacySafe(entry);
      kept.push(entry);
    } catch {
      diagnostics.push({
        path: redactText(entry.path),
        status: 'unverified',
        reason: 'PRIVACY',
        line: entry.source.line,
      });
    }
  }
  return { kept, diagnostics };
}

function ownershipDetails(parsed, labelMap) {
  return {
    kind: 'codeowners',
    patterns: Math.min(parsed.patterns, GOVERNANCE_LIMITS.maxPatterns),
    malformedLines: Math.min(parsed.malformedLines, GOVERNANCE_LIMITS.maxRules),
    defaultLabels: defaultOwners(parsed.rules).map((identity) => labelMap.get(identity)).filter(Boolean),
  };
}

function buildOwnershipSection(ownershipRecords) {
  const allRules = [];
  for (const file of ownershipRecords) {
    for (const rule of file.rules) {
      allRules.push({ path: file.path, pattern: rule.pattern, anchored: rule.anchored, owners: rule.owners, line: rule.line });
    }
  }
  allRules.sort((left, right) => compareAscii(left.path, right.path)
    || (left.line ?? 0) - (right.line ?? 0));

  const retainedRules = [];
  let assignments = 0;
  for (const rule of allRules) {
    if (retainedRules.length >= GOVERNANCE_LIMITS.maxRules) break;
    if (assignments + rule.owners.length > GOVERNANCE_LIMITS.maxAssignments) break;
    retainedRules.push(rule);
    assignments += rule.owners.length;
  }
  const rulesCapped = allRules.length > retainedRules.length;

  const rawAssignments = retainedRules.flatMap((rule) => rule.owners);
  const summary = createOpaqueOwnerSummary(rawAssignments);
  const distinct = [...new Set(rawAssignments)].sort(compareAscii);
  const labelMap = new Map();
  for (let index = 0; index < summary.owners.length; index++) {
    labelMap.set(distinct[index], summary.owners[index].label);
  }

  const rules = retainedRules.map((rule) => deepFreeze({
    path: rule.path,
    pattern: rule.pattern,
    anchored: rule.anchored,
    line: rule.line,
    labels: rule.owners.map((identity) => labelMap.get(identity)).filter(Boolean),
  })).filter((rule) => {
    try {
      assertPrivacySafe(rule);
      return true;
    } catch {
      return false;
    }
  });

  const assigneeCapped = summary.owners.length > GOVERNANCE_LIMITS.maxOwners;
  const assignees = summary.owners.slice(0, GOVERNANCE_LIMITS.maxOwners)
    .map((entry) => deepFreeze({ label: entry.label, count: boundedCount(entry.count, GOVERNANCE_LIMITS.maxAssignments, 'count') }));

  return {
    files: ownershipRecords.length,
    patterns: retainedRules.length,
    rules,
    assignees,
    assigneeCount: summary.totalIdentities,
    assignmentCount: summary.totalAssignments,
    rulesCapped,
    assigneeCapped,
    labelMap,
  };
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
    fileLimit: GOVERNANCE_LIMITS.maxFiles,
    bytesInspected: measurement.bytesInspected ?? 0,
    byteLimit: GOVERNANCE_LIMITS.maxBytes,
    recordsInspected: measurement.recordsInspected ?? 0,
    recordLimit: GOVERNANCE_LIMITS.maxRecords,
    omittedCount: 0,
  });
}

function capList(records, maximum) {
  const capped = records.length > maximum;
  return { records: records.slice(0, maximum), capped };
}

function uniqueDiagnostics(diagnostics) {
  const unique = [];
  const seen = new Set();
  for (const diagnostic of [...diagnostics].sort((left, right) => compareAscii(left.path, right.path)
    || compareAscii(left.status, right.status)
    || compareAscii(left.reason, right.reason)
    || (left.line ?? 0) - (right.line ?? 0))) {
    const key = `${diagnostic.path}\0${diagnostic.status}\0${diagnostic.reason}\0${diagnostic.line ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(deepFreeze(diagnostic));
  }
  return unique;
}

/**
 * Build the deterministic deep-frozen governance model.
 *
 * @param {object} input - `{ artifacts, ownership, diagnostics, searchSpace,
 *   measurement, isGit, defaultBranch }`. `artifacts` are raw non-ownership
 *   records produced by the scanner; `ownership` are parsed CODEOWNERS results
 *   (`{ path, rules, diagnostics, malformedLines }`); `diagnostics` are raw
 *   artifact-level diagnostics; `searchSpace` is the T202-compatible read
 *   search space.
 * @returns {object} The deep-frozen governance model.
 * @throws {GovernanceModelError} on malformed structural input. Structural
 *   schema violations (unknown category/dialect/status, non-normalized paths)
 *   stay typed errors; data-shape violations (for example an over-long link URL
 *   tripping STRING_LIMIT), per-artifact detail normalization failures (for
 *   example a multi-word ADR status), and privacy violations are downgraded to
 *   diagnostics and never abort the dimension.
 */
export function buildGovernanceModel({
  artifacts = [],
  ownership = [],
  diagnostics = [],
  searchSpace = null,
  measurement = {},
  isGit = false,
  defaultBranch = null,
} = {}) {
  if (!Array.isArray(artifacts)) fail('INVALID_TYPE', 'governance artifacts must be an array');
  if (!Array.isArray(ownership)) fail('INVALID_TYPE', 'governance ownership must be an array');
  if (!Array.isArray(diagnostics)) fail('INVALID_TYPE', 'governance diagnostics must be an array');
  if (typeof isGit !== 'boolean') fail('INVALID_TYPE', 'isGit must be boolean');
  if (defaultBranch !== null && (typeof defaultBranch !== 'string'
      || defaultBranch.length === 0 || defaultBranch.length > 96
      || defaultBranch.includes('\0') || /[^\x21-\x7e]/.test(defaultBranch))) {
    fail('INVALID_DETAILS', 'defaultBranch must be a bounded printable token or null');
  }

  const normalized = [];
  const artifactDiagnostics = [];
  for (const artifact of artifacts) {
    try {
      assertDataOnly(artifact, GovernanceModelError, ARTIFACT_DATA_LIMITS);
    } catch (error) {
      if (error instanceof GovernanceModelError) {
        artifactDiagnostics.push(artifactDiagnostic(
          artifact,
          error.code === 'STRING_LIMIT' ? 'STRING_LIMIT' : 'MALFORMED',
        ));
        continue;
      }
      throw error;
    }
    const shape = normalizeArtifactShape(artifact);
    try {
      shape.details = normalizeDetails(shape.category, shape.details);
      normalized.push(shape);
    } catch (error) {
      if (error instanceof GovernanceModelError) {
        artifactDiagnostics.push(artifactDiagnostic(artifact, 'MALFORMED'));
      } else {
        throw error;
      }
    }
  }
  const ownershipRecords = ownership.map((file) => {
    if (file === null || typeof file !== 'object' || Array.isArray(file)) {
      fail('INVALID_TYPE', 'ownership file must be an object');
    }
    if (typeof file.path !== 'string' || typeof file.rules !== 'object' || !Array.isArray(file.rules)) {
      fail('INVALID_TYPE', 'ownership file requires a path and a rules array');
    }
    return {
      path: normalizedPath(file.path),
      rules: file.rules,
      diagnostics: Array.isArray(file.diagnostics) ? file.diagnostics : [],
      malformedLines: Number.isSafeInteger(file.malformedLines) ? file.malformedLines : 0,
      patterns: Array.isArray(file.rules) ? file.rules.length : 0,
    };
  });

  const space = searchSpace ?? normalizeEmptySearchSpace(measurement);

  const rawEntries = [];
  for (const artifact of normalized) {
    if (artifact.category === 'reference' && artifact.details !== null
        && artifact.details.kind === 'link') {
      rawEntries.push(entryFor(artifact, `reference:${artifact.path}:${artifact.line ?? 0}:${artifact.details.url}`));
      continue;
    }
    rawEntries.push(entryFor(artifact, `${artifact.category}:${artifact.path}`));
  }

  const ownershipSection = buildOwnershipSection(ownershipRecords);
  for (const file of ownershipRecords) {
    rawEntries.push({
      category: 'ownership',
      dialect: 'codeowners',
      matchedKey: `ownership:${file.path}`,
      path: file.path,
      status: 'observed',
      details: ownershipDetails(file, ownershipSection.labelMap),
      source: { path: file.path, line: null },
    });
  }
  const { kept: privacySafe, diagnostics: privacyDiagnostics } = privacyFilter(rawEntries);

  const unique = [];
  const seen = new Set();
  for (const entry of privacySafe.sort((left, right) => compareAscii(left.matchedKey, right.matchedKey)
    || compareAscii(left.source.path, right.source.path)
    || (left.source.line ?? 0) - (right.source.line ?? 0))) {
    const key = `${entry.matchedKey}\0${entry.source.path}\0${entry.source.line ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(deepFreeze(entry));
  }

  const { records: entries, capped: entriesCapped } = capList(unique, GOVERNANCE_LIMITS.maxEntries);
  const linkCount = unique.filter((entry) => entry.category === 'reference').length;

  const codeownersDiagnostics = [];
  for (const file of ownershipRecords) {
    for (const entry of file.diagnostics ?? []) {
      try {
        codeownersDiagnostics.push(normalizeDiagnostic({ ...entry, path: file.path }));
      } catch {
        // skip malformed internal diagnostics; they never erase valid evidence
      }
    }
  }
  const rawDiagnostics = [
    ...diagnostics.map(normalizeDiagnostic),
    ...codeownersDiagnostics,
    ...artifactDiagnostics.map(normalizeDiagnostic),
    ...privacyDiagnostics.map(normalizeDiagnostic),
  ];
  const { records: modelDiagnostics, capped: diagnosticsCapped } = capList(
    uniqueDiagnostics(rawDiagnostics),
    GOVERNANCE_LIMITS.maxDiagnostics,
  );

  const byCategory = Object.fromEntries(GOVERNANCE_CATEGORIES.map((name) => [name, 0]));
  for (const entry of entries) byCategory[entry.category]++;

  const rulesCapped = ownershipSection.rulesCapped;
  const assigneeCapped = ownershipSection.assigneeCapped;

  const capped = {
    entries: entriesCapped,
    rules: rulesCapped,
    assignees: assigneeCapped,
    links: linkCount > GOVERNANCE_LIMITS.maxLinks,
    files: space.capped,
    diagnostics: diagnosticsCapped,
  };

  const summary = {
    entries: entries.length,
    byCategory,
    patterns: ownershipSection.patterns,
    assigneeCount: ownershipSection.assigneeCount,
    assignmentCount: ownershipSection.assignmentCount,
    filesInspected: space.filesInspected,
    bytesInspected: space.bytesInspected,
    recordsInspected: space.recordsInspected,
    isGit,
    defaultBranch,
    diagnostics: modelDiagnostics.length,
    capped,
  };

  const model = {
    summary,
    entries,
    ownership: {
      files: ownershipSection.files,
      patterns: ownershipSection.patterns,
      rules: ownershipSection.rules,
      assignees: ownershipSection.assignees,
      assigneeCount: ownershipSection.assigneeCount,
      assignmentCount: ownershipSection.assignmentCount,
    },
    diagnostics: modelDiagnostics,
    searchSpace: space,
  };

  assertPrivacySafe(model);
  return deepFreeze(model);
}

/**
 * Percent-encode every character that is outside the provider matched-key
 * token alphabet so observations pass the T210 provider foundation.
 * @param {string} value - the stable matched key to encode.
 * @returns {string} an encoded token safe for `matchedKey`.
 */
export function encodeMatchedKey(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    fail('INVALID_MATCHED_KEY', 'matchedKey must be a bounded non-empty string');
  }
  const safe = /[A-Za-z0-9._:/#@+%()[\],-]/;
  let out = '';
  for (const ch of value) {
    if (safe.test(ch)) {
      out += ch;
      continue;
    }
    const codepoint = ch.codePointAt(0);
    if (codepoint < 0x80) {
      out += `%${codepoint.toString(16).toUpperCase().padStart(2, '0')}`;
    } else {
      for (const byte of Buffer.from(ch, 'utf8')) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Path classification and document parsing (pure helpers used by the scanner)
// ---------------------------------------------------------------------------

const EXACT_PATHS = new Map([
  ['.github/codeowners', { category: 'ownership', dialect: 'codeowners', parse: 'codeowners' }],
  ['codeowners', { category: 'ownership', dialect: 'codeowners', parse: 'codeowners' }],
  ['docs/codeowners', { category: 'ownership', dialect: 'codeowners', parse: 'codeowners' }],
  ['.github/code_of_conduct.md', { category: 'policy', dialect: 'code-of-conduct', parse: 'links' }],
  ['code_of_conduct.md', { category: 'policy', dialect: 'code-of-conduct', parse: 'links' }],
  ['docs/code_of_conduct.md', { category: 'policy', dialect: 'code-of-conduct', parse: 'links' }],
  ['.github/security.md', { category: 'policy', dialect: 'security-policy', parse: 'links' }],
  ['security.md', { category: 'policy', dialect: 'security-policy', parse: 'links' }],
  ['docs/security.md', { category: 'policy', dialect: 'security-policy', parse: 'links' }],
  ['.github/governance.md', { category: 'policy', dialect: 'governance', parse: 'links' }],
  ['governance.md', { category: 'policy', dialect: 'governance', parse: 'links' }],
  ['docs/governance.md', { category: 'policy', dialect: 'governance', parse: 'links' }],
  ['.github/contributing.md', { category: 'contribution', dialect: 'contributing', parse: 'links' }],
  ['contributing.md', { category: 'contribution', dialect: 'contributing', parse: 'links' }],
  ['docs/contributing.md', { category: 'contribution', dialect: 'contributing', parse: 'links' }],
  ['.github/contributing', { category: 'contribution', dialect: 'contributing', parse: 'links' }],
  ['contributing', { category: 'contribution', dialect: 'contributing', parse: 'links' }],
  ['.github/pull_request_template.md', { category: 'review', dialect: 'pr-template', parse: null }],
  ['.github/pull_request_template.txt', { category: 'review', dialect: 'pr-template', parse: null }],
  ['docs/pull_request_template.md', { category: 'review', dialect: 'pr-template', parse: null }],
  ['.github/issue_template.md', { category: 'review', dialect: 'issue-template', parse: null }],
  ['.github/issue_template.txt', { category: 'review', dialect: 'issue-template', parse: null }],
  ['releasing.md', { category: 'release', dialect: 'release', parse: 'links' }],
  ['release.md', { category: 'release', dialect: 'release', parse: 'links' }],
  ['changelog.md', { category: 'release', dialect: 'changelog', parse: 'links' }],
  ['support.md', { category: 'support', dialect: 'support', parse: 'links' }],
  ['.github/support.md', { category: 'support', dialect: 'support', parse: 'links' }],
  ['docs/support.md', { category: 'support', dialect: 'support', parse: 'links' }],
  ['funding.yml', { category: 'funding', dialect: 'funding', parse: null }],
  ['.github/funding.yml', { category: 'funding', dialect: 'funding', parse: null }],
]);

// Known hidden governance paths. `rg --files` never emits hidden `.github`
// entries, so the scanner statically checks these with read-only filesystem
// probes (mirroring `deep/git.mjs` and `deep/operations.mjs`) and reads any
// that exist through the bounded T206 reader.
export const GOVERNANCE_HIDDEN_PATHS = Object.freeze([
  '.github/CODEOWNERS',
  '.github/CODE_OF_CONDUCT.md',
  '.github/SECURITY.md',
  '.github/GOVERNANCE.md',
  '.github/CONTRIBUTING.md',
  '.github/CONTRIBUTING',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/PULL_REQUEST_TEMPLATE.txt',
  '.github/ISSUE_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE.txt',
  '.github/SUPPORT.md',
  '.github/FUNDING.yml',
]);

export const GOVERNANCE_ISSUE_TEMPLATE_DIRS = Object.freeze(['.github/ISSUE_TEMPLATE']);

/**
 * Classify a repository-relative path as a governance artifact.
 * @param {string} path - a repository-relative path.
 * @returns {{ category: string, dialect: string, parse: string | null } | null}
 *   `parse` is `codeowners`, `adr`, `links`, or null for inventory-only files.
 */
export function classifyGovernancePath(path) {
  if (typeof path !== 'string' || path.length === 0) return null;
  const lower = path.toLowerCase();
  const exact = EXACT_PATHS.get(lower);
  if (exact !== undefined) return exact;
  if (lower.startsWith('.github/issue_template/')) {
    return { category: 'review', dialect: 'issue-template', parse: null };
  }
  if (lower.endsWith('.md')
      && (/\/architecture\/decisions\//.test(lower) || /\/adr\//.test(lower)
        || lower.startsWith('adr/') || lower.startsWith('decisions/'))) {
    return { category: 'decision', dialect: 'adr', parse: 'adr' };
  }
  const segments = lower.split('/');
  const base = segments[segments.length - 1] ?? '';
  if (/^runbooks?\.md$/.test(base) || segments.slice(0, -1).some((segment) => segment === 'runbook' || segment === 'runbooks')) {
    if (base.endsWith('.md')) return { category: 'runbook', dialect: 'runbook', parse: 'links' };
    return null;
  }
  return null;
}

function boundedAdrId(value) {
  const cleaned = String(value).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 16);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Extract declared ADR metadata (id, date, status) from a document header.
 * Titles are intentionally omitted so free-form prose can never trip the
 * privacy gate; dates and statuses are reported as declared facts. Statuses
 * are bounded to safe single printable tokens (multi-word statuses such as
 * "Under Review" are dropped rather than risking a privacy or model failure).
 * @param {string} text - the ADR document text.
 * @param {string} path - the repository-relative path (used for the id).
 * @returns {{ id: string | null, date: string | null, status: string | null, line: number | null }}
 */
export function parseAdrMetadata(text, path) {
  const lines = (typeof text === 'string' ? text : '').split(/\r?\n/).slice(0, 60);
  let heading = null;
  let headingLine = null;
  let date = null;
  let status = null;
  let statusBlock = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (heading === null && /^#/.test(line)) {
      heading = line;
      headingLine = index + 1;
    }
    if (/^##\s*Status\s*$/.test(line.trim())) {
      statusBlock = true;
      continue;
    }
    if (statusBlock && status === null && line.trim() && !/^#/.test(line)) {
      const candidate = line.trim();
      if (STATUS_TOKEN.test(candidate)) status = candidate;
      statusBlock = false;
      continue;
    }
    if (statusBlock && /^#/.test(line)) statusBlock = false;
    const dateMatch = line.match(/^\s*Date\s*:\s*(\d{4}-\d{2}-\d{2})\s*$/);
    if (dateMatch) date = dateMatch[1];
    const statusMatch = line.match(/^\s*Status\s*:\s*([A-Za-z][A-Za-z0-9-]{0,47})\s*$/);
    if (statusMatch) status = statusMatch[1];
  }

  let id = null;
  const base = String(path).split('/').pop() ?? '';
  const fileId = base.match(/^(\d{3,4})[-_ ]/);
  if (fileId) id = boundedAdrId(fileId[1]);
  if (id === null && heading !== null) {
    const headingId = heading.match(/^#\s*(?:ADR\s*)?(\d{1,4})[.:]/i);
    if (headingId) id = boundedAdrId(headingId[1]);
  }
  return { id, date, status, line: headingLine };
}

const MARKDOWN_LINK = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
const AUTOLINK = /<https?:\/\/[^>\s]+>/g;

/**
 * Extract sanitized explicit https links from a governance document.
 * Unsafe or non-http(s) links are skipped; credentials never survive
 * `sanitizeUrl`. Links whose sanitized URL exceeds `GOVERNANCE_LIMITS.maxLinkUrl`
 * are skipped so a single over-long URL can never trip a model string limit or
 * inflate matched keys.
 * @param {string} text - the document text.
 * @param {string} _path - the repository-relative path (retained for a stable
 *   signature; the caller stamps paths onto entries).
 * @param {number} maxPerFile - per-file link bound.
 * @returns {{ links: Array<{ url: string, line: number }>, capped: boolean }}
 */
export function extractMarkdownLinks(text, _path, maxPerFile = GOVERNANCE_LIMITS.maxLinksPerFile) {
  const links = [];
  const seen = new Set();
  const lines = (typeof text === 'string' ? text : '').split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const matches = [...line.matchAll(MARKDOWN_LINK)].map((match) => match[1]);
    for (const url of [...line.matchAll(AUTOLINK)].map((match) => match[0].slice(1, -1))) matches.push(url);
    for (const url of matches) {
      if (links.length >= maxPerFile) return deepFreeze({ links, capped: true });
      let sanitized;
      try {
        sanitized = sanitizeUrl(url);
      } catch {
        continue;
      }
      if (sanitized.length > GOVERNANCE_LIMITS.maxLinkUrl) continue;
      const key = `${sanitized}:${lineIndex + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ url: sanitized, line: lineIndex + 1 });
    }
  }
  return deepFreeze({ links, capped: false });
}
