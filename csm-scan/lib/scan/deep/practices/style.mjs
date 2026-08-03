// Style Guide & Conventions — pure content extractors (T003).
//
// One home for the value-carrying style facts of the practices dimension:
// ruff rule families and dialects, Makefile targets, lefthook hook stages and
// job counts, quality-gate threshold values (per-key), opencode deny rules and
// plugin inventory, declared-conventions headings, and exceptions-hub role
// detection. Every extractor is pure (path + text in, records out), never
// throws, and follows the scanner's record contract `{ kind, count?, kinds?,
// status? }` so it can be wired straight into `CATEGORY_EXTRACTORS`.
//
// Token rule (AD11): every `kinds[]` value is a bounded printable-ASCII token
// WITHOUT spaces. Multi-word sources (convention headings, any value with a
// space) are hyphenated slugs via `slugToken`; numeric values live in `count`
// (integers) or as slug tokens (floats such as `0.3`, grades such as `B`);
// raw `KEY=value` strings are never emitted.
//
// ESM only. Zero npm deps. node: builtins via shared modules only.

import { parseToml } from '../../shared/parse.mjs';
import { removeJsonTrailingCommas, stripJsonComments } from '../../shared/jsonc.mjs';
import {
  PRACTICES_LIMITS,
  QUALITY_GATE_ALLOWLIST,
  isLefthookPath,
  isQualityGatesPath,
} from './model.mjs';

const TOKEN_PATTERN = /^[\x21-\x7e]+$/;

/**
 * Convert a value into a bounded space-free slug token. Values that already
 * satisfy the token pattern are kept verbatim; anything else is lower-cased,
 * run-joined, trimmed of hyphens, and capped to the kind length bound.
 * @param {string} value - the raw source value.
 * @returns {string|null} a token-safe slug, or null when nothing survives.
 */
export function slugToken(value) {
  const source = String(value).trim();
  if (TOKEN_PATTERN.test(source) && source.length <= PRACTICES_LIMITS.kind) return source;
  const slug = source.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PRACTICES_LIMITS.kind)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : null;
}

function basenameOf(path) {
  const parts = String(path).split('/');
  return parts[parts.length - 1] ?? '';
}

function capCount(value) {
  return Math.min(value, PRACTICES_LIMITS.maxCount);
}

// Convention headings always become lower-case hyphenated slugs (a single-word
// heading like `# Contributing` must not keep its title case in a kind token).
function headingSlug(value) {
  const slug = String(value).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PRACTICES_LIMITS.kind)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : null;
}

// ---------------------------------------------------------------------------
// ruff rules, line-length, quote-style, and docstring dialect
// ---------------------------------------------------------------------------

function isRuffConfigPath(path, text) {
  const base = basenameOf(String(path).toLowerCase());
  if (base === 'ruff.toml' || base === '.ruff.toml') return true;
  return String(path).toLowerCase() === 'pyproject.toml'
    && /\[tool\.ruff\]/.test(String(text ?? ''));
}

function collectRuleCodes(lint, codes) {
  if (lint === null || typeof lint !== 'object') return;
  for (const listName of ['select', 'ignore']) {
    if (!Array.isArray(lint[listName])) continue;
    for (const item of lint[listName]) {
      if (typeof item === 'string' && item.length > 0) codes.add(item);
    }
  }
  const perFile = lint['per-file-ignores'];
  if (perFile !== null && typeof perFile === 'object' && !Array.isArray(perFile)) {
    for (const glob of Object.values(perFile)) {
      if (!Array.isArray(glob)) continue;
      for (const item of glob) {
        if (typeof item === 'string' && item.length > 0) codes.add(item);
      }
    }
  }
}

/**
 * Extract ruff style facts from a ruff config or a pyproject carrying a
 * `[tool.ruff]` table: one aggregated rule entry (count = unique codes,
 * kinds = deduped rule families plus codes), plus separate line-length /
 * quote-style / docstring-dialect entries.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds?, status? }]` records.
 */
export function extractRuffRules({ path, text = '' }) {
  if (!isRuffConfigPath(path, text)) return [];
  let parsed;
  try {
    parsed = parseToml(text);
  } catch {
    return [{ kind: 'ruff-rules', status: 'unverified' }];
  }
  if (parsed === null || typeof parsed !== 'object') return [];
  const base = basenameOf(String(path).toLowerCase());
  const isDedicatedConfig = base === 'ruff.toml' || base === '.ruff.toml';
  // A dedicated ruff.toml is a root-level ruff table; a pyproject nests it
  // under `[tool.ruff]`.
  const ruff = isDedicatedConfig ? parsed
    : (parsed.tool !== null && typeof parsed.tool === 'object' ? parsed.tool.ruff : null);
  if (ruff === null || typeof ruff !== 'object') return [];
  const lint = ruff.lint !== null && typeof ruff.lint === 'object' ? ruff.lint : null;
  const records = [];

  const codes = new Set();
  collectRuleCodes(lint, codes);
  if (codes.size > 0) {
    const uniqueCodes = [...codes];
    const families = [...new Set(uniqueCodes
      .map((code) => code.match(/^[A-Z]+/)?.[0])
      .filter((family) => family !== undefined))];
    const kinds = [...new Set([...families, ...uniqueCodes])]
      .map((item) => slugToken(item))
      .filter((kind) => kind !== null)
      .slice(0, PRACTICES_LIMITS.maxKinds);
    records.push({ kind: 'ruff-rules', count: capCount(uniqueCodes.length), kinds });
  }

  if (typeof ruff['line-length'] === 'number' && Number.isSafeInteger(ruff['line-length'])) {
    records.push({ kind: 'line-length', count: ruff['line-length'] });
  }
  if (typeof ruff['quote-style'] === 'string') {
    const token = slugToken(ruff['quote-style']);
    if (token !== null) records.push({ kind: 'quote-style', kinds: [token] });
  }
  const pydocstyle = lint !== null && lint.pydocstyle !== null
    && typeof lint.pydocstyle === 'object' ? lint.pydocstyle : null;
  if (pydocstyle !== null && typeof pydocstyle.convention === 'string') {
    const token = slugToken(pydocstyle.convention);
    if (token !== null) records.push({ kind: 'docstring-dialect', kinds: [token] });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Makefile targets
// ---------------------------------------------------------------------------

/**
 * Extract Makefile targets using the declarations-module target idiom:
 * column-0 `name:` rules are collected while `define`/`endef` blocks and
 * backslash continuations are skipped. Kinds are slugged target names.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds? }]` records.
 */
export function extractMakeTargets({ path, text = '' }) {
  const base = basenameOf(String(path).toLowerCase());
  if (base !== 'makefile' && base !== 'gnumakefile') return [];
  const targets = [];
  const seen = new Set();
  const lines = String(text ?? '').split(/\r?\n/);
  let inDefine = false;
  let continuation = false;
  for (const line of lines) {
    if (/^define\b/.test(line)) {
      inDefine = true;
      continue;
    }
    if (inDefine) {
      if (/^endef\b/.test(line)) inDefine = false;
      continue;
    }
    if (continuation) {
      if (/\\\s*$/.test(line)) continue;
      continuation = false;
      if (/^\t/.test(line)) continue;
    }
    if (!inDefine && /^[A-Za-z0-9_.%/-]+\s*:(?:[^=]|$)/.test(line)) {
      const name = line.match(/^([A-Za-z0-9_.%/-]+)\s*:/)?.[1];
      if (name !== undefined) {
        const token = slugToken(name);
        if (token !== null && !seen.has(token)) {
          seen.add(token);
          targets.push(token);
        }
      }
      continue;
    }
    if (line.endsWith('\\')) {
      continuation = true;
    }
  }
  if (targets.length === 0) return [];
  return [{
    kind: 'make-targets',
    count: capCount(targets.length),
    kinds: targets.slice(0, PRACTICES_LIMITS.maxKinds),
  }];
}

// ---------------------------------------------------------------------------
// lefthook hook stages and job counts (regex-over-YAML)
// ---------------------------------------------------------------------------

const HOOK_STAGE_NAMES = new Set([
  'pre-commit', 'pre-push', 'commit-msg', 'prepare-commit-msg', 'pre-merge-commit',
  'post-commit', 'post-merge', 'post-checkout', 'post-rewrite', 'post-update',
  'pre-rebase', 'applypatch-msg', 'pre-applypatch', 'post-applypatch',
  'pre-receive', 'update', 'post-receive', 'pre-auto-gc',
  'post-index-change', 'reference-transaction', 'proc-receive', 'push-to-checkout',
]);

const HOOK_STAGE_LINE = /^([A-Za-z0-9_.-]+):\s*(?:#.*)?$/;
const HOOK_JOB_LINE = /^\s*- name:\s*\S+/gm;

/**
 * Extract lefthook hook stages and job totals via regex over the raw YAML.
 * Block scalars make the shallow YAML parser throw, so this extractor never
 * parses YAML — it reads column-0 hook-stage keys and `- name:` job lines.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds? }]` records.
 */
export function extractLefthookStages({ path, text = '' }) {
  const base = basenameOf(String(path).toLowerCase());
  if (!isLefthookPath(base)) return [];
  const source = String(text ?? '');
  const stages = [];
  const seenStages = new Set();
  for (const line of source.split(/\r?\n/)) {
    const match = HOOK_STAGE_LINE.exec(line);
    if (match !== null && HOOK_STAGE_NAMES.has(match[1]) && !seenStages.has(match[1])) {
      seenStages.add(match[1]);
      stages.push(match[1]);
    }
  }
  const jobMatches = source.match(HOOK_JOB_LINE) ?? [];
  if (stages.length === 0 && jobMatches.length === 0) return [];
  return [{
    kind: 'hook-stages',
    count: capCount(stages.length + jobMatches.length),
    kinds: stages.slice(0, PRACTICES_LIMITS.maxKinds),
  }];
}

// ---------------------------------------------------------------------------
// quality/gates.conf per-key threshold values
// ---------------------------------------------------------------------------

const GATE_LINE = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(\S+)/gm;
const GATE_INTEGER = /^[+-]?\d+$/;
const GATE_FLOAT = /^[+-]?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Extract per-key quality-gate threshold values from a gates file. Integers
 * become `count`; floats and grades become slug `kinds` (`0.3`, `B`);
 * `SEMGREP_SEVERITY` records key presence only. Keys outside the model
 * allowlist never survive, and raw `KEY=value` strings are never emitted.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds? }]` records, one per key.
 */
export function extractGateValues({ path, text = '' }) {
  const lower = String(path).toLowerCase();
  if (!isQualityGatesPath(lower)) return [];
  const records = [];
  const source = String(text ?? '');
  for (const match of source.matchAll(GATE_LINE)) {
    const normalized = match[1].toLowerCase().replace(/[_.-]/g, '');
    if (!QUALITY_GATE_ALLOWLIST.test(normalized)) continue;
    const value = match[2];
    const kind = `gate-value:${normalized}`;
    if (normalized === 'semgrepseverity') {
      records.push({ kind });
      continue;
    }
    if (GATE_INTEGER.test(value)) {
      records.push({ kind, count: Math.min(parseInt(value, 10), PRACTICES_LIMITS.maxCount) });
      continue;
    }
    if (GATE_FLOAT.test(value)) {
      const token = slugToken(value);
      if (token !== null) records.push({ kind, kinds: [token] });
      continue;
    }
    const token = slugToken(value);
    if (token !== null) records.push({ kind, kinds: [token] });
  }
  return records;
}

// ---------------------------------------------------------------------------
// opencode.jsonc deny rules and plugin inventory
// ---------------------------------------------------------------------------

const OPENCODE_PATHS = new Set(['opencode.jsonc', '.opencode/opencode.jsonc']);

/**
 * Extract opencode agent-workflow signals from an opencode.jsonc document:
 * the `permission.edit` deny globs and the plugin list names, both as
 * token-safe kinds. JSONC comments and trailing commas are scrubbed before
 * parsing; unparseable documents produce no signals.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds? }]` records.
 */
export function extractOpencodeWorkflow({ path, text = '' }) {
  const lower = String(path).toLowerCase();
  if (!OPENCODE_PATHS.has(lower)) return [];
  let parsed;
  try {
    parsed = JSON.parse(removeJsonTrailingCommas(stripJsonComments(String(text ?? ''))));
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const records = [];

  const permission = parsed.permission !== null && typeof parsed.permission === 'object'
    ? parsed.permission : null;
  const edit = permission !== null && permission.edit !== null
    && typeof permission.edit === 'object' && !Array.isArray(permission.edit)
    ? permission.edit : null;
  if (edit !== null) {
    const denyGlobs = [];
    const seenGlobs = new Set();
    for (const [glob, mode] of Object.entries(edit)) {
      if (mode !== 'deny') continue;
      const token = slugToken(glob);
      if (token !== null && !seenGlobs.has(token)) {
        seenGlobs.add(token);
        denyGlobs.push(token);
      }
    }
    if (denyGlobs.length > 0) {
      records.push({
        kind: 'deny-rules',
        count: capCount(denyGlobs.length),
        kinds: denyGlobs.slice(0, PRACTICES_LIMITS.maxKinds),
      });
    }
  }

  if (Array.isArray(parsed.plugin)) {
    const plugins = [];
    const seenPlugins = new Set();
    for (const item of parsed.plugin) {
      if (typeof item !== 'string') continue;
      const token = slugToken(item);
      if (token !== null && !seenPlugins.has(token)) {
        seenPlugins.add(token);
        plugins.push(token);
      }
    }
    if (plugins.length > 0) {
      records.push({
        kind: 'opencode-plugins',
        count: capCount(plugins.length),
        kinds: plugins.slice(0, PRACTICES_LIMITS.maxKinds),
      });
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// declared-conventions heading signals
// ---------------------------------------------------------------------------

const CONVENTION_DOC_PATHS = new Set([
  'agents.md', '.agents/agents.md', 'contributing.md', '.github/contributing.md',
]);

const MARKDOWN_HEADING = /^#{1,6}\s+([^\r\n]+?)\s*#*\s*$/gm;

/**
 * Extract declared-conventions signals from AGENTS.md and CONTRIBUTING.md
 * documents: the markdown headings, rendered as hyphenated slug kinds.
 * Heading-signal only — free-form prose is deliberately out of scope (AD6).
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds? }]` records.
 */
export function extractDeclaredConventions({ path, text = '' }) {
  const lower = String(path).toLowerCase();
  if (!CONVENTION_DOC_PATHS.has(lower)) return [];
  const headings = [];
  const seen = new Set();
  const source = String(text ?? '');
  for (const match of source.matchAll(MARKDOWN_HEADING)) {
    const token = headingSlug(match[1]);
    if (token !== null && !seen.has(token)) {
      seen.add(token);
      headings.push(token);
    }
  }
  if (headings.length === 0) return [];
  return [{
    kind: 'declared-conventions',
    count: capCount(headings.length),
    kinds: headings.slice(0, PRACTICES_LIMITS.maxKinds),
  }];
}

// ---------------------------------------------------------------------------
// exceptions-hub role detection
// ---------------------------------------------------------------------------

const EXCEPTIONS_HUB_BASENAME = /^(?:exit_codes|exceptions|errors|error_handler)\.py$/;
const EXCEPTION_CLASS = /^\s*class\s+\w+\s*\([^)]*(?:Exception|Error)/gm;
const BARE_UPPERCASE_CONSTANT = /^\s*[A-Z][A-Z0-9_]*\s*=\s*\S+/gm;

/**
 * Detect an exceptions-hub module (exit_codes/exceptions/errors/error_handler
 * basenames) and count its exception classes plus bare uppercase constants.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count }]` records.
 */
export function extractExceptionsHub({ path, text = '' }) {
  const base = basenameOf(String(path).toLowerCase());
  if (!EXCEPTIONS_HUB_BASENAME.test(base)) return [];
  const source = String(text ?? '');
  const exceptionClasses = source.match(EXCEPTION_CLASS) ?? [];
  const bareConstants = source.match(BARE_UPPERCASE_CONSTANT) ?? [];
  const count = capCount(exceptionClasses.length + bareConstants.length);
  if (count === 0) return [];
  return [{ kind: 'exceptions-hub', count }];
}
