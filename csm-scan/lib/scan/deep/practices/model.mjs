// Development Practices dimension — output model and pure parsing helpers.
//
// T003 owns this module. It defines the deterministic, privacy-safe,
// deep-frozen practices model produced by the practices scanner
// (`lib/scan/deep/practices/scanner.mjs`) and consumed by the inert practices
// renderer (`lib/scan/render/practices.mjs`) and the T210-compatible provider
// adapter (`lib/scan/providers/practices.mjs`). Nothing in the pipeline, CLI,
// enrich, validate, write, or existing-ten renderer dispatches the scanner yet;
// activation happens at T224.
//
// Privacy contract (T206): raw configuration values, source excerpts, and
// repository content never survive the model. Entries carry only structured
// facts — a category, a deterministic matched key, a repo-relative path, a
// status, and optional bounded counts, kinds, and paths arrays. Quality-gate
// thresholds are parsed against a fixed key allowlist and only the allowlisted
// key name is retained, never its value. Field names avoid the T206 sensitive
// vocabulary (`token`, `owner`, `email`, ...).
//
// Scope discipline: this dimension inventories committed declarations and
// lexical signals only. It never executes tools, queries remote services, or
// measures team behaviour.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none).

import {
  compareAscii,
  deepFreeze,
  normalizeEvidencePath,
} from '../../contracts/evidence.mjs';
import { parseYamlShallow } from '../../shared/parse.mjs';
import { PRACTICE_TOOLS } from '../../shared/detection.mjs';
import { assertPrivacySafe, redactText } from '../../shared/privacy.mjs';
import { ARTIFACT_LIMITS } from '../../shared/artifacts.mjs';

export const PRACTICES_DIMENSION_ID = 'DIM-practices-v1';

export const PRACTICES_CATEGORIES = Object.freeze([
  'methodology',
  'enforcement',
  'automation',
  'ritual',
  'quality_gate',
  'agent_workflow',
  'style_guide',
]);

export const PRACTICES_STATUSES = Object.freeze(['observed', 'inferred', 'unverified']);

export const PRACTICES_LIMITS = deepFreeze({
  kind: 64,
  matchedKey: 512,
  maxBytes: ARTIFACT_LIMITS.maxBytes,
  maxCandidates: 4096,
  maxCount: 1_000_000,
  maxDepth: ARTIFACT_LIMITS.maxDepth,
  maxDiagnostics: 256,
  maxEntries: 512,
  maxFiles: ARTIFACT_LIMITS.maxFiles,
  maxKinds: 32,
  maxPaths: 64,
  maxRecords: ARTIFACT_LIMITS.maxRecords,
});

const ENTRY_REQUIRED_KEYS = Object.freeze(['category', 'matchedKey', 'path', 'status']);
const ENTRY_OPTIONAL_KEYS = Object.freeze(['count', 'kinds', 'paths']);
const ENTRY_KEYS = Object.freeze([...ENTRY_REQUIRED_KEYS, ...ENTRY_OPTIONAL_KEYS].sort(compareAscii));
const DIAGNOSTIC_KEYS = Object.freeze(['line', 'path', 'reason', 'status']);

const TOKEN_PATTERN = /^[\x21-\x7e]+$/;
const STATUS_TOKEN = /^[A-Za-z][A-Za-z0-9-]{0,47}$/;
const REASON_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export class PracticesModelError extends TypeError {
  constructor(code, message) {
    super(`Invalid practices model: ${message}`);
    this.name = 'PracticesModelError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PracticesModelError(code, message);
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
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || !TOKEN_PATTERN.test(value)) {
    fail('INVALID_DETAILS', `${label} must be a bounded printable ASCII token`);
  }
  return value;
}

function status(value) {
  if (typeof value !== 'string' || !PRACTICES_STATUSES.includes(value)) {
    fail('INVALID_STATUS', 'entry status must be observed, inferred, or unverified');
  }
  return value;
}

function category(value) {
  if (typeof value !== 'string' || !PRACTICES_CATEGORIES.includes(value)) {
    fail('UNKNOWN_CATEGORY', 'entry category is not allowlisted for the practices dimension');
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
  if (typeof value !== 'string' || value.length === 0 || value.length > 64
      || !REASON_PATTERN.test(value)) {
    fail('INVALID_REASON', 'diagnostic reason must be a bounded uppercase token');
  }
  return value;
}

function normalizeKinds(value) {
  if (!Array.isArray(value) || value.length > PRACTICES_LIMITS.maxKinds) {
    fail('BOUND_EXCEEDED', 'entry kinds exceed the declared cap');
  }
  const cleaned = [];
  const seen = new Set();
  for (const item of value) {
    const itemToken = token(item, 'entry kind', PRACTICES_LIMITS.kind);
    if (seen.has(itemToken)) continue;
    seen.add(itemToken);
    cleaned.push(itemToken);
  }
  return cleaned.sort(compareAscii);
}

function normalizePaths(value) {
  if (!Array.isArray(value) || value.length > PRACTICES_LIMITS.maxPaths) {
    fail('BOUND_EXCEEDED', 'entry paths exceed the declared cap');
  }
  const cleaned = [];
  const seen = new Set();
  for (const item of value) {
    const itemPath = normalizedPath(item);
    if (seen.has(itemPath)) continue;
    seen.add(itemPath);
    cleaned.push(itemPath);
  }
  return cleaned.sort(compareAscii);
}

function normalizeEntry(value) {
  plainObject(value, 'practice entry');
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!ENTRY_KEYS.includes(key)) fail('UNKNOWN_FIELD', 'entry carries an unknown field');
  }
  for (const key of ENTRY_REQUIRED_KEYS) {
    if (!keys.includes(key)) fail('INVALID_TYPE', `entry is missing the required field ${key}`);
  }
  const result = {
    category: category(value.category),
    matchedKey: token(value.matchedKey, 'matchedKey', PRACTICES_LIMITS.matchedKey),
    path: normalizedPath(value.path),
    status: status(value.status),
  };
  if (keys.includes('count')) result.count = boundedCount(value.count, PRACTICES_LIMITS.maxCount, 'count');
  if (keys.includes('kinds')) result.kinds = normalizeKinds(value.kinds);
  if (keys.includes('paths')) result.paths = normalizePaths(value.paths);
  return result;
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
        line: null,
      });
    }
  }
  return { kept, diagnostics };
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
    fileLimit: PRACTICES_LIMITS.maxFiles,
    bytesInspected: measurement.bytesInspected ?? 0,
    byteLimit: PRACTICES_LIMITS.maxBytes,
    recordsInspected: measurement.recordsInspected ?? 0,
    recordLimit: PRACTICES_LIMITS.maxRecords,
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
 * Build the deterministic deep-frozen practices model.
 *
 * @param {object} input - `{ entries, diagnostics, searchSpace, measurement,
 *   isGit, defaultBranch }`. `entries` are raw per-artifact practice records
 *   produced by the scanner; `diagnostics` are raw artifact-level diagnostics;
 *   `searchSpace` is the T202-compatible read search space.
 * @returns {object} The deep-frozen practices model
 *   `{ summary, entries, diagnostics, searchSpace }`.
 * @throws {PracticesModelError} on malformed structural input. Privacy
 *   violations and unparseable entries are downgraded to diagnostics and never
 *   abort the dimension.
 */
export function buildPracticesModel({
  entries = [],
  diagnostics = [],
  searchSpace = null,
  measurement = {},
  isGit = false,
  defaultBranch = null,
} = {}) {
  if (!Array.isArray(entries)) fail('INVALID_TYPE', 'practice entries must be an array');
  if (!Array.isArray(diagnostics)) fail('INVALID_TYPE', 'practice diagnostics must be an array');
  if (typeof isGit !== 'boolean') fail('INVALID_TYPE', 'isGit must be boolean');
  if (defaultBranch !== null && (typeof defaultBranch !== 'string'
      || defaultBranch.length === 0 || defaultBranch.length > 96
      || defaultBranch.includes('\0') || /[^\x21-\x7e]/.test(defaultBranch))) {
    fail('INVALID_DETAILS', 'defaultBranch must be a bounded printable token or null');
  }

  const normalized = entries.map(normalizeEntry);
  const { kept: privacySafe, diagnostics: privacyDiagnostics } = privacyFilter(normalized);

  const unique = [];
  const seen = new Set();
  for (const entry of privacySafe.sort((left, right) => compareAscii(left.matchedKey, right.matchedKey)
    || compareAscii(left.path, right.path))) {
    const key = `${entry.matchedKey}\0${entry.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(deepFreeze(entry));
  }
  const { records: modelEntries, capped: entriesCapped } = capList(unique, PRACTICES_LIMITS.maxEntries);

  const byCategory = Object.fromEntries(PRACTICES_CATEGORIES.map((name) => [name, 0]));
  for (const entry of modelEntries) byCategory[entry.category]++;

  const rawDiagnostics = [
    ...diagnostics.map(normalizeDiagnostic),
    ...privacyDiagnostics.map(normalizeDiagnostic),
  ];
  const { records: modelDiagnostics, capped: diagnosticsCapped } = capList(
    uniqueDiagnostics(rawDiagnostics),
    PRACTICES_LIMITS.maxDiagnostics,
  );

  const space = searchSpace ?? normalizeEmptySearchSpace(measurement);

  const capped = {
    entries: entriesCapped,
    files: space.capped,
    diagnostics: diagnosticsCapped,
  };

  const summary = {
    entries: modelEntries.length,
    byCategory,
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
    entries: modelEntries,
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
// Path and content classification (pure helpers used by the scanner)
// ---------------------------------------------------------------------------

const EXACT_PATHS = new Map([
  // methodology
  ['strategies.py', { category: 'methodology', kind: 'hypothesis-strategies' }],
  // enforcement
  ['commitlint.config.js', { category: 'enforcement', kind: 'commitlint' }],
  ['commitlint.config.cjs', { category: 'enforcement', kind: 'commitlint' }],
  ['commitlint.config.mjs', { category: 'enforcement', kind: 'commitlint' }],
  ['commitlint.config.ts', { category: 'enforcement', kind: 'commitlint' }],
  ['.commitlintrc', { category: 'enforcement', kind: 'commitlint' }],
  ['.commitlintrc.json', { category: 'enforcement', kind: 'commitlint' }],
  ['.commitlintrc.yml', { category: 'enforcement', kind: 'commitlint' }],
  ['.commitlintrc.yaml', { category: 'enforcement', kind: 'commitlint' }],
  ['.commitlintrc.js', { category: 'enforcement', kind: 'commitlint' }],
  ['.commitlintrc.cjs', { category: 'enforcement', kind: 'commitlint' }],
  ['.gitlint', { category: 'enforcement', kind: 'gitlint' }],
  ['lefthook.yml', { category: 'enforcement', kind: 'lefthook' }],
  ['lefthook.yaml', { category: 'enforcement', kind: 'lefthook' }],
  ['.lefthook.yml', { category: 'enforcement', kind: 'lefthook' }],
  ['.lefthook.yaml', { category: 'enforcement', kind: 'lefthook' }],
  ['.pre-commit-config.yaml', { category: 'enforcement', kind: 'pre-commit' }],
  ['.pre-commit-config.yml', { category: 'enforcement', kind: 'pre-commit' }],
  // automation
  ['.github/release-drafter.yml', { category: 'automation', kind: 'release-drafter' }],
  ['.github/release-drafter.yaml', { category: 'automation', kind: 'release-drafter' }],
  ['.releaserc.json', { category: 'automation', kind: 'semantic-release' }],
  ['.releaserc.yml', { category: 'automation', kind: 'semantic-release' }],
  ['.releaserc.yaml', { category: 'automation', kind: 'semantic-release' }],
  ['.releaserc.toml', { category: 'automation', kind: 'semantic-release' }],
  ['.releaserc.js', { category: 'automation', kind: 'semantic-release' }],
  ['.releaserc.cjs', { category: 'automation', kind: 'semantic-release' }],
  ['release.config.js', { category: 'automation', kind: 'semantic-release' }],
  ['release.config.cjs', { category: 'automation', kind: 'semantic-release' }],
  ['release-please-config.json', { category: 'automation', kind: 'release-please' }],
  ['.release-please-manifest.json', { category: 'automation', kind: 'release-please' }],
  ['dependabot.yml', { category: 'automation', kind: 'dependabot' }],
  ['.github/dependabot.yml', { category: 'automation', kind: 'dependabot' }],
  ['renovate.json', { category: 'automation', kind: 'renovate' }],
  ['renovate.json5', { category: 'automation', kind: 'renovate' }],
  ['mkdocs.yml', { category: 'automation', kind: 'mkdocs' }],
  ['mkdocs.yaml', { category: 'automation', kind: 'mkdocs' }],
  ['docs/mkdocs.yml', { category: 'automation', kind: 'mkdocs' }],
  ['docs/mkdocs.yaml', { category: 'automation', kind: 'mkdocs' }],
  ['docs/conf.py', { category: 'automation', kind: 'sphinx' }],
  ['docusaurus.config.js', { category: 'automation', kind: 'docusaurus' }],
  ['docusaurus.config.ts', { category: 'automation', kind: 'docusaurus' }],
  ['docusaurus.config.cjs', { category: 'automation', kind: 'docusaurus' }],
  ['website/docusaurus.config.js', { category: 'automation', kind: 'docusaurus' }],
  ['devcontainer.json', { category: 'automation', kind: 'devcontainer' }],
  ['.devcontainer/devcontainer.json', { category: 'automation', kind: 'devcontainer' }],
  ['mise.toml', { category: 'automation', kind: 'mise' }],
  ['.mise.toml', { category: 'automation', kind: 'mise' }],
  ['.config/mise.toml', { category: 'automation', kind: 'mise' }],
  ['.tool-versions', { category: 'automation', kind: 'asdf' }],
  ['flake.nix', { category: 'automation', kind: 'nix' }],
  ['shell.nix', { category: 'automation', kind: 'nix' }],
  ['default.nix', { category: 'automation', kind: 'nix' }],
  ['nix/shell.nix', { category: 'automation', kind: 'nix' }],
  // ritual
  ['.github/pull_request_template.md', { category: 'ritual', kind: 'pr-template' }],
  ['.github/pull_request_template.txt', { category: 'ritual', kind: 'pr-template' }],
  ['.github/issue_template.md', { category: 'ritual', kind: 'issue-template' }],
  ['.github/issue_template.txt', { category: 'ritual', kind: 'issue-template' }],
  ['.github/review-bot.yml', { category: 'ritual', kind: 'review-bot' }],
  ['.github/reviewers.yml', { category: 'ritual', kind: 'review-bot' }],
  ['.github/review.yml', { category: 'ritual', kind: 'review-bot' }],
  ['.github/auto-assign.yml', { category: 'ritual', kind: 'review-bot' }],
  ['.github/auto_assign.yml', { category: 'ritual', kind: 'review-bot' }],
  ['changelog.md', { category: 'ritual', kind: 'changelog' }],
  // quality gate
  ['quality/gates.conf', { category: 'quality_gate', kind: 'gates-conf' }],
  ['quality/gates.ini', { category: 'quality_gate', kind: 'gates-conf' }],
  ['.quality-gates.conf', { category: 'quality_gate', kind: 'gates-conf' }],
  ['.quality-gates.ini', { category: 'quality_gate', kind: 'gates-conf' }],
  ['.quality-gates.txt', { category: 'quality_gate', kind: 'gates-conf' }],
  ['.quality-gates', { category: 'quality_gate', kind: 'gates-conf' }],
  // agent workflow
  ['agents.md', { category: 'agent_workflow', kind: 'agents' }],
  ['.agents/agents.md', { category: 'agent_workflow', kind: 'agents' }],
  ['claude.md', { category: 'agent_workflow', kind: 'claude' }],
  ['.claude/claude.md', { category: 'agent_workflow', kind: 'claude' }],
  ['opencode.jsonc', { category: 'agent_workflow', kind: 'opencode' }],
  ['.opencode/opencode.jsonc', { category: 'agent_workflow', kind: 'opencode' }],
  // style guide
  ['ruff.toml', { category: 'style_guide', kind: 'ruff' }],
  ['.ruff.toml', { category: 'style_guide', kind: 'ruff' }],
  ['.prettierrc', { category: 'style_guide', kind: 'prettier' }],
  ['.prettierrc.json', { category: 'style_guide', kind: 'prettier' }],
  ['.prettierrc.yml', { category: 'style_guide', kind: 'prettier' }],
  ['.prettierrc.yaml', { category: 'style_guide', kind: 'prettier' }],
  ['.prettierrc.toml', { category: 'style_guide', kind: 'prettier' }],
  ['.prettierrc.js', { category: 'style_guide', kind: 'prettier' }],
  ['.prettierrc.cjs', { category: 'style_guide', kind: 'prettier' }],
  ['prettier.config.js', { category: 'style_guide', kind: 'prettier' }],
  ['prettier.config.cjs', { category: 'style_guide', kind: 'prettier' }],
  ['prettier.config.mjs', { category: 'style_guide', kind: 'prettier' }],
  ['rustfmt.toml', { category: 'style_guide', kind: 'rustfmt' }],
  ['.rustfmt.toml', { category: 'style_guide', kind: 'rustfmt' }],
]);

// Root hidden files that `rg --files` never emits; probed with `existsSync`.
export const PRACTICES_HIDDEN_FILES = Object.freeze([
  'AGENTS.md',
  'CLAUDE.md',
  'opencode.jsonc',
  '.gitlint',
  '.pre-commit-config.yaml',
  '.pre-commit-config.yml',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  '.prettierrc.toml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.ruff.toml',
  '.rustfmt.toml',
  '.mise.toml',
  '.tool-versions',
  '.lefthook.yml',
  '.lefthook.yaml',
  '.commitlintrc.json',
  '.commitlintrc.yml',
  '.commitlintrc.yaml',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
  '.releaserc.json',
  '.releaserc.yml',
  '.releaserc.yaml',
  '.releaserc.toml',
  '.releaserc.js',
  '.releaserc.cjs',
  '.quality-gates.conf',
  '.quality-gates.ini',
  '.quality-gates.txt',
]);

// Hidden directories that `rg --files` never emits; probed with `readdirSync`.
export const PRACTICES_HIDDEN_DIRS = Object.freeze([
  '.github',
  '.agents',
  '.opencode',
  '.claude',
  '.devcontainer',
]);

function isWorkflowPath(lower) {
  return lower.startsWith('.github/workflows/') && /\.(?:ya?ml)$/.test(lower);
}

function isTemplatePath(lower) {
  return lower === '.github/pull_request_template.md'
    || lower === '.github/pull_request_template.txt'
    || lower === '.github/issue_template.md'
    || lower === '.github/issue_template.txt'
    || lower.startsWith('.github/issue_template/');
}

function isManifestPath(lower) {
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  const names = new Set([
    'pyproject.toml', 'setup.py', 'setup.cfg', 'pipfile', 'requirements.txt',
    'requirements.in', 'package.json', 'cargo.toml', 'go.mod', 'gemfile',
  ]);
  if (names.has(base)) return true;
  return /^requirements[-.].*\.txt$/.test(base) || /^requirements.*\.in$/.test(base);
}

function isPlanPath(lower) {
  return (lower.includes('/plans/') || lower.startsWith('plans/')) && lower.endsWith('.md');
}

function isQualityGatesPath(lower) {
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  return lower === 'quality/gates.conf'
    || lower === 'quality/gates.ini'
    || /^\.quality-gates/.test(base);
}

function isRatchetPath(lower) {
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  if (!base.includes('ratchet')) return false;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return true;
  const extension = base.slice(dot + 1).toLowerCase();
  return ['sh', 'py', 'js', 'mjs', 'cjs', 'bash', 'zsh'].includes(extension);
}

function isDocPath(lower) {
  if (!lower.endsWith('.md')) return false;
  return lower === 'readme.md' || lower.startsWith('docs/') || lower.startsWith('doc/');
}

function isLefthookPath(base) {
  return base === 'lefthook.yml' || base === 'lefthook.yaml'
    || base === '.lefthook.yml' || base === '.lefthook.yaml';
}

function isPreCommitPath(base) {
  return base === '.pre-commit-config.yaml' || base === '.pre-commit-config.yml';
}

function hasRelevantExtension(lower) {
  const extensions = ['.md', '.yml', '.yaml', '.json', '.jsonc', '.mjs', '.cjs',
    '.js', '.toml', '.ini', '.cfg', '.conf', '.txt', '.feature'];
  return extensions.some((extension) => lower.endsWith(extension));
}

/**
 * Decide whether a repository-relative path should be read as a practice
 * candidate. Hidden directories are probed separately; this predicate covers
 * the `rg --files`-visible portion of the search.
 * @param {string} path - a repository-relative path.
 * @returns {boolean} true when the path is a plausible practice artifact.
 */
export function isCandidatePath(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  const lower = path.toLowerCase();
  if (classifyPracticePath(path) !== null) return true;
  if (isWorkflowPath(lower) || isTemplatePath(lower) || isManifestPath(lower)) return true;
  if (isQualityGatesPath(lower) || isPlanPath(lower) || isRatchetPath(lower)) return true;
  if (isDocPath(lower)) return true;
  if (lower.endsWith('.feature')) return true;
  if (lower === 'strategies.py' || lower.endsWith('/strategies.py')) return true;
  return lower.split('/').includes('fuzz_corpus');
}

/**
 * Decide whether a hidden-path probe (a file inside `.github`, `.agents`,
 * `.opencode`, `.claude`, or `.devcontainer`) should be read as a practice
 * candidate.
 * @param {string} path - a repository-relative path inside a hidden directory.
 * @returns {boolean} true when the hidden file is practice-relevant.
 */
export function isRelevantHiddenFile(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  const lower = path.toLowerCase();
  if (classifyPracticePath(path) !== null) return true;
  if (lower.startsWith('.github/')) return isWorkflowPath(lower) || isTemplatePath(lower);
  if (lower.startsWith('.agents/') || lower.startsWith('.opencode/')
      || lower.startsWith('.claude/') || lower.startsWith('.devcontainer/')) {
    return hasRelevantExtension(lower);
  }
  return false;
}

/**
 * Classify a repository-relative path as a practice artifact using exact path
 * and pattern matches. Content-derived signals are handled by the category
 * extractors instead.
 * @param {string} path - a repository-relative path.
 * @returns {{ category: string, kind: string } | null} the practice category
 *   and kind for the path, or null when the path is not a static artifact.
 */
export function classifyPracticePath(path) {
  if (typeof path !== 'string' || path.length === 0) return null;
  const lower = path.toLowerCase();
  const exact = EXACT_PATHS.get(lower);
  if (exact !== undefined) return exact;
  if (lower.endsWith('.feature')) return { category: 'methodology', kind: 'bdd-feature' };
  if (lower === 'strategies.py' || lower.endsWith('/strategies.py')) {
    return { category: 'methodology', kind: 'hypothesis-strategies' };
  }
  if (lower.split('/').includes('fuzz_corpus')) return { category: 'methodology', kind: 'fuzz-corpus' };
  if (lower.endsWith('.json') && lower.includes('baseline')) {
    return { category: 'quality_gate', kind: 'baseline' };
  }
  if (lower.startsWith('test/baselines/')) return { category: 'quality_gate', kind: 'baseline' };
  if (lower.startsWith('.agents/plans/')) {
    return { category: 'agent_workflow', kind: lower.endsWith('-csm.md') ? 'csm-plan' : 'plan' };
  }
  if (lower.startsWith('.agents/docs/')) return { category: 'agent_workflow', kind: 'agents-docs' };
  if (lower.startsWith('quality/remediation/')) return { category: 'agent_workflow', kind: 'remediation' };
  if (lower.startsWith('.opencode/')) return { category: 'agent_workflow', kind: 'opencode' };
  if (lower.startsWith('.claude/')) return { category: 'agent_workflow', kind: 'claude' };
  return null;
}

// ---------------------------------------------------------------------------
// Content-based category extractors (pure, never throw)
// ---------------------------------------------------------------------------

const METHODOLOGY_DEPS = Object.freeze([
  { key: 'behave', kind: 'behave' },
  { key: 'robotframework', kind: 'robot' },
  ...Object.keys(PRACTICE_TOOLS)
    .filter((key) => ['Mutation testing', 'Property-based testing', 'Fuzz testing']
      .includes(PRACTICE_TOOLS[key].type))
    .map((key) => ({ key, kind: key })),
]);

const TOOL_MUTMUT_SECTION = /^\s*\[tool\.mutmut\]\s*$/m;
const MUTATION_JOB_PATTERN = /\b(?:mutation|mutants?|stryker|pitest)\b/i;
const PROPERTY_MARKER_PATTERN = /@(?:given|settings|example|seed)\b/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordBoundary(value) {
  return new RegExp(`\\b${escapeRegExp(value)}\\b`, 'i');
}

function containsDependencyName(text, name) {
  return wordBoundary(name).test(String(text ?? ''));
}

/**
 * Extract methodology signals from one artifact's content: testing
 * dependencies in manifests, a `[tool.mutmut]` section, mutation-named CI
 * jobs, and property/fuzz markers inside hypothesis strategy files.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds?, status? }]` records.
 */
export function extractMethodology({ path, text = '' }) {
  const records = [];
  const lower = String(path).toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  if (isManifestPath(lower)) {
    const found = METHODOLOGY_DEPS.filter((entry) => containsDependencyName(text, entry.key))
      .map((entry) => entry.kind);
    if (found.length > 0) {
      records.push({ kind: 'test-deps', count: found.length, kinds: found });
    }
  }
  if (lower === 'pyproject.toml' && TOOL_MUTMUT_SECTION.test(String(text ?? ''))) {
    records.push({ kind: 'mutation-config' });
  }
  if (isWorkflowPath(lower)) {
    const matches = String(text ?? '').match(MUTATION_JOB_PATTERN) ?? [];
    if (matches.length > 0) {
      records.push({
        kind: 'mutation-ci',
        count: Math.min(matches.length, PRACTICES_LIMITS.maxCount),
        status: 'inferred',
      });
    }
  }
  if (base === 'strategies.py') {
    const markers = String(text ?? '').match(PROPERTY_MARKER_PATTERN) ?? [];
    if (markers.length > 0) {
      records.push({
        kind: 'property-markers',
        count: Math.min(markers.length, PRACTICES_LIMITS.maxCount),
        status: 'inferred',
      });
    }
  }
  return records;
}

const ENFORCEMENT_TOOLS = Object.freeze(
  Object.keys(PRACTICE_TOOLS)
    .filter((key) => ['Commit lint', 'Workflow lint', 'Hook runner'].includes(PRACTICE_TOOLS[key].type)),
);

function lefthookCommands(text) {
  let parsed;
  try {
    parsed = parseYamlShallow(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return [];
  const commands = [];
  const seen = new Set();
  for (const value of Object.values(parsed)) {
    if (value === null || typeof value !== 'object') continue;
    const commandList = value.commands;
    if (commandList === null || typeof commandList !== 'object') continue;
    const items = Array.isArray(commandList) ? commandList : Object.values(commandList);
    for (const command of items) {
      let raw = null;
      if (typeof command === 'string') raw = command;
      else if (command !== null && typeof command === 'object' && typeof command.run === 'string') raw = command.run;
      if (raw === null) continue;
      const first = raw.trim().split(/\s+/)[0] ?? '';
      const cleaned = first.replace(/[^A-Za-z0-9._-]/g, '').slice(0, PRACTICES_LIMITS.kind);
      if (cleaned.length > 0 && !seen.has(cleaned)) {
        seen.add(cleaned);
        commands.push(cleaned);
      }
    }
  }
  return commands.slice(0, PRACTICES_LIMITS.maxKinds);
}

function preCommitHookIds(text) {
  let parsed;
  try {
    parsed = parseYamlShallow(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return [];
  const ids = [];
  const seen = new Set();
  const repos = Array.isArray(parsed.repos) ? parsed.repos : [];
  for (const repo of repos) {
    if (repo === null || typeof repo !== 'object') continue;
    const hooks = Array.isArray(repo.hooks) ? repo.hooks : [];
    for (const hook of hooks) {
      if (hook === null || typeof hook !== 'object' || typeof hook.id !== 'string') continue;
      const cleaned = hook.id.replace(/[^A-Za-z0-9._-]/g, '').slice(0, PRACTICES_LIMITS.kind);
      if (cleaned.length > 0 && !seen.has(cleaned)) {
        seen.add(cleaned);
        ids.push(cleaned);
      }
    }
  }
  return ids.slice(0, PRACTICES_LIMITS.maxKinds);
}

/**
 * Extract enforcement signals from one artifact's content: workflow steps that
 * run enforcement tools, and the command lists declared by lefthook or
 * pre-commit hook configs.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds?, status? }]` records.
 */
export function extractEnforcement({ path, text = '' }) {
  const records = [];
  const lower = String(path).toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  if (isWorkflowPath(lower)) {
    const found = ENFORCEMENT_TOOLS.filter((tool) => wordBoundary(tool).test(String(text ?? '')));
    if (found.length > 0) {
      records.push({ kind: 'workflow-tool', count: found.length, kinds: found, status: 'inferred' });
    }
  }
  if (isLefthookPath(base)) {
    const commands = lefthookCommands(text);
    if (commands === null) {
      records.push({ kind: 'hook-config', status: 'unverified' });
    } else if (commands.length > 0) {
      records.push({ kind: 'hook-commands', count: commands.length, kinds: commands });
    }
  }
  if (isPreCommitPath(base)) {
    const ids = preCommitHookIds(text);
    if (ids === null) {
      records.push({ kind: 'hook-config', status: 'unverified' });
    } else if (ids.length > 0) {
      records.push({ kind: 'hook-commands', count: ids.length, kinds: ids });
    }
  }
  return records;
}

const PUBLISH_PATTERN = /\bpublish\b/i;

/**
 * Extract automation signals from one artifact's content: CI workflows that
 * publish artefacts.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, status? }]` records.
 */
export function extractAutomation({ path, text = '' }) {
  const records = [];
  const lower = String(path).toLowerCase();
  if (isWorkflowPath(lower)) {
    const matches = String(text ?? '').match(PUBLISH_PATTERN) ?? [];
    if (matches.length > 0) {
      records.push({ kind: 'publish-ci', count: Math.min(matches.length, PRACTICES_LIMITS.maxCount), status: 'inferred' });
    }
  }
  return records;
}

const TEMPLATE_HEADING_PATTERN = /^#{2,}\s*\S+/gm;
const TEMPLATE_REQUIRED_PATTERN = /\b(?:required|checklist|definition of done)\b/i;
const CHANGELOG_FORMAT_PATTERN = /##\s*\[unreleased\]|##\s*\[\d+\.\d+\.\d+\]\s*-\s*\d{4}-\d{2}-\d{2}/i;

function isChangelogPath(lower) {
  return lower === 'changelog.md' || lower.endsWith('/changelog.md');
}

function countTemplateSections(text) {
  const source = String(text ?? '');
  const headings = source.match(TEMPLATE_HEADING_PATTERN) ?? [];
  const required = source.match(TEMPLATE_REQUIRED_PATTERN) ?? [];
  return Math.min(headings.length + required.length, PRACTICES_LIMITS.maxCount);
}

/**
 * Extract ritual signals from one artifact's content: required-section PR and
 * issue templates, and keep-a-changelog formatted changelogs.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, status? }]` records.
 */
export function extractRitual({ path, text = '' }) {
  const records = [];
  const lower = String(path).toLowerCase();
  if (isTemplatePath(lower)) {
    const count = countTemplateSections(text);
    if (count > 0) records.push({ kind: 'template-sections', count, status: 'inferred' });
  }
  if (isChangelogPath(lower) && CHANGELOG_FORMAT_PATTERN.test(String(text ?? ''))) {
    records.push({ kind: 'changelog-format', status: 'inferred' });
  }
  return records;
}

const QUALITY_GATE_KEY_PATTERN = /^\s*([A-Za-z0-9_.-]+)\s*=\s*\S+/gm;
const QUALITY_GATE_ALLOWLIST = /^(?:mincoverage|minpassrate|mintests|maxcomplexity|maxlines|maxlinelength|maxskipped|maxtodos|maxbaseline|maxflaky|coveragethreshold|complexitythreshold|failthreshold)$/;

function parseQualityGateKeys(text) {
  const keys = [];
  const seen = new Set();
  const source = String(text ?? '');
  for (const match of source.matchAll(QUALITY_GATE_KEY_PATTERN)) {
    const normalized = match[1].toLowerCase().replace(/[_.-]/g, '');
    if (!QUALITY_GATE_ALLOWLIST.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    keys.push(normalized);
    if (keys.length >= PRACTICES_LIMITS.maxKinds) break;
  }
  return keys.sort(compareAscii);
}

/**
 * Extract quality-gate signals from one artifact's content: allowlisted
 * threshold keys from `quality/gates.conf` and `.quality-gates*` files, and
 * ratchet script presence. Raw key values are never retained.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds?, status? }]` records.
 */
export function extractQualityGate({ path, text = '' }) {
  const records = [];
  const lower = String(path).toLowerCase();
  if (isQualityGatesPath(lower)) {
    const keys = parseQualityGateKeys(text);
    if (keys.length > 0) records.push({ kind: 'gate-thresholds', count: keys.length, kinds: keys });
  }
  if (isRatchetPath(lower)) {
    records.push({ kind: 'ratchet-script', status: 'inferred' });
  }
  return records;
}

const PLAN_HEADERS = Object.freeze(['control', 'status']);

function planHeaders(text) {
  const source = String(text ?? '');
  return PLAN_HEADERS.filter((header) => {
    const pattern = new RegExp(`^#{1,6}\\s*${header}\\s*:?\\s*$`, 'im');
    return pattern.test(source);
  });
}

/**
 * Extract agent-workflow signals from one artifact's content: plan documents
 * that declare Control and Status headers.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, kinds? }]` records.
 */
export function extractAgentWorkflow({ path, text = '' }) {
  const records = [];
  const lower = String(path).toLowerCase();
  if (isPlanPath(lower)) {
    const headers = planHeaders(text);
    if (headers.length > 0) records.push({ kind: 'plan-state', kinds: headers });
  }
  return records;
}

const STYLEGUIDE_DEPS = Object.freeze([
  'eslint-config-airbnb',
  'eslint-config-airbnb-base',
  'eslint-config-prettier',
  'eslint-config-google',
  'eslint-config-standard',
]);

const PRINCIPLE_PATTERN = /(?:the zen of python|pep 20|go proverbs|effective go|rust api guidelines)/i;

function isRuffConfig(lower, text) {
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  return base === 'ruff.toml' || base === '.ruff.toml'
    || (lower === 'pyproject.toml' && /\[tool\.ruff\]/.test(String(text ?? '')));
}

function isBlackConfig(lower, text) {
  const source = String(text ?? '');
  return (lower === 'pyproject.toml' && /\[tool\.black\]/.test(source))
    || (lower === 'setup.cfg' && /^\[black\]$/m.test(source));
}

function isPrettierConfig(lower, base) {
  return /prettier\.config\.(?:js|cjs|mjs)$/.test(lower) || base.startsWith('.prettierrc');
}

function collectStyleValues(path, text) {
  const lower = String(path).toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  const source = String(text ?? '');
  const values = [];
  if (isRuffConfig(lower, source)) {
    if (/line-length\s*=/.test(source)) values.push('line-length');
    if (/quote-style\s*=/.test(source)) values.push('quote-style');
    if (/indent-width\s*=/.test(source)) values.push('indent-width');
    if (/\[tool\.ruff\.lint\.pep8-naming\]/.test(source)) values.push('naming-patterns');
  }
  if (isBlackConfig(lower, source) && /line-length\s*=/.test(source)) values.push('line-length');
  if (isPrettierConfig(lower, base)) {
    if (/\bprintWidth\s*["']?\s*[:=]/.test(source)) values.push('print-width');
    if (/\btabWidth\s*["']?\s*[:=]/.test(source)) values.push('indent-width');
    if (/\buseTabs\s*["']?\s*[:=]/.test(source)) values.push('indent-tabs');
    if (/\bsingleQuote\s*["']?\s*[:=]/.test(source)) values.push('single-quote');
  }
  if (base === 'rustfmt.toml' || base === '.rustfmt.toml') {
    if (/max_width\s*=/.test(source)) values.push('max-width');
    if (/tab_spaces\s*=/.test(source)) values.push('indent-width');
    if (/indent_style\s*=/.test(source)) values.push('indent-style');
  }
  return values;
}

/**
 * Extract style-guide signals from one artifact's content: declared
 * line-length/indent/quote knobs from ruff, black, prettier, and rustfmt
 * configs, naming-pattern sections, styleguide dependencies, gofmt workflow
 * steps, and zen/principle documents.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds?, status? }]` records.
 */
export function extractStyleGuide({ path, text = '' }) {
  const records = [];
  const lower = String(path).toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  const values = collectStyleValues(path, text);
  if (values.length > 0) {
    records.push({ kind: 'style-values', count: values.length, kinds: values });
  }
  if (base === 'package.json') {
    const found = STYLEGUIDE_DEPS.filter((name) => containsDependencyName(text, name));
    if (found.length > 0) {
      records.push({ kind: 'styleguide-dep', count: found.length, kinds: found });
    }
  }
  if (isWorkflowPath(lower) && wordBoundary('gofmt').test(String(text ?? ''))) {
    records.push({ kind: 'gofmt', status: 'inferred' });
  }
  if (lower.endsWith('.md') && PRINCIPLE_PATTERN.test(String(text ?? ''))) {
    records.push({ kind: 'principles-doc', status: 'inferred' });
  }
  return records;
}
