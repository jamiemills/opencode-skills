// Policy Content & Agent Workflow — bounded content extractors (T006).
//
// One home for the "how this repo governs itself" facts of the practices
// dimension: the suppression policy (owner:/reason: requirement, identity
// fingerprints, block-new-unannotated gate), the ratchet engine, the mutation
// policy (exit codes, actionable categories, scope, schedule), the fuzz
// replay contract and decomposition, the make/workflow policy validators, the
// analyser-contract registry, and the `.opencode` agent-workflow content
// (the 20-rule conventions block as tokenized rule facts, per-plugin behaviour
// markers, the npm `check` script composition and the vitest coverage
// thresholds).
//
// Every extractor is pure (path + text in, records out), never throws, and
// follows the scanner's record contract `{ kind, count?, kinds?, status? }`.
// Rule IDs and semantic tokens are emitted instead of verbatim prose (A008):
// multi-word sources are slugged, and any value that does not satisfy the
// token alphabet is dropped. Cross-file methodology facts (csm-planning,
// zero-BDD, plan-gate removal) are aggregated by `aggregateMethodology`, which
// consumes the classified raw entries and returns full entry records.
//
// ESM only. Zero npm deps. node: builtins via shared modules only.

import { PRACTICES_LIMITS } from './model.mjs';
import { slugToken } from './style.mjs';

function basenameOf(path) {
  const parts = String(path).split('/');
  return parts[parts.length - 1] ?? '';
}

function capCount(value) {
  return Math.min(value, PRACTICES_LIMITS.maxCount);
}

function addKinds(target, ...tokens) {
  for (const token of tokens) {
    if (token !== null && token.length > 0 && !target.has(token)) target.add(token);
  }
}

function kindsOf(set) {
  return [...set].toSorted().slice(0, PRACTICES_LIMITS.maxKinds);
}

// Acronym-aware camel-case slug for class names (TestFuzzSSEParser -> sse-parser).
function classSlug(value) {
  return String(value)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Suppression policy (a2, a9, d3, d9 block-gate sub-fact)
// ---------------------------------------------------------------------------

const SUPPRESSION_POLICY_SCRIPTS = new Set([
  'check_suppression_reasons.py',
  'check_suppressions.py',
]);

const OWNER_FIELD = /owner\s*:/i;
const REASON_FIELD = /reason\s*:/i;

/**
 * Extract suppression-policy facts from the suppression gate scripts: the
 * `owner:`/`reason:` justification requirement, tokeniser-based scanning, the
 * `file:line:type[:detail]` identity fingerprints, the block-new-unannotated
 * gate and the 0/1/2 exit-code taxonomy. Facts are tokenized; no suppression
 * text or fingerprints ever survive.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, kinds?, status? }]` records.
 */
export function extractSuppressionPolicy({ path, text = '' }) {
  const base = basenameOf(String(path).toLowerCase());
  if (!SUPPRESSION_POLICY_SCRIPTS.has(base)) return [];
  const source = String(text ?? '');
  const policyKinds = new Set();
  if (/tokeni[sz]/i.test(source)) addKinds(policyKinds, 'tokeniser-scan');
  if (/grandfather/i.test(source)) addKinds(policyKinds, 'grandfathered-baseline');
  if (/--update-baseline/.test(source)) addKinds(policyKinds, 'update-baseline');
  if (base === 'check_suppression_reasons.py') {
    if (OWNER_FIELD.test(source)) addKinds(policyKinds, 'owner-required');
    if (REASON_FIELD.test(source)) addKinds(policyKinds, 'reason-required');
    if (/block[s]?\s+new|new\s+suppression/i.test(source)) addKinds(policyKinds, 'block-new-unannotated');
    if (/file:line:type/.test(source)) addKinds(policyKinds, 'file-line-type');
  }
  if (base === 'check_suppressions.py') {
    if (/file:line:type\[:detail\]/.test(source)) addKinds(policyKinds, 'file-line-type-detail');
    if (/new,\s*moved,\s*or\s*broadened/i.test(source)) addKinds(policyKinds, 'block-new-moved-broadened');
    if (/identity/i.test(source)) addKinds(policyKinds, 'identity-fingerprint');
  }
  const records = [];
  if (policyKinds.size > 0) records.push({ kind: 'suppression-policy', kinds: kindsOf(policyKinds) });
  if (/\bExit codes?\b/i.test(source)) {
    records.push({ kind: 'suppression-exit-code', kinds: ['fail-1', 'pass-0', 'tool-error-2'] });
  }
  return records;
}

/**
 * Report the grandfathered-baseline identity count from the suppression
 * baseline JSON (current-state only; refresh history is out of scope per
 * A007). Raw fingerprint strings never survive.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count? }]` records.
 */
export function extractSuppressionBaseline({ path, text = '' }) {
  if (basenameOf(String(path).toLowerCase()) !== 'suppressions.json') return [];
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ''));
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const fingerprints = Array.isArray(parsed.fingerprints) ? parsed.fingerprints : [];
  if (fingerprints.length === 0) return [];
  return [{ kind: 'suppression-baseline', count: capCount(fingerprints.length) }];
}

// ---------------------------------------------------------------------------
// Ratchet mechanics (a9, d3)
// ---------------------------------------------------------------------------

const RATCHET_BASENAME = '_ratchet.py';

/**
 * Extract ratchet-mechanics facts from the shared ratchet helper: the
 * fingerprint-diff and counts-diff engines, regression-blocking semantics,
 * shrink-allowed policy and the `--update-baseline` workflow.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, kinds? }]` records.
 */
export function extractRatchet({ path, text = '' }) {
  if (basenameOf(String(path).toLowerCase()) !== RATCHET_BASENAME) return [];
  const source = String(text ?? '');
  const kinds = new Set();
  if (/def diff_fingerprints/.test(source)) addKinds(kinds, 'fingerprint-diff');
  if (/def diff_counts/.test(source)) addKinds(kinds, 'counts-diff');
  if (/def diff_fingerprints/.test(source) || /def diff_counts/.test(source)) {
    addKinds(kinds, 'regression-blocking');
  }
  if (/shrink/i.test(source)) addKinds(kinds, 'shrink-allowed');
  if (/--update-baseline/.test(source)) addKinds(kinds, 'update-baseline');
  if (/quality\s*[/\\]\s*baselines/i.test(source)) addKinds(kinds, 'baseline-dir');
  if (kinds.size === 0) return [];
  return [{ kind: 'ratchet-engine', kinds: kindsOf(kinds) }];
}

// ---------------------------------------------------------------------------
// Mutation policy (a15)
// ---------------------------------------------------------------------------

const MUTATION_EXIT_LINE = /^EXIT_([A-Za-z0-9_]+)\s*:\s*int\s*=\s*(\d{1,6})\s*$/gm;
const MUTATION_ACTIONABLE_SET = /frozenset(?:\[[^\]]*\])?\s*\(\s*\{([^}]*)\}/;
const MUTATION_CRON_LINE = /cron:\s*['"]([^'"]+)['"]/;

/**
 * Extract mutation-policy facts: the 0/1/2 exit-code taxonomy and actionable
 * categories from `scripts/mutation_policy.py`, the weekly schedule from the
 * scheduled workflow cron, and the diff-vs-full scope from the Makefile
 * targets. Waivers-unsupported is inferred when the policy text carries no
 * waiver/exemption mechanism.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds?, status? }]` records.
 */
export function extractMutationPolicy({ path, text = '' }) {
  const lower = String(path).toLowerCase();
  const base = basenameOf(lower);
  const source = String(text ?? '');
  const records = [];

  if (base === 'mutation_policy.py') {
    const exitCodes = [];
    for (const match of source.matchAll(MUTATION_EXIT_LINE)) {
      const slug = slugToken(match[1].toLowerCase().replace(/_+/g, '-'));
      if (slug !== null) exitCodes.push(`${slug}-${match[2]}`);
    }
    if (exitCodes.length > 0) {
      records.push({ kind: 'mutation-exit-code', kinds: exitCodes.slice(0, PRACTICES_LIMITS.maxKinds) });
    }
    const actionable = [];
    const setMatch = source.match(MUTATION_ACTIONABLE_SET);
    if (setMatch !== null) {
      for (const token of setMatch[1].matchAll(/["']([^"']+)["']/g)) {
        const slug = slugToken(token[1]);
        if (slug !== null && !actionable.includes(slug)) actionable.push(slug);
      }
    }
    if (actionable.length > 0) {
      records.push({ kind: 'mutation-actionable', kinds: actionable.toSorted() });
    }
    if (!/waiver|wavier|exempt/i.test(source)) {
      records.push({ kind: 'mutation-waivers', kinds: ['unsupported'], status: 'inferred' });
    }
  }

  if (base === 'mutation-scheduled.yml') {
    const kinds = new Set();
    const cron = source.match(MUTATION_CRON_LINE)?.[1] ?? '';
    if (/^0\s+2\s+\*\s+\*\s+0$/.test(cron)) addKinds(kinds, 'weekly-sunday-0200-utc');
    if (/full\s+mutation/i.test(source)) addKinds(kinds, 'full-policy');
    if (kinds.size > 0) records.push({ kind: 'mutation-schedule', kinds: kindsOf(kinds) });
  }

  if (base === 'makefile' || base === 'gnumakefile') {
    const scope = new Set();
    if (/^mutate-diff:/m.test(source)) addKinds(scope, 'diff');
    if (/^mutate-full-policy:/m.test(source)) addKinds(scope, 'full');
    if (scope.size > 0) records.push({ kind: 'mutation-scope', kinds: kindsOf(scope) });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Fuzz replay contract and decomposition (a12)
// ---------------------------------------------------------------------------

const FUZZ_CLASS_DECORATOR = /@pytest\.mark\.fuzz\s*\n\s*class\s+(\w+)/g;
const FUZZ_ITERATIONS_LINE = /_FUZZ_ITERATIONS\s*=\s*([\d_]+)/;

/**
 * Extract fuzz facts: the replay contract (lexicographic seed order,
 * authoritative failure semantics, JSON state file) and seed count from the
 * corpus README; the class/test decomposition and iteration budget from
 * `tests/test_fuzz.py`; the atheris platform gate from pyproject.toml; and the
 * blocking CI status from the Makefile.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds?, status? }]` records.
 */
export function extractFuzzReplay({ path, text = '' }) {
  const lower = String(path).toLowerCase();
  const base = basenameOf(lower);
  const source = String(text ?? '');
  const records = [];

  if (lower.includes('fuzz_corpus') && base === 'readme.md') {
    const kinds = new Set();
    if (/lexicographic/i.test(source)) addKinds(kinds, 'lexicographic-seed-order');
    if (/authoritative/i.test(source)) addKinds(kinds, 'authoritative-failure');
    if (/JSON state file/.test(source)) addKinds(kinds, 'json-state-file');
    if (kinds.size > 0) records.push({ kind: 'fuzz-replay-contract', kinds: kindsOf(kinds) });
    const seedRows = source.match(/^\|\s*`?[a-z0-9_]+\.bin/gm) ?? [];
    if (seedRows.length > 0) records.push({ kind: 'fuzz-seeds', count: capCount(seedRows.length) });
  }

  if (base === 'test_fuzz.py') {
    const testCount = (source.match(/^\s*def test_fuzz_/gm) ?? []).length;
    const classNames = [];
    for (const match of source.matchAll(FUZZ_CLASS_DECORATOR)) {
      const slug = classSlug(match[1].replace(/^TestFuzz/i, ''));
      if (slug.length > 0) classNames.push(slug);
    }
    if (testCount > 0 || classNames.length > 0) {
      records.push({
        kind: 'fuzz-decomposition',
        count: capCount(testCount),
        kinds: classNames.toSorted().slice(0, PRACTICES_LIMITS.maxKinds),
        status: 'inferred',
      });
    }
    const iterations = source.match(FUZZ_ITERATIONS_LINE)?.[1];
    if (iterations !== undefined) {
      const value = parseInt(iterations.replace(/_/g, ''), 10);
      if (Number.isSafeInteger(value) && value > 0) {
        records.push({ kind: 'fuzz-iterations', count: capCount(value) });
      }
    }
    if (/authoritative/i.test(source)) {
      records.push({ kind: 'fuzz-ci-blocking', kinds: ['authoritative'], status: 'inferred' });
    }
  }

  if (base === 'pyproject.toml') {
    if (/atheris[\s\S]{0,120}sys_platform\s*==\s*['"]linux['"][\s\S]{0,80}x86_64/i.test(source)) {
      records.push({ kind: 'fuzz-platform-gate', kinds: ['atheris', 'linux-x86-64'] });
    }
  }

  if (base === 'makefile' || base === 'gnumakefile') {
    if (/^ci-fuzz-status:/m.test(source)) {
      records.push({ kind: 'fuzz-ci-blocking', kinds: ['blocking', 'ci-fuzz-status'], status: 'inferred' });
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// Make/workflow policy validators (d7)
// ---------------------------------------------------------------------------

const POLICY_VALIDATOR_SCRIPTS = new Set([
  'validate_make_policy.py',
  'validate_workflow_policy.py',
]);

/**
 * Extract policy-validation facts: the make target-ownership/prerequisite
 * validator, the workflow-policy validator (strict mode, YAML 1.2 semantics,
 * SHA pinning, forbidden trigger), and the actionlint wiring from the
 * Makefile targets.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, kinds? }]` records.
 */
export function extractPolicyValidators({ path, text = '' }) {
  const lower = String(path).toLowerCase();
  const base = basenameOf(lower);
  const source = String(text ?? '');
  const kinds = new Set();

  if (base === 'validate_make_policy.py') {
    addKinds(kinds, 'make-policy');
    if (/target ownership/i.test(source)) addKinds(kinds, 'target-ownership');
    if (/prerequisite/i.test(source)) addKinds(kinds, 'prerequisite-policy');
  }
  if (base === 'validate_workflow_policy.py') {
    addKinds(kinds, 'workflow-policy');
    if (/--strict/.test(source)) addKinds(kinds, 'strict-mode');
    if (/YAML 1\.2|ruamel/i.test(source)) addKinds(kinds, 'yaml-1-2-semantic');
    if (/40-character SHA|SHA_PATTERN/.test(source)) addKinds(kinds, 'sha-pinning');
    if (/pull_request_target/.test(source)) addKinds(kinds, 'pull-request-target-forbidden');
  }
  if (base === 'makefile' || base === 'gnumakefile') {
    if (/^actionlint:/m.test(source)) addKinds(kinds, 'actionlint');
    if (/^make-policy:/m.test(source)) addKinds(kinds, 'make-policy');
    if (/^workflow-policy:/m.test(source)) addKinds(kinds, 'workflow-policy-strict');
  }
  if (base === 'makefile' || base === 'gnumakefile' || POLICY_VALIDATOR_SCRIPTS.has(base)) {
    if (/\bExit codes?\b/i.test(source) || base === 'makefile') {
      if (base !== 'makefile') addKinds(kinds, 'exit-0-pass', 'exit-1-fail', 'exit-2-usage');
    }
  }

  if (kinds.size === 0) return [];
  return [{ kind: 'policy-validator', kinds: kindsOf(kinds) }];
}

// ---------------------------------------------------------------------------
// Analyser-contract registry (d8)
// ---------------------------------------------------------------------------

const ANALYSER_CONTRACTS_PATH = 'quality/analyser-contracts.toml';

/**
 * Extract analyser-contract registry facts: the analyser count, schema
 * version, statuses and modelled states from `quality/analyser-contracts.toml`
 * plus the `--validate` schema-only mode from the contract checker and its
 * Make target wiring.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds? }]` records.
 */
export function extractAnalyserContracts({ path, text = '' }) {
  const lower = String(path).toLowerCase();
  const base = basenameOf(lower);
  const source = String(text ?? '');
  const records = [];

  if (lower === ANALYSER_CONTRACTS_PATH) {
    const analyserCount = (source.match(/\[\[analysers\]\]/g) ?? []).length;
    if (analyserCount > 0) {
      const kinds = new Set();
      if (/version\s*=\s*1\b/.test(source)) addKinds(kinds, 'schema-v1');
      if (/status\s*=\s*"active"/.test(source)) addKinds(kinds, 'active');
      if (/status\s*=\s*"pending"/.test(source)) addKinds(kinds, 'pending');
      if (/\[analysers\.states\.clean\]/.test(source)) addKinds(kinds, 'clean-state');
      if (/\[analysers\.states\.findings\]|states\.findings\]/.test(source)) addKinds(kinds, 'findings-state');
      if (/\[analysers\.states\.regression\]|states\.regression\]/.test(source)) addKinds(kinds, 'regression-state');
      records.push({ kind: 'analyser-contract-registry', count: capCount(analyserCount), kinds: kindsOf(kinds) });
    }
  }

  if (base === 'check_analyser_contracts.py') {
    const kinds = new Set();
    if (/--validate/.test(source)) addKinds(kinds, 'validate-mode');
    if (/--run/.test(source)) addKinds(kinds, 'run-mode');
    if (/--pending-ok/.test(source)) addKinds(kinds, 'pending-ok');
    if (kinds.size > 0) records.push({ kind: 'analyser-contract-validate', kinds: kindsOf(kinds) });
  }

  if (base === 'makefile' || base === 'gnumakefile') {
    const kinds = new Set();
    if (/^analyser-contract-validate:/m.test(source)) addKinds(kinds, 'validate-target');
    if (/^analyser-contract-tests:/m.test(source)) addKinds(kinds, 'contract-tests');
    if (kinds.size > 0) records.push({ kind: 'analyser-contract-validate', kinds: kindsOf(kinds) });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Agent-workflow content: the 20-rule conventions block (tokenized), plugin
// behaviour markers, npm check script, vitest coverage thresholds
// ---------------------------------------------------------------------------

const CONVENTIONS_BLOCK_HEADER = /const\s+CONVENTIONS_BLOCK\s*=\s*`([\s\S]*?)(?<!\\)`;/;
const CONVENTIONS_RULE_LINE = /^\s*(\d{1,2})\.\s+([^\r\n]+)$/gm;

// Rule-id matchers for the injected 20-rule conventions block (A008: rule IDs,
// never verbatim prose). Each maps a distinctive keyword to a canonical rule
// id.
const CONVENTIONS_RULE_MATCHERS = Object.freeze([
  [/cyclomatic complexity\s*<=\s*5/i, 'complexity-le-5'],
  [/maximum\s+4\s+parameters/i, 'max-4-params'],
  [/google-style\s+docstrings/i, 'google-style-docstrings'],
  [/type\s+annotations\s+on\s+all\s+function\s+signatures/i, 'type-annotations'],
  [/type_checking[\s\S]{0,80}from\s+__future__\s+import\s+annotations/i, 'future-annotations'],
  [/\blazy\s+formatting/i, 'percent-s-lazy-logging'],
  [/\blogger\b[\s\S]{0,30}not\s+\\?`print/i, 'logger-not-print'],
  [/never\s+log\s+tokens/i, 'no-log-secrets'],
  [/never\s+bare\s+\\?`except/i, 'no-bare-except'],
  [/raise\s+X\s+from\s+Y/i, 'raise-with-from'],
  [/never\s+use\s+\\?`eval\(\)/i, 'no-eval-exec'],
  [/subprocess[\s\S]{0,40}shell\s*=\s*true/i, 'no-shell-true'],
  [/hardcode\s+passwords/i, 'no-hardcoded-secrets'],
  [/security-sensitive\s+randomness/i, 'secrets-module'],
  [/single-letter\s+variables/i, 'single-letter-var-allowlist'],
  [/wildcard\s+imports/i, 'no-wildcard-import'],
  [/\bis\s+none\b/i, 'is-none-not-eq-none'],
  [/commented-out\s+code/i, 'no-commented-out-code'],
  [/british\s+english/i, 'british-english'],
  [/minimum\s+version\s+floors/i, 'version-floors'],
]);

const QUALITY_CHECK_FUNCTIONS = Object.freeze([
  [/async function checkRuff\b/, 'ruff'],
  [/async function checkRadon\b/, 'radon'],
  [/async function checkBandit\b/, 'bandit'],
  [/async function checkTy\b/, 'ty'],
  [/async function checkSafety\b/, 'safety'],
  [/async function checkSemgrep\b/, 'semgrep'],
  [/async function checkPyright\b/, 'pyright'],
]);

const QUALITY_GATE_LABELS = Object.freeze([
  [/--exclude\b/, '--exclude'],
  [/--exclude-rule\b/, '--exclude-rule'],
  [/#\s*nosec/i, 'nosec'],
  [/pragma:\s*no\s*cover/i, 'pragma-no-cover'],
  [/#\s*type:\s*ignore/i, 'type-ignore'],
]);

const NPM_RUN_SCRIPT = /npm run ([A-Za-z0-9:_-]+)/g;
const VITEST_THRESHOLD = /^\s*(\w+):\s*(\d+),/gm;

function collectConventionsRuleIds(source) {
  const block = source.match(CONVENTIONS_BLOCK_HEADER)?.[1] ?? '';
  if (block.length === 0) return null;
  const ruleCount = (block.match(CONVENTIONS_RULE_LINE) ?? []).length;
  const ids = new Set();
  for (const [pattern, id] of CONVENTIONS_RULE_MATCHERS) {
    if (pattern.test(block)) ids.add(id);
  }
  return { ruleCount, ids };
}

/**
 * Extract agent-workflow content from `.opencode` artifacts: the 20-rule
 * conventions block (count + tokenized rule ids), the reactive quality-check
 * toolset, the quality-gate blocking behaviours and human override, the
 * pre-push docs first-push block, the npm `check` script composition and the
 * vitest per-file coverage thresholds. No verbatim rule prose survives.
 * @param {object} input - `{ path, text }`.
 * @returns {object[]} `[{ kind, count?, kinds?, status? }]` records.
 */
export function extractPluginContent({ path, text = '' }) {
  const lower = String(path).toLowerCase();
  const base = basenameOf(lower);
  const source = String(text ?? '');
  const records = [];

  if (lower.startsWith('.opencode/plugins/') && lower.endsWith('.ts')) {
    if (base === 'pxcli-quality.ts') {
      const block = collectConventionsRuleIds(source);
      if (block !== null && block.ids.size > 0) {
        records.push({
          kind: 'conventions-block',
          count: capCount(block.ruleCount),
          kinds: [...block.ids].toSorted().slice(0, PRACTICES_LIMITS.maxKinds),
        });
      }
      const tools = new Set();
      for (const [pattern, id] of QUALITY_CHECK_FUNCTIONS) {
        if (pattern.test(source)) tools.add(id);
      }
      if (/session\.idle/.test(source)) tools.add('session-idle');
      if (tools.size > 0) {
        records.push({ kind: 'quality-check-tools', kinds: kindsOf(tools) });
      }
    }
    if (base === 'quality-gate.ts') {
      const blocking = new Set();
      if (/BYPASS_PATTERNS/.test(source)) blocking.add('bypass-pattern');
      for (const [pattern, label] of QUALITY_GATE_LABELS) {
        if (pattern.test(source)) blocking.add(label);
      }
      if (/loweredSeverity|severity level/i.test(source)) blocking.add('severity-lowering');
      if (/GATE_REFERENCES/.test(source)) blocking.add('gate-reference-removal');
      if (/tool\.execute\.before/.test(source)) blocking.add('blocking');
      if (blocking.size > 0) {
        records.push({ kind: 'quality-gate-blocking', kinds: kindsOf(blocking) });
      }
      if (/OPENCODE_DISABLE_QUALITY_GATE/.test(source)) {
        records.push({ kind: 'quality-gate-override', kinds: ['override-env:opencode-disable-quality-gate'] });
      }
    }
    if (base === 'pre-push-docs-check.ts') {
      const kinds = new Set();
      if (/first recognised push|First recognised|first.*push attempt/i.test(source)) {
        addKinds(kinds, 'first-push-block');
      }
      if (/verify that documentation|documentation review/i.test(source)) {
        addKinds(kinds, 'docs-review-reminder');
      }
      if (kinds.size > 0) records.push({ kind: 'pre-push-docs-block', kinds: kindsOf(kinds) });
    }
  }

  if (lower === '.opencode/package.json') {
    const scripts = new Set();
    for (const match of source.matchAll(NPM_RUN_SCRIPT)) {
      const slug = slugToken(match[1].replace(/:+/g, '-'));
      if (slug !== null) scripts.add(slug);
    }
    if (/check-config\.ts/.test(source)) scripts.add('config-validation');
    if (scripts.size > 0) records.push({ kind: 'npm-check-script', kinds: kindsOf(scripts) });
  }

  if (lower === '.opencode/vitest.config.ts') {
    const thresholds = new Set();
    for (const match of source.matchAll(VITEST_THRESHOLD)) {
      const name = slugToken(match[1]);
      if (name !== null && ['lines', 'statements', 'functions', 'branches'].includes(name)) {
        thresholds.add(`${name}-${match[2]}`);
      }
    }
    if (/perFile:\s*true/.test(source)) thresholds.add('per-file');
    if (thresholds.size > 0) records.push({ kind: 'coverage-thresholds', kinds: kindsOf(thresholds) });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Cross-file methodology aggregation (a3, a25)
// ---------------------------------------------------------------------------

/**
 * Aggregate cross-file methodology facts from the classified raw entries:
 * CSM planning (at least one `agent_workflow:csm-plan` artifact), the
 * deliberate zero-BDD stance (no `methodology:bdd-feature` artifacts in a
 * CSM-planned repository), and plan-gate removal certified by the
 * `methodology:plan-gate-meta-test` artifact. Returns full entry records.
 * @param {object[]} entries - raw practice records (already classified).
 * @returns {object[]} full `{ category, kind, path, count?, kinds?, status? }`
 *   entry records.
 */
export function aggregateMethodology(entries) {
  const csmCount = entries.filter((entry) => (
    typeof entry.category === 'string' && entry.category === 'agent_workflow'
    && typeof entry.matchedKey === 'string' && entry.matchedKey.startsWith('agent_workflow:csm-plan:')
  )).length;
  const bddCount = entries.filter((entry) => (
    typeof entry.category === 'string' && entry.category === 'methodology'
    && typeof entry.matchedKey === 'string' && entry.matchedKey.startsWith('methodology:bdd-feature:')
  )).length;
  const hasPlanGateMetaTest = entries.some((entry) => (
    typeof entry.category === 'string' && entry.category === 'methodology'
    && typeof entry.matchedKey === 'string'
    && entry.matchedKey.startsWith('methodology:plan-gate-meta-test:')
  ));
  const records = [];
  if (csmCount > 0) {
    records.push({
      category: 'methodology',
      kind: 'csm-planning',
      path: '.agents/plans',
      count: csmCount,
      status: 'inferred',
    });
    if (bddCount === 0) {
      records.push({
        category: 'methodology',
        kind: 'no-bdd',
        path: '.agents/plans',
        kinds: ['no-bdd'],
        status: 'inferred',
      });
    }
  }
  if (hasPlanGateMetaTest) {
    records.push({
      category: 'methodology',
      kind: 'plan-gate-removed',
      path: 'tests/test_removed_plan_gate.py',
      kinds: ['meta-test-certified'],
      status: 'inferred',
    });
  }
  return records;
}
