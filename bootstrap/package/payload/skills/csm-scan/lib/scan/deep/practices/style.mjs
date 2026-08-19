// Style Guide & Conventions — pure content extractors (T003/T005).
//
// One home for the value-carrying style facts of the practices dimension:
// ruff rule families (select split from ignore), Makefile targets plus the
// `check`/`ci-quality` composite gate facts, lefthook piped-stage pipelines
// (per-hook stage facts, separate job counts, abort-on-failure semantics and
// stdin ownership), quality-gate threshold values (per-key, with a bounded
// token-safe value channel for real string values like `semgrepseverity`),
// gates.conf header policy semantics, opencode deny rules plus the adjacent
// comment semantics (override env vars, human change protocol), declared
// conventions headings, and the exceptions-hub role detection with the
// exit-code taxonomy (constants, exception table, HTTP special-casing).
// Every extractor is pure (path + text in, records out), never throws, and
// follows the scanner's record contract `{ kind, count?, kinds?, status? }` so
// it can be wired straight into `CATEGORY_EXTRACTORS`.
//
// Token rule (AD11): every `kinds[]` value is a bounded printable-ASCII token
// WITHOUT spaces. Multi-word sources (convention headings, any value with a
// space) are hyphenated slugs via `slugToken`; numeric values live in `count`
// (integers) or as slug tokens (floats such as `0.3`, grades such as `B`);
// raw `KEY=value` strings are never emitted. Value-channel tokens carry a real
// string value percent-encoded (` ` -> `%20`, `%` -> `%25`) so the ordered
// value survives the model's dedup/sort kinds normalization and is decoded by
// the renderer for verbatim display.
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

function collectSelectCodes(lint, codes) {
  if (lint === null || typeof lint !== 'object') return;
  if (!Array.isArray(lint.select)) return;
  for (const item of lint.select) {
    if (typeof item === 'string' && item.length > 0) codes.add(item);
  }
}

function collectIgnoredCodes(lint, codes) {
  if (lint === null || typeof lint !== 'object') return;
  if (Array.isArray(lint.ignore)) {
    for (const item of lint.ignore) {
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

function ruleCodesRecord(lint, selectOnly, kind) {
  const codes = new Set();
  if (selectOnly) collectSelectCodes(lint, codes);
  else collectIgnoredCodes(lint, codes);
  if (codes.size === 0) return null;
  const uniqueCodes = [...codes];
  const families = [...new Set(uniqueCodes
    .map((code) => code.match(/^[A-Z]+/)?.[0])
    .filter((family) => family !== undefined))];
  const kinds = [...new Set([...families, ...uniqueCodes])]
    .map((item) => slugToken(item))
    .filter((kindToken) => kindToken !== null)
    .slice(0, PRACTICES_LIMITS.maxKinds);
  return { kind, count: capCount(uniqueCodes.length), kinds };
}

/**
 * Extract ruff style facts from a ruff config or a pyproject carrying a
 * `[tool.ruff]` table: the live `select` codes and the ignored codes
 * (`ignore` plus `per-file-ignores`) as SEPARATE records (never summed), plus
 * separate line-length / quote-style / docstring-dialect entries.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds?, status? }]` records.
 */
export function extractRuffRules({ path, text = '' }) {
  if (!isRuffConfigPath(path, text)) return [];
  let parsed;
  try {
    parsed = parseToml(text);
  } catch {
    return [{ kind: 'ruff-select', status: 'unverified' }];
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

  const selectRecord = ruleCodesRecord(lint, true, 'ruff-select');
  if (selectRecord !== null) records.push(selectRecord);
  const ignoreRecord = ruleCodesRecord(lint, false, 'ruff-ignore');
  if (ignoreRecord !== null) records.push(ignoreRecord);

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

const MAKEFILE_CHECK_TOGGLE_IFEQ = /\$\((CHECK_[A-Z0-9_]+)\)\s*,\s*true\)/g;
const MAKEFILE_TARGET_LINE = /^([A-Za-z0-9_.%/-]+)\s*:\s*([^#\r\n]*)/gm;

function makeToggleSlug(name) {
  return name.toLowerCase().replace(/[_.]+/g, '-');
}

/**
 * Extract Makefile targets using the declarations-module target idiom:
 * column-0 `name:` rules are collected while `define`/`endef` blocks and
 * backslash continuations are skipped. Kinds are slugged target names. The
 * count excludes GNU pseudo-targets (`.PHONY`, `.DEFAULT_GOAL`, ...) while the
 * kinds list still records every discovered declaration so composite gates are
 * never double counted. The `check` toggle set (`ifeq ($(CHECK_*),true)`) and
 * the `ci-quality` prereq membership are emitted as separate automation facts.
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
  const records = [];
  if (targets.length > 0) {
    const buildable = targets.filter((token) => !token.startsWith('.'));
    records.push({
      kind: 'make-targets',
      count: capCount(buildable.length),
      kinds: targets.slice(0, PRACTICES_LIMITS.maxKinds),
    });
  }
  const checkToggles = [];
  const seenToggles = new Set();
  for (const match of String(text ?? '').matchAll(MAKEFILE_CHECK_TOGGLE_IFEQ)) {
    const token = makeToggleSlug(match[1]);
    if (!seenToggles.has(token)) {
      seenToggles.add(token);
      checkToggles.push(token);
    }
  }
  if (checkToggles.length > 0) {
    records.push({
      kind: 'make-check-toggles',
      count: capCount(checkToggles.length),
      kinds: checkToggles.slice(0, PRACTICES_LIMITS.maxKinds),
    });
  }
  for (const match of String(text ?? '').matchAll(MAKEFILE_TARGET_LINE)) {
    if (match[1] !== 'ci-quality') continue;
    const members = match[2].trim().split(/\s+/).filter((item) => item.length > 0);
    if (members.length > 0) {
      records.push({
        kind: 'make-ci-quality',
        count: capCount(members.length),
        kinds: members.slice(0, PRACTICES_LIMITS.maxKinds),
      });
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// lefthook hook stages and job counts (structure-over-raw-YAML)
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
 * Collect the declared hooks (column-0 stage keys), each with the comment
 * block immediately preceding it and the hook body (every line up to the next
 * hook key). Block scalars make a shallow YAML parse throw, so the extractor
 * reads indentation structure over the raw text and never parses YAML.
 * @param {string} source - raw lefthook text.
 * @returns {Array<{ name: string, comment: string[], body: string }>} hooks in
 *   declaration order.
 */
function lefthookHookBodies(source) {
  const lines = source.split(/\r?\n/);
  const hooks = [];
  const seen = new Set();
  let current = null;
  let pendingComment = [];
  for (const line of lines) {
    const hookMatch = HOOK_STAGE_LINE.exec(line);
    if (hookMatch !== null && HOOK_STAGE_NAMES.has(hookMatch[1])) {
      if (!seen.has(hookMatch[1])) {
        seen.add(hookMatch[1]);
        current = { name: hookMatch[1], comment: pendingComment, body: [] };
        hooks.push(current);
      }
      pendingComment = [];
      continue;
    }
    if (current === null) {
      if (/^\s*#/.test(line)) pendingComment.push(line);
      else if (line.trim().length > 0) pendingComment = [];
      continue;
    }
    if (/^\s*#/.test(line)) {
      pendingComment.push(line);
      continue;
    }
    if (line.trim().length > 0) pendingComment = [];
    current.body.push(line);
  }
  return hooks;
}

/**
 * Read the authored stage diagram from a hook's header comment: the highest
 * `Stage N` label or an explicit `N-stage` wording. Falls back to null when
 * the comment carries no stage enumeration.
 * @param {string[]} commentLines - the comment block preceding the hook key.
 * @returns {number|null} the authored stage count, or null.
 */
function authoredStageCount(commentLines) {
  const text = commentLines.join('\n');
  let maxLabel = 0;
  let found = false;
  for (const match of text.matchAll(/\bStage\s+(\d{1,3})\b/gi)) {
    maxLabel = Math.max(maxLabel, parseInt(match[1], 10));
    found = true;
  }
  if (found) return maxLabel;
  const pipeline = /(\d{1,3})-stage\b/i.exec(text);
  if (pipeline !== null) return parseInt(pipeline[1], 10);
  return null;
}

/**
 * Count a hook's top-level stages structurally: top-level `- name:` jobs in a
 * `jobs:` list, or the command keys of a legacy `commands:` map.
 * @param {string} body - the hook body.
 * @returns {number} the top-level stage count.
 */
function topLevelStageCount(body) {
  const jobItems = body.match(/^ {4}- name:\s*\S+/gm) ?? [];
  if (jobItems.length > 0) return jobItems.length;
  const commandKeys = body.match(/^ {4}[A-Za-z0-9_.-]+\s*:\s*(?:#.*)?$/gm) ?? [];
  return commandKeys.length;
}

/**
 * Total job count across a lefthook document: every `- name:` job (top-level
 * and nested group jobs) plus any legacy `commands:` keys.
 * @param {string} source - full lefthook text.
 * @param {Array<{ body: string }>} hooks - parsed hooks.
 * @returns {number} the total job count.
 */
function countLefthookJobs(source, hooks) {
  const namedJobs = source.match(HOOK_JOB_LINE) ?? [];
  let legacy = 0;
  for (const hook of hooks) {
    legacy += (hook.body.match(/^ {4}[A-Za-z0-9_.-]+\s*:\s*(?:#.*)?$/gm) ?? []).length;
  }
  return namedJobs.length + legacy;
}

/**
 * The jobs that own the git push stdin pipe (`use_stdin: true`), slugged.
 * @param {string} body - a hook body.
 * @returns {string[]} stdin-owner job name slugs.
 */
function stdinOwnerSlugs(body) {
  const owners = [];
  const seen = new Set();
  let currentJob = null;
  for (const line of body.split(/\r?\n/)) {
    const nameMatch = /^\s*- name:\s*([^\s#]+)/.exec(line);
    if (nameMatch !== null) {
      currentJob = nameMatch[1];
      continue;
    }
    if (currentJob !== null && /^\s*use_stdin:\s*true\s*(?:#.*)?$/.test(line)) {
      const slug = slugToken(currentJob);
      if (slug !== null && !seen.has(slug)) {
        seen.add(slug);
        owners.push(slug);
      }
      currentJob = null;
    }
  }
  return owners;
}

/**
 * Execution-semantics tokens for a hook: `piped`/`abort-on-failure` when the
 * hook (or a nested group) is piped, `parallel` when a nested group is
 * parallel, and `stdin-owner:<job>` for each stdin-owning job.
 * @param {string} body - a hook body.
 * @returns {string[]} bounded semantics tokens.
 */
function hookSemanticsTokens(body) {
  const kinds = [];
  const add = (token) => {
    if (!kinds.includes(token)) kinds.push(token);
  };
  const hookPiped = /^\s{2}piped:\s*true\b/m.test(body);
  const groupPiped = /^\s{4,}piped:\s*true\b/m.test(body);
  const groupParallel = /^\s{4,}parallel:\s*true\b/m.test(body);
  if (hookPiped) add('piped');
  if (hookPiped || groupPiped) add('abort-on-failure');
  if (groupParallel) add('parallel');
  for (const owner of stdinOwnerSlugs(body)) add(`stdin-owner:${owner}`);
  return kinds;
}

/**
 * Extract lefthook hook-stage facts from the raw YAML text. Reports the stage
 * count (number of declared hooks) and the job count as SEPARATE records,
 * plus one per-hook pipeline fact carrying the authored stage count, the
 * ordering semantics (`piped`/`abort-on-failure`/`parallel`) and stdin
 * ownership. Block scalars make the shallow YAML parser throw, so this
 * extractor reads column-0 hook keys, comment blocks and indentation directly.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds? }]` records.
 */
export function extractLefthookStages({ path, text = '' }) {
  const base = basenameOf(String(path).toLowerCase());
  if (!isLefthookPath(base)) return [];
  const source = String(text ?? '');
  const hooks = lefthookHookBodies(source).map((hook) => ({
    name: hook.name,
    comment: hook.comment,
    body: hook.body.join('\n'),
  }));
  if (hooks.length === 0) return [];
  const records = [{
    kind: 'hook-stages',
    count: capCount(hooks.length),
    kinds: hooks.map((hook) => hook.name).slice(0, PRACTICES_LIMITS.maxKinds),
  }];
  records.push({ kind: 'hook-jobs', count: capCount(countLefthookJobs(source, hooks)) });
  for (const hook of hooks) {
    const stageCount = authoredStageCount(hook.comment) ?? topLevelStageCount(hook.body);
    records.push({
      kind: `hook-stage:${hook.name}`,
      count: capCount(stageCount),
      kinds: hookSemanticsTokens(hook.body),
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// quality/gates.conf per-key threshold values, check toggles, header policy
// ---------------------------------------------------------------------------

const GATE_LINE = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*)$/gm;
const GATE_INTEGER = /^[+-]?\d+$/;
const GATE_FLOAT = /^[+-]?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/;
// Allowlisted keys that may carry their real string value through the bounded
// token-safe value channel (percent-encoded so it survives the kinds set).
const GATE_STRING_VALUE_KEYS = new Set(['semgrepseverity']);
const GATE_FALSY_VALUES = new Set(['false', '0', 'no', 'off', '']);

/**
 * Percent-encode a gate string value into a single token-safe kind:
 * spaces become `%20`, `%` becomes `%25`, and non-ASCII becomes UTF-8 byte
 * escapes. The renderer decodes the token back for verbatim display.
 * @param {string} value - the raw string value.
 * @returns {string} an encoded printable-ASCII token.
 */
function encodeValueToken(value) {
  return String(value).replace(/[^\x20-\x7e]|%| /g, (ch) => {
    if (ch === ' ') return '%20';
    return [...Buffer.from(ch, 'utf8')]
      .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
      .join('');
  });
}

function toggleCount(value) {
  return GATE_FALSY_VALUES.has(String(value).trim().toLowerCase()) ? 0 : 1;
}

function gatesHeaderKinds(source) {
  const lines = source.split(/\r?\n/);
  const comment = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      comment.push(trimmed.slice(1).trim());
      continue;
    }
    if (trimmed !== '') break;
  }
  const text = comment.join(' ');
  const kinds = [];
  const add = (token) => {
    if (!kinds.includes(token)) kinds.push(token);
  };
  if (/denied\s+to\s+(?:coding\s+)?agents?/i.test(text)) add('denied-to-agents');
  if (/\bfloor|locked\b/i.test(text)) add('locked-floors');
  if (/human/i.test(text)) add('human-change');
  if (/remove\s+(?:the\s+)?deny\s+rule/i.test(text) && /restore/i.test(text)) {
    add('deny-remove-restore');
  }
  if (/tighten/i.test(text) && /loosen/i.test(text)) add('tighten-not-loosen');
  return kinds;
}

/**
 * Extract per-key quality-gate facts from a gates file: integers become
 * `count`; floats and grades become slug `kinds` (`0.3`, `B`); allowlisted
 * string-value keys (`semgrepseverity`) carry their real value through the
 * bounded token-safe value channel; `CHECK_*` lines become per-toggle facts
 * (count 1/0); and the header comment policy becomes tokenized kinds. Keys
 * outside the model allowlist never survive, and raw `KEY=value` strings are
 * never emitted.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds? }]` records, one per key.
 */
export function extractGateValues({ path, text = '' }) {
  const lower = String(path).toLowerCase();
  if (!isQualityGatesPath(lower)) return [];
  const records = [];
  const source = String(text ?? '');
  const headerKinds = gatesHeaderKinds(source);
  if (headerKinds.length > 0) records.push({ kind: 'gates-header', kinds: headerKinds });
  for (const match of source.matchAll(GATE_LINE)) {
    const name = match[1];
    const value = match[2].replace(/\s+#.*$/, '').trim();
    const normalized = name.toLowerCase().replace(/[_.-]/g, '');
    if (normalized.startsWith('check')) {
      records.push({
        kind: `check-toggle:${name.toLowerCase().replace(/[_.]+/g, '-')}`,
        count: toggleCount(value),
      });
      continue;
    }
    if (!QUALITY_GATE_ALLOWLIST.test(normalized)) continue;
    const kind = `gate-value:${normalized}`;
    if (GATE_STRING_VALUE_KEYS.has(normalized)) {
      const encoded = encodeValueToken(value);
      if (encoded.length > 0 && encoded.length <= PRACTICES_LIMITS.kind && TOKEN_PATTERN.test(encoded)) {
        records.push({ kind, kinds: [encoded] });
      } else {
        records.push({ kind });
      }
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
// opencode.jsonc deny rules, adjacent semantics, and plugin inventory
// ---------------------------------------------------------------------------

const OPENCODE_PATHS = new Set(['opencode.jsonc', '.opencode/opencode.jsonc']);

const OPENCODE_DENY_ENTRY = /"[^"]+":\s*"deny"/;

/**
 * Extract contiguous comment blocks from JSONC source, preserving their line
 * ranges and text. The structural parse still reuses the shared
 * `stripJsonComments`/`removeJsonTrailingCommas` helpers.
 * @param {string} source - raw JSONC text.
 * @returns {Array<{ start: number, end: number, text: string }>} blocks.
 */
function jsoncCommentBlocks(source) {
  const blocks = [];
  let current = null;
  const flush = () => {
    if (current !== null) {
      blocks.push(current);
      current = null;
    }
  };
  let line = 1;
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '"') {
      flush();
      i++;
      while (i < n && source[i] !== '"') {
        if (source[i] === '\\') i++;
        if (source[i] === '\n') line++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      const start = line;
      const text = [];
      i += 2;
      while (i < n && source[i] !== '\n') {
        text.push(source[i]);
        i++;
      }
      if (current !== null && current.end + 1 === line) {
        current.text += ` ${text.join('')}`;
        current.end = line;
      } else {
        flush();
        current = { start, end: line, text: text.join('') };
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      const start = line;
      const text = [];
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++;
        else text.push(source[i]);
        i++;
      }
      i += 2;
      if (current !== null && current.end + 1 === start) {
        current.text += ` ${text.join('')}`;
        current.end = line;
      } else {
        flush();
        current = { start, end: line, text: text.join('') };
      }
      continue;
    }
    if (ch === '\n') line++;
    else if (!/\s/.test(ch)) flush();
    i++;
  }
  flush();
  return blocks;
}

/**
 * Tokenize a deny-rule comment into bounded semantic kinds: override env vars,
 * the human change protocol, remove-restore of the deny rule, and agent
 * denial. No verbatim prose ever survives.
 * @param {string} text - the adjacent comment text.
 * @returns {string[]} bounded semantic kind tokens.
 */
function denyCommentKinds(text) {
  const kinds = [];
  const add = (token) => {
    if (token !== null && token.length > 0 && !kinds.includes(token)) kinds.push(token);
  };
  for (const match of text.matchAll(/\b(OPENCODE_[A-Z0-9_]+)\b/g)) {
    add(`override-env:${match[1].toLowerCase().replace(/_/g, '-')}`);
  }
  if (/human override/i.test(text)) add('human-override');
  if (/remove\s+(?:the\s+)?deny\s+rule/i.test(text) && /restore/i.test(text)) {
    add('deny-remove-restore');
  }
  if (/(?:denied|blocked)\s+to\s+(?:coding\s+)?agents?/i.test(text) || /not\s+permitted/i.test(text)) {
    add('agent-denied');
  }
  return kinds;
}

/**
 * Extract opencode agent-workflow signals from an opencode.jsonc document:
 * the `permission.edit` deny globs, the comment semantics adjacent to each
 * deny entry (override env vars, human change protocol) and the plugin list
 * names, all as token-safe kinds. JSONC comments and trailing commas are
 * scrubbed before parsing; unparseable documents produce no signals.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds? }]` records.
 */
export function extractOpencodeWorkflow({ path, text = '' }) {
  const lower = String(path).toLowerCase();
  if (!OPENCODE_PATHS.has(lower)) return [];
  const rawSource = String(text ?? '');
  let parsed;
  try {
    parsed = JSON.parse(removeJsonTrailingCommas(stripJsonComments(rawSource)));
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
    const denyLines = [];
    const sourceLines = rawSource.split(/\r?\n/);
    for (let index = 0; index < sourceLines.length; index++) {
      if (OPENCODE_DENY_ENTRY.test(sourceLines[index])) denyLines.push(index + 1);
    }
    const comments = jsoncCommentBlocks(rawSource);
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
    const semantics = new Set();
    for (const denyLine of denyLines) {
      const nearest = comments
        .filter((block) => block.end < denyLine)
        .sort((left, right) => right.end - left.end)[0];
      if (nearest === undefined) continue;
      for (const kind of denyCommentKinds(nearest.text)) semantics.add(kind);
    }
    if (semantics.size > 0) {
      records.push({
        kind: 'deny-rule-semantics',
        count: capCount(denyLines.length),
        kinds: [...semantics].slice(0, PRACTICES_LIMITS.maxKinds),
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
// exceptions-hub role detection and the exit-code taxonomy
// ---------------------------------------------------------------------------

const EXCEPTIONS_HUB_BASENAME = /^(?:exit_codes|exceptions|errors|error_handler)\.py$/;
const EXCEPTION_CLASS = /^\s*class\s+\w+\s*\([^)]*(?:Exception|Error)/gm;
const BARE_UPPERCASE_CONSTANT = /^\s*[A-Z][A-Z0-9_]*\s*=\s*\S+/gm;
const EXIT_CODE_CONSTANT_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]*)?=\s*(\d{1,6})\s*$/gm;
const EXCEPTION_TABLE_ROW = /\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;

function pairSlug(name) {
  return String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Collect `(ExceptionClass, CODE_NAME)` rows from the exception-to-exit-code
 * table block (`... = [ ... ]`), skipping the type-annotation header.
 * @param {string} source - the module source.
 * @returns {string[][]} `[class, codeName]` rows in declaration order.
 */
function exceptionTableRows(source) {
  const lines = source.split(/\r?\n/);
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!inTable) {
      if (/table/i.test(line) && /=\s*\[/.test(line)) inTable = true;
      continue;
    }
    if (/^\s*\]/.test(line)) break;
    if (/^\s*\(/.test(line)) {
      for (const match of line.matchAll(EXCEPTION_TABLE_ROW)) {
        rows.push([match[1], match[2]]);
      }
    }
  }
  return rows;
}

/**
 * Detect the HTTP status special-casing: `401`/`403` mapped to one exit code
 * and `429`/`5xx` mapped to another. Only fires when the constants resolve.
 * @param {string} source - the module source.
 * @param {Map<string, number>} constants - name-to-int constant map.
 * @returns {string[]} bounded `http-<statuses>-<code>` kind tokens.
 */
function httpSpecialCases(source, constants) {
  const lines = source.split(/\r?\n/);
  const kinds = [];
  const push = (token) => {
    if (!kinds.includes(token)) kinds.push(token);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let expectation = null;
    const setMatch = /status\s+in\s*\{([^}]*)\}/.exec(line);
    if (setMatch !== null) {
      const members = [...setMatch[1].matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map((m) => m[0]);
      const ints = members.map((name) => constants.get(name))
        .filter((value) => typeof value === 'number')
        .sort((left, right) => left - right);
      if (ints.length === 2 && ints[0] === 401 && ints[1] === 403) expectation = '401-403';
    } else {
      const cmpMatch = /status\s*==\s*([A-Za-z_][A-Za-z0-9_]*|\d+)\s+or\s+status\s*>=\s*([A-Za-z_][A-Za-z0-9_]*|\d+)/.exec(line);
      if (cmpMatch !== null) {
        const first = /^\d+$/.test(cmpMatch[1]) ? parseInt(cmpMatch[1], 10) : constants.get(cmpMatch[1]);
        const second = /^\d+$/.test(cmpMatch[2]) ? parseInt(cmpMatch[2], 10) : constants.get(cmpMatch[2]);
        if (first === 429 && second === 500) expectation = '429-5xx';
      }
    }
    if (expectation === null) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const ret = /return\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[j]);
      if (ret === null) continue;
      const code = constants.get(ret[1]);
      if (typeof code === 'number') push(`http-${expectation}-${code}`);
      break;
    }
  }
  return kinds;
}

/**
 * Detect an exceptions-hub module (exit_codes/exceptions/errors/error_handler
 * basenames) and report its exception classes plus bare uppercase constants,
 * the exit-code constant pairs (`SUCCESS=0` ... as `name-value` slugs), the
 * exception-to-exit-code table pairs, and the HTTP status special-casing.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds? }]` records.
 */
export function extractExceptionsHub({ path, text = '' }) {
  const base = basenameOf(String(path).toLowerCase());
  if (!EXCEPTIONS_HUB_BASENAME.test(base)) return [];
  const source = String(text ?? '');
  const records = [];
  const exceptionClasses = source.match(EXCEPTION_CLASS) ?? [];
  const bareConstants = source.match(BARE_UPPERCASE_CONSTANT) ?? [];
  const roleCount = capCount(exceptionClasses.length + bareConstants.length);
  if (roleCount > 0) records.push({ kind: 'exceptions-hub', count: roleCount });

  const constants = new Map();
  for (const match of source.matchAll(EXIT_CODE_CONSTANT_LINE)) {
    constants.set(match[1], parseInt(match[2], 10));
  }
  const exitCodePairs = [...constants]
    .filter(([name]) => /^[A-Z][A-Z0-9_]*$/.test(name) && !name.startsWith('_'))
    .map(([name, value]) => `${pairSlug(name)}-${value}`);
  if (exitCodePairs.length > 0) {
    records.push({
      kind: 'exit-code-constant',
      count: capCount(exitCodePairs.length),
      kinds: exitCodePairs.slice(0, PRACTICES_LIMITS.maxKinds),
    });
  }
  const tableRows = exceptionTableRows(source);
  if (tableRows.length > 0) {
    const pairs = tableRows.map(([className, codeName]) => {
      const resolved = constants.get(codeName);
      const suffix = typeof resolved === 'number' ? String(resolved) : pairSlug(codeName);
      return `${pairSlug(className)}-${suffix}`;
    });
    records.push({
      kind: 'exit-code-exception',
      count: capCount(pairs.length),
      kinds: pairs.slice(0, PRACTICES_LIMITS.maxKinds),
    });
  }
  const httpKinds = httpSpecialCases(source, constants);
  if (httpKinds.length > 0) {
    records.push({
      kind: 'exit-code-http',
      kinds: httpKinds.slice(0, PRACTICES_LIMITS.maxKinds),
    });
  }
  return records;
}
