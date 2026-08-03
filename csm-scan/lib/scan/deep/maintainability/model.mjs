// Maintainability dimension — output model and pure detectors.
//
// T214 owns this module. It is the deterministic, privacy-safe, deep-frozen
// model produced by the maintainability scanner and consumed by the inert
// renderer and the T210-compatible provider
// (`lib/scan/providers/maintainability.mjs`). Nothing in the pipeline, CLI,
// enrich, validate, write, or existing-ten renderer consumes it yet;
// activation happens at T224.
//
// Guarantees:
//   - The measurement universe is disclosed: files/bytes/records inspected,
//     limits, omitted count, measured vs eligible source files, and excluded
//     unsupported languages.
//   - Generated/vendor boundaries come only from exact evidence (directory
//     markers, filename markers, and header comments) — never guessing.
//   - Branch points are a disclosed lexical keyword-token approximation, never
//     semantic branch counts and never a quality score.
//   - Duplicate spans are exact 50-token windows that were hashed, verified
//     and merged by `findDuplicateGroups`; no semantic clones are claimed.
//   - Records are validated against DIM-maintainability categories, bounded,
//     deterministically sorted, and deep-frozen. A record that fails the T206
//     privacy gate is converted into an `unverified` PRIVACY diagnostic and is
//     never persisted.
//   - `partialCoverage` is set whenever any cap, omission, or truncation
//     occurred, so the renderer can avoid repository-wide conclusions.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only contracts and the
// shared privacy primitive; it never touches node:fs / node:child_process /
// node:process / node:vm / node:module, so the recurring capability gate
// remains closed.

import { compareAscii, deepFreeze, normalizeEvidencePath } from '../../contracts/evidence.mjs';
import { assertPrivacySafe, redactText } from '../../shared/privacy.mjs';
import { BRANCH_CATEGORIES, DIALECTS } from './tokenizer.mjs';

export const MAINTAINABILITY_DIMENSION_ID = 'DIM-maintainability-v1';

// Sentinel used to disclose files with no extension (for example `Makefile`,
// `LICENSE`, `CHANGELOG`) inside the excluded-language table. The extension
// charset below requires a leading dot, so the sentinel is validated explicitly
// rather than pretending extensionless files have an extension.
export const NO_EXTENSION_LABEL = 'no-extension';

// Sentinel used to disclose extensions that cannot be safely disclosed inside
// the excluded-language table: editor/backup suffixes outside the disclosed
// charset (for example `src/a.js~`, `src/b.bak~`) and non-ASCII extensions
// (for example `src/doc.日本語`). The scanner maps any extension that fails
// `isValidExcludedExtension` to this label at the scanner boundary, so an
// unusual filename can never abort the dimension or leak a raw label.
export const OTHER_EXTENSION_LABEL = 'other';

const EXCLUDED_EXTENSION_PATTERN = /^\.[A-Za-z0-9_+-]+$/;

/**
 * Decide whether an extension can be disclosed verbatim in the
 * excluded-language table: a leading dot plus a bounded `[A-Za-z0-9_+-]`
 * suffix. This is the single validator shared by the model gate and the
 * scanner boundary sanitizer.
 * @param {unknown} extension - raw extension (including the leading dot).
 * @returns {boolean} true when the extension matches the disclosed charset
 *   within the bound.
 */
export function isValidExcludedExtension(extension) {
  return typeof extension === 'string'
    && extension.length > 0
    && extension.length <= 32
    && EXCLUDED_EXTENSION_PATTERN.test(extension);
}

export const MAINTAINABILITY_LIMITS = deepFreeze({
  diagnostics: 512,
  duplicateGroups: 256,
  excludedLanguages: 64,
  files: 256,
  generatedBoundaries: 512,
  maxBytes: 4 * 1024 * 1024,
  maxDepth: 12,
  maxRecords: 10_000,
  maxTokensPerFile: 16_000,
  maxWindows: 100_000,
  perFileDiagnostics: 32,
  spansPerGroup: 64,
  tokenLabel: 128,
  toolEvidence: 256,
});

export const SIZE_BUCKETS = Object.freeze([
  { label: 'lt_1k', limit: 1024 },
  { label: 'k1_10k', limit: 10_240 },
  { label: 'k10_100k', limit: 102_400 },
  { label: 'k100_1m', limit: 1_048_576 },
  { label: 'gt_1m', limit: Infinity },
]);

export function sizeBucketFor(bytes) {
  for (const bucket of SIZE_BUCKETS) {
    if (bytes < bucket.limit) return bucket.label;
  }
  return 'gt_1m';
}

const GENERATED_DIR_SEGMENTS = Object.freeze(['vendor', 'third_party', 'thirdparty', 'generated']);

const GENERATED_FILENAME_PATTERNS = Object.freeze([
  { re: /\.min\.(?:js|mjs|cjs|ts|jsx|tsx)$/, marker: 'minified-source' },
  { re: /\.pb\.(?:js|ts)$/, marker: 'protobuf-js' },
  { re: /_pb2(?:_grpc)?\.py$/, marker: 'protobuf-python' },
]);

const GENERATED_HEADER_PATTERNS = Object.freeze([
  { re: /code generated .* do not edit/i, marker: 'code-generated' },
  { re: /@generated\b/i, marker: 'at-generated' },
  { re: /auto[- ]?generated/i, marker: 'auto-generated' },
  { re: /generated (?:by|automatically|from)/i, marker: 'generated-by' },
  { re: /this (?:file|source) was generated/i, marker: 'generated-file' },
]);

const HEADER_LINE_LIMIT = 8;
const HEADER_MARKER_LIMIT = 96;

const TOOL_CONFIG_FILES = Object.freeze({
  eslint: [
    '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs',
    'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
    'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
  ],
  prettier: [
    '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs',
    '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.toml',
    'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs',
  ],
  biome: ['biome.json', 'biome.jsonc'],
  jscpd: ['jscpd.json', '.jscpd.json'],
  ruff: ['ruff.toml', '.ruff.toml'],
  flake8: ['.flake8'],
  pylint: ['.pylintrc', 'pylintrc'],
  mypy: ['mypy.ini', '.mypy.ini'],
  isort: ['.isort.cfg'],
  shellcheck: ['.shellcheckrc', 'shellcheckrc'],
  rustfmt: ['rustfmt.toml', '.rustfmt.toml'],
  clippy: ['clippy.toml', '.clippy.toml'],
  shfmt: ['.editorconfig'],
});

const PACKAGE_TOOL_KEYS = Object.freeze({
  eslintConfig: 'eslint',
  prettier: 'prettier',
  standard: 'standard',
  jshintConfig: 'jshint',
});

const PACKAGE_TOOL_PACKAGES = Object.freeze([
  'eslint', 'prettier', '@biomejs/biome', 'biome', 'jscpd', 'standard', 'jshint',
]);

const INI_TOOL_SECTIONS = Object.freeze([
  'ruff', 'black', 'isort', 'mypy', 'pylint', 'flake8', 'bandit',
  'pyright', 'deptry', 'vulture', 'pydocstyle',
]);

export const GENERATED_REASONS = Object.freeze([
  'dir_marker', 'filename_marker', 'header_comment',
]);

export const TOOL_EVIDENCE_KINDS = Object.freeze([
  'config', 'manifest', 'dependency',
]);

export class MaintainabilityModelError extends TypeError {
  constructor(code, message) {
    super(`Invalid maintainability model: ${message}`);
    this.name = 'MaintainabilityModelError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MaintainabilityModelError(code, message);
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

function normalizePath(value) {
  try {
    return normalizeEvidencePath(value);
  } catch {
    fail('INVALID_PATH', 'path must be a normalized repository-relative POSIX path');
  }
}

function boundedInteger(value, maximum, field, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > maximum) {
    fail('INVALID_RECORD', `${field} is outside the explicit bound`);
  }
  return value;
}

function optionalLine(value) {
  if (value === null) return null;
  return boundedInteger(value, 1_000_000, 'line', true);
}

function dialect(value) {
  if (typeof value !== 'string' || !DIALECTS.includes(value)) {
    fail('INVALID_DIALECT', 'dialect is not allowlisted');
  }
  return value;
}

function tokenLabel(value, field = 'token') {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAINTAINABILITY_LIMITS.tokenLabel
      || /[^\x20-\x7e]/.test(value)) {
    fail('INVALID_RECORD', `${field} must be bounded ASCII`);
  }
  return value;
}

function branchCounts(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', 'branch counts must be an object');
  }
  const expected = [...BRANCH_CATEGORIES].sort(compareAscii);
  exactKeys(value, expected, 'branch counts');
  const counts = {};
  for (const category of BRANCH_CATEGORIES) {
    counts[category] = boundedInteger(value[category], 1_000_000, `branch count ${category}`);
  }
  return deepFreeze(counts);
}

function normalizeFileMetric(value) {
  plainObject(value, 'file metric');
  exactKeys(value, ['bytes', 'dialect', 'lines', 'path', 'sizeBucket', 'tokens'], 'file metric');
  const result = {
    path: normalizePath(value.path),
    dialect: dialect(value.dialect),
    bytes: boundedInteger(value.bytes, MAINTAINABILITY_LIMITS.maxBytes, 'bytes'),
    lines: boundedInteger(value.lines, 1_000_000, 'lines'),
    tokens: boundedInteger(value.tokens, MAINTAINABILITY_LIMITS.maxTokensPerFile, 'tokens'),
    sizeBucket: value.sizeBucket,
  };
  if (typeof result.sizeBucket !== 'string' || !SIZE_BUCKETS.some((bucket) => bucket.label === result.sizeBucket)) {
    fail('INVALID_RECORD', 'sizeBucket is not allowlisted');
  }
  return deepFreeze(result);
}

function normalizeBranchPoint(value) {
  plainObject(value, 'branch point');
  exactKeys(value, ['capped', 'counts', 'dialect', 'path', 'tokens'], 'branch point');
  return deepFreeze({
    path: normalizePath(value.path),
    dialect: dialect(value.dialect),
    tokens: boundedInteger(value.tokens, MAINTAINABILITY_LIMITS.maxTokensPerFile, 'tokens'),
    counts: branchCounts(value.counts),
    capped: value.capped === true,
  });
}

function normalizeSpan(value) {
  plainObject(value, 'duplicate span');
  exactKeys(value, ['endLine', 'path', 'startLine', 'tokenCount'], 'duplicate span');
  return deepFreeze({
    path: normalizePath(value.path),
    startLine: boundedInteger(value.startLine, 1_000_000, 'startLine', true),
    endLine: boundedInteger(value.endLine, 1_000_000, 'endLine', true),
    tokenCount: boundedInteger(value.tokenCount, 1_000_000, 'tokenCount', true),
  });
}

function normalizeDuplicateGroup(value) {
  plainObject(value, 'duplicate group');
  exactKeys(value, ['id', 'spans', 'tokenCount'], 'duplicate group');
  if (typeof value.id !== 'string' || !/^duplicate-[a-z0-9-]+$/.test(value.id) || value.id.length > 48) {
    fail('INVALID_RECORD', 'duplicate group id is not a stable token');
  }
  if (!Array.isArray(value.spans) || value.spans.length === 0
      || value.spans.length > MAINTAINABILITY_LIMITS.spansPerGroup) {
    fail('BOUND_EXCEEDED', 'duplicate group spans exceed the declared cap');
  }
  const spans = value.spans.map(normalizeSpan);
  const identities = spans.map((span) => `${span.path}:${span.startLine}:${span.endLine}`);
  if (new Set(identities).size !== identities.length) fail('DUPLICATE_ID', 'duplicate group spans are not unique');
  const tokenCount = boundedInteger(value.tokenCount, 1_000_000, 'tokenCount', true);
  if (spans.some((span) => span.tokenCount < tokenCount)) {
    fail('INVALID_RECORD', 'group tokenCount must be the smallest span length');
  }
  return deepFreeze({ id: value.id, tokenCount, spans });
}

function normalizeGeneratedBoundary(value) {
  plainObject(value, 'generated boundary');
  exactKeys(value, ['line', 'marker', 'path', 'reason', 'source'], 'generated boundary');
  if (typeof value.reason !== 'string' || !GENERATED_REASONS.includes(value.reason)) {
    fail('INVALID_RECORD', 'generated boundary reason is not allowlisted');
  }
  return deepFreeze({
    path: normalizePath(value.path),
    reason: value.reason,
    marker: tokenLabel(value.marker, 'marker'),
    source: value.source === null ? null : tokenLabel(value.source, 'source'),
    line: optionalLine(value.line),
  });
}

function normalizeToolEvidence(value) {
  plainObject(value, 'tool evidence');
  exactKeys(value, ['file', 'kind', 'line', 'source', 'tool'], 'tool evidence');
  if (typeof value.tool !== 'string' || value.tool.length === 0 || value.tool.length > 48
      || /[^\x20-\x7e]/.test(value.tool)) {
    fail('INVALID_RECORD', 'tool name is not bounded ASCII');
  }
  if (typeof value.kind !== 'string' || !TOOL_EVIDENCE_KINDS.includes(value.kind)) {
    fail('INVALID_RECORD', 'tool evidence kind is not allowlisted');
  }
  return deepFreeze({
    tool: value.tool,
    kind: value.kind,
    file: normalizePath(value.file),
    line: boundedInteger(value.line, 1_000_000, 'line', true),
    source: value.source === null ? null : tokenLabel(value.source, 'source'),
  });
}

function normalizeDiagnostic(value) {
  plainObject(value, 'diagnostic');
  exactKeys(value, ['line', 'path', 'reason', 'status'], 'diagnostic');
  if (!['unsupported', 'unverified'].includes(value.status)) {
    fail('INVALID_STATUS', 'diagnostic status must be unsupported or unverified');
  }
  if (typeof value.reason !== 'string' || value.reason.length === 0 || value.reason.length > 64
      || !/^[A-Z][A-Z0-9_]*$/.test(value.reason)) {
    fail('INVALID_REASON', 'diagnostic reason must be a bounded uppercase token');
  }
  return deepFreeze({
    path: normalizePath(value.path),
    status: value.status,
    reason: value.reason,
    line: optionalLine(value.line),
  });
}

function normalizeExcludedLanguage(value) {
  plainObject(value, 'excluded language');
  exactKeys(value, ['count', 'extension'], 'excluded language');
  if (!isValidExcludedExtension(value.extension)
      && value.extension !== NO_EXTENSION_LABEL
      && value.extension !== OTHER_EXTENSION_LABEL) {
    fail('INVALID_RECORD', 'excluded language extension is invalid');
  }
  return deepFreeze({
    extension: value.extension,
    count: boundedInteger(value.count, 1_000_000, 'count'),
  });
}

function normalizeSizeDistribution(value) {
  plainObject(value, 'size distribution');
  exactKeys(value, ['bucket', 'count'], 'size distribution');
  if (!SIZE_BUCKETS.some((entry) => entry.label === value.bucket)) {
    fail('INVALID_RECORD', 'size distribution bucket is not allowlisted');
  }
  return deepFreeze({
    bucket: value.bucket,
    count: boundedInteger(value.count, 1_000_000, 'count'),
  });
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
        path: redactText(record.path ?? record.file ?? '.'),
        status: 'unverified',
        reason: 'PRIVACY',
        line: record.line ?? null,
      });
    }
  }
  const all = [...diagnostics, ...privacyDiagnostics];
  const unique = [];
  const seen = new Set();
  for (const entry of all.sort((left, right) => compareAscii(left.path, right.path)
    || compareAscii(left.status, right.status) || compareAscii(left.reason, right.reason)
    || (left.line ?? 0) - (right.line ?? 0))) {
    const key = `${entry.path}\0${entry.status}\0${entry.reason}\0${entry.line ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return { records: kept, diagnostics: unique };
}

function normalizeSearchInput(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_SEARCH_SPACE', 'searchSpace is required');
  }
  const required = [
    'ambiguous', 'byteLimit', 'bytesInspected', 'capped', 'complete', 'error',
    'fileLimit', 'filesInspected', 'malformed', 'omittedCount', 'readable',
    'recordLimit', 'recordsInspected', 'supported',
  ];
  exactKeys(value, required, 'search space');
  for (const key of ['ambiguous', 'capped', 'complete', 'error', 'malformed', 'readable', 'supported']) {
    if (typeof value[key] !== 'boolean') fail('INVALID_SEARCH_SPACE', 'search-space state must be boolean');
  }
  const result = {};
  for (const key of required) result[key] = value[key];
  return deepFreeze(result);
}

function totalBranchTokens(branchPoints) {
  let total = 0;
  for (const record of branchPoints) {
    for (const category of BRANCH_CATEGORIES) total += record.counts[category];
  }
  return total;
}

/**
 * Build the deterministic deep-frozen maintainability model.
 *
 * @param {object} input - raw scanner output:
 *   `{ files, branchPoints, duplicateGroups, duplicateCaps,
 *   generatedBoundaries, toolEvidence, measurement, sizeDistribution,
 *   diagnostics, searchSpace }`.
 * @returns {object} The deep-frozen model:
 *   `{ summary, files, branchPoints, duplicateGroups, generatedBoundaries,
 *   toolEvidence, measurementUniverse, sizeDistribution, diagnostics,
 *   searchSpace }`.
 * @throws {MaintainabilityModelError} on malformed records; privacy
 *   violations are downgraded to diagnostics and never abort.
 */
export function buildMaintainabilityModel({
  files = [],
  branchPoints = [],
  duplicateGroups = [],
  duplicateCaps = {},
  generatedBoundaries = [],
  toolEvidence = [],
  measurement = {},
  sizeDistribution = [],
  diagnostics = [],
  searchSpace = null,
} = {}) {
  if (!Array.isArray(files) || !Array.isArray(branchPoints) || !Array.isArray(duplicateGroups)
      || !Array.isArray(generatedBoundaries) || !Array.isArray(toolEvidence)
      || !Array.isArray(sizeDistribution) || !Array.isArray(diagnostics)) {
    fail('INVALID_TYPE', 'model inputs must be arrays');
  }

  const fileRecords = files.map(normalizeFileMetric);
  const branchRecords = branchPoints.map(normalizeBranchPoint);
  const groupRecords = duplicateGroups.map(normalizeDuplicateGroup);
  const boundaryRecords = generatedBoundaries.map(normalizeGeneratedBoundary);
  const toolRecords = toolEvidence.map(normalizeToolEvidence);
  const sizeRecords = sizeDistribution.map(normalizeSizeDistribution);
  const diagnosticRecords = diagnostics.map(normalizeDiagnostic);

  const space = normalizeSearchInput(searchSpace);

  const pathSet = new Set(fileRecords.map((record) => record.path));
  for (const record of branchRecords) {
    if (!pathSet.has(record.path)) fail('ORPHAN_RECORD', 'branch point has no measured file');
  }

  const { records: safeFiles, diagnostics: filePrivacyDiags } = privacyFilter(fileRecords, diagnosticRecords);
  const { records: safeBranch, diagnostics: branchPrivacyDiags } = privacyFilter(branchRecords, []);
  const { records: safeGroups, diagnostics: groupPrivacyDiags } = privacyFilter(groupRecords, []);
  const { records: safeBoundaries, diagnostics: boundaryPrivacyDiags } = privacyFilter(boundaryRecords, []);
  const { records: safeTools, diagnostics: toolPrivacyDiags } = privacyFilter(toolRecords, []);

  const allDiagnostics = [
    ...filePrivacyDiags,
    ...branchPrivacyDiags,
    ...groupPrivacyDiags,
    ...boundaryPrivacyDiags,
    ...toolPrivacyDiags,
  ];
  const seenDiagnostics = new Set();
  const uniqueDiagnostics = [];
  for (const entry of allDiagnostics.sort((left, right) => compareAscii(left.path, right.path)
    || compareAscii(left.status, right.status) || compareAscii(left.reason, right.reason)
    || (left.line ?? 0) - (right.line ?? 0))) {
    const key = `${entry.path}\0${entry.status}\0${entry.reason}\0${entry.line ?? 0}`;
    if (seenDiagnostics.has(key)) continue;
    seenDiagnostics.add(key);
    uniqueDiagnostics.push(entry);
  }

  safeFiles.sort((left, right) => compareAscii(left.path, right.path));
  safeBranch.sort((left, right) => compareAscii(left.path, right.path));
  safeGroups.sort((left, right) => compareAscii(left.id, right.id));
  safeBoundaries.sort((left, right) => compareAscii(left.path, right.path)
    || compareAscii(left.reason, right.reason) || (left.line ?? 0) - (right.line ?? 0));
  safeTools.sort((left, right) => compareAscii(left.tool, right.tool)
    || compareAscii(left.file, right.file));
  sizeRecords.sort((left, right) => compareAscii(left.bucket, right.bucket));

  const measured = new Map(fileRecords.map((record) => [record.path, record]));
  for (const record of safeFiles) measured.set(record.path, record);
  const measuredPaths = new Set(safeFiles.map((record) => record.path));

  const eligibleFiles = Number.isSafeInteger(measurement.eligibleFiles) ? measurement.eligibleFiles : safeFiles.length;
  const measuredFiles = safeFiles.length;
  const supportedDialects = [...new Set(safeFiles.map((record) => record.dialect))].sort(compareAscii);

  const excludedLanguages = (Array.isArray(measurement.excludedLanguages) ? measurement.excludedLanguages : [])
    .map(normalizeExcludedLanguage)
    .sort((left, right) => compareAscii(left.extension, right.extension));
  const excludedFiles = excludedLanguages.reduce((sum, entry) => sum + entry.count, 0);

  const filesInspected = Number.isSafeInteger(measurement.filesInspected) ? measurement.filesInspected
    : space?.filesInspected ?? safeFiles.length;
  const bytesInspected = Number.isSafeInteger(measurement.bytesInspected) ? measurement.bytesInspected
    : space?.bytesInspected ?? 0;
  const recordsInspected = Number.isSafeInteger(measurement.recordsInspected) ? measurement.recordsInspected
    : space?.recordsInspected ?? 0;
  const omittedCount = Number.isSafeInteger(measurement.omittedCount) ? measurement.omittedCount
    : space?.omittedCount ?? 0;
  const configFilesInspected = Number.isSafeInteger(measurement.configFilesInspected)
    ? measurement.configFilesInspected : 0;

  const tokens = safeFiles.reduce((sum, record) => sum + record.tokens, 0);
  const branchTotal = safeBranch.reduce((sum, record) => sum + totalBranchTokens([record]), 0);
  const duplicateSpans = safeGroups.reduce((sum, group) => sum + group.spans.length, 0);

  const cappedRead = space?.capped === true || omittedCount > 0;
  const cappedFiles = eligibleFiles > measuredFiles;
  const cappedTokens = safeFiles.some((record) => {
    const branch = safeBranch.find((entry) => entry.path === record.path);
    return branch?.capped === true;
  });
  const duplicateCapsNormalized = {
    windows: duplicateCaps.windows === true,
    groups: duplicateCaps.groups === true,
    spans: duplicateCaps.spans === true,
    blocks: duplicateCaps.blocks === true,
    occurrences: duplicateCaps.occurrences === true,
  };
  const capped = {
    read: cappedRead,
    files: cappedFiles,
    tokens: cappedTokens,
    windows: duplicateCapsNormalized.windows,
    groups: duplicateCapsNormalized.groups,
    spans: duplicateCapsNormalized.spans,
    blocks: duplicateCapsNormalized.blocks,
    occurrences: duplicateCapsNormalized.occurrences,
  };
  const partialCoverage = Object.values(capped).some(Boolean)
    || (space !== null && (!space.complete || space.error || space.malformed));

  const branchByPath = new Map(safeBranch.map((record) => [record.path, record]));

  const fileSummary = safeFiles.map((record) => {
    const branch = branchByPath.get(record.path);
    return {
      path: record.path,
      dialect: record.dialect,
      bytes: record.bytes,
      tokens: record.tokens,
      lines: record.lines,
      sizeBucket: record.sizeBucket,
      branchTokens: branch === undefined ? 0 : totalBranchTokens([branch]),
    };
  });

  const summary = {
    filesMeasured: measuredFiles,
    eligibleFiles,
    excludedFiles,
    tokens,
    branchPoints: branchTotal,
    duplicateGroups: safeGroups.length,
    duplicateSpans,
    generatedFiles: safeBoundaries.length,
    toolEvidence: safeTools.length,
    diagnostics: uniqueDiagnostics.length,
    filesInspected,
    bytesInspected,
    recordsInspected,
    partialCoverage,
    capped,
    dialects: supportedDialects,
    sizeDistribution: sizeRecords,
    files: fileSummary,
  };

  const measurementUniverse = {
    filesInspected,
    bytesInspected,
    recordsInspected,
    fileLimit: space?.fileLimit ?? MAINTAINABILITY_LIMITS.files,
    byteLimit: space?.byteLimit ?? MAINTAINABILITY_LIMITS.maxBytes,
    recordLimit: space?.recordLimit ?? MAINTAINABILITY_LIMITS.maxRecords,
    measuredFiles,
    eligibleFiles,
    omittedCount,
    configFilesInspected,
    supportedDialects,
    excludedLanguages,
    excludedFiles,
    sizeDistribution: sizeRecords,
    capped,
    partialCoverage,
  };

  return deepFreeze({
    summary,
    files: safeFiles,
    branchPoints: safeBranch,
    duplicateGroups: safeGroups,
    generatedBoundaries: safeBoundaries,
    toolEvidence: safeTools,
    measurementUniverse,
    sizeDistribution: sizeRecords,
    diagnostics: uniqueDiagnostics,
    searchSpace: space,
  });
}

// ---------------------------------------------------------------------------
// Generated / vendor boundary detection (exact evidence only)
// ---------------------------------------------------------------------------

/**
 * Classify a file as generated or vendored from exact path/header evidence.
 *
 * @param {string} path - repository-relative path.
 * @param {string} [text] - file content (used for header-comment markers).
 * @returns {object|null} `{ path, reason, marker, source, line }` or null
 *   when no exact marker is present.
 */
// A derived source fragment (matched header text or matched filename) may
// contain characters outside the model's disclosed ASCII charset. Disclose the
// fixed ASCII pattern marker instead of the raw fragment, so the model gate
// (`tokenLabel` -> INVALID_RECORD) can never abort the dimension and the raw
// text is never persisted.
function disclosedSource(source, marker) {
  return source.length > MAINTAINABILITY_LIMITS.tokenLabel || /[^\x20-\x7e]/.test(source) ? marker : source;
}

export function detectGeneratedBoundary(path, text = '') {
  const segments = path.split('/').filter(Boolean);
  for (const segment of segments.slice(0, -1)) {
    if (GENERATED_DIR_SEGMENTS.includes(segment)) {
      return {
        path,
        reason: 'dir_marker',
        marker: segment,
        source: disclosedSource(segment, segment),
        line: 1,
      };
    }
  }
  const base = path.slice(path.lastIndexOf('/') + 1);
  for (const pattern of GENERATED_FILENAME_PATTERNS) {
    if (pattern.re.test(base)) {
      return {
        path,
        reason: 'filename_marker',
        marker: pattern.marker,
        source: disclosedSource(base, pattern.marker),
        line: 1,
      };
    }
  }
  const lines = String(text ?? '').split(/\r?\n/);
  const header = lines.slice(0, HEADER_LINE_LIMIT).join('\n');
  for (const pattern of GENERATED_HEADER_PATTERNS) {
    const match = pattern.re.exec(header);
    if (match !== null) {
      const lineNumber = header.slice(0, match.index).split('\n').length;
      let source = match[0].replace(/\s+/g, ' ').trim();
      if (source.length > HEADER_MARKER_LIMIT) source = source.slice(0, HEADER_MARKER_LIMIT);
      return {
        path,
        reason: 'header_comment',
        marker: pattern.marker,
        source: disclosedSource(source, pattern.marker),
        line: lineNumber,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Declared tool evidence (declarations only)
// ---------------------------------------------------------------------------

function basenameOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function lineIndexOf(text, offset) {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index++) {
    if (text[index] === '\n') line++;
  }
  return line;
}

function contentTools(path, text, value, format) {
  const records = [];
  if (path === 'package.json' && format === 'json' && value !== null && typeof value === 'object') {
    for (const [key, tool] of Object.entries(PACKAGE_TOOL_KEYS)) {
      if (value[key] !== undefined) records.push({ tool, kind: 'manifest', line: 1, source: key });
    }
    for (const section of ['dependencies', 'devDependencies']) {
      const deps = value[section];
      if (deps === null || typeof deps !== 'object' || Array.isArray(deps)) continue;
      for (const name of Object.keys(deps)) {
        if (PACKAGE_TOOL_PACKAGES.includes(name)) {
          records.push({ tool: name === '@biomejs/biome' ? 'biome' : name === 'jshint' ? 'jshint' : name, kind: 'dependency', line: 1, source: name });
        }
      }
    }
    return records;
  }
  if (path === 'pyproject.toml' || path === 'setup.cfg' || path === 'tox.ini'
      || path === 'mypy.ini' || path === '.flake8' || path === '.pylintrc' || path === 'pylintrc') {
    const source = String(text ?? '');
    const pattern = /^\[(?:tool\.)?(ruff|black|isort|mypy|pylint|flake8|bandit|pyright|deptry|vulture|pydocstyle)\]/gm;
    for (const match of source.matchAll(pattern)) {
      records.push({
        tool: match[1],
        kind: 'manifest',
        line: lineIndexOf(source, match.index),
        source: match[0],
      });
    }
    return records;
  }
  if (path === 'Cargo.toml') {
    const source = String(text ?? '');
    const pattern = /^\[(?:workspace\.)?lints\]/gm;
    for (const match of source.matchAll(pattern)) {
      records.push({ tool: 'clippy', kind: 'manifest', line: lineIndexOf(source, match.index), source: 'lints' });
    }
    return records;
  }
  return records;
}

/**
 * Detect declared maintainability-tool evidence for one artifact.
 *
 * @param {object} input - `{ path, format, value, text }`.
 * @returns {object[]} `[{ tool, kind, file, line, source }]` records derived
 *   only from declarations (config-file presence and manifest sections/keys).
 */
export function detectToolEvidence({ path, format = 'text', value = null, text = '' }) {
  const base = basenameOf(path);
  const records = [];
  for (const [tool, files] of Object.entries(TOOL_CONFIG_FILES)) {
    if (files.includes(path)) {
      records.push({ tool, kind: 'config', file: path, line: 1, source: base });
    }
  }
  for (const record of contentTools(path, text, value, format)) {
    records.push({ ...record, file: path });
  }
  const unique = new Map();
  for (const record of records) {
    const key = `${record.tool}\0${record.kind}\0${record.file}\0${record.line}\0${record.source}`;
    if (!unique.has(key)) unique.set(key, record);
  }
  return [...unique.values()].sort((left, right) => compareAscii(left.tool, right.tool)
    || compareAscii(left.kind, right.kind) || compareAscii(left.file, right.file));
}

/**
 * Candidate tool-config paths that may be present in a repository.
 * @returns {string[]} sorted unique repository-relative candidate paths.
 */
export function toolConfigCandidatePaths() {
  const paths = new Set([
    'package.json',
    'pyproject.toml',
    'setup.cfg',
    'tox.ini',
    'Cargo.toml',
  ]);
  for (const files of Object.values(TOOL_CONFIG_FILES)) {
    for (const file of files) paths.add(file);
  }
  return [...paths].sort(compareAscii);
}
