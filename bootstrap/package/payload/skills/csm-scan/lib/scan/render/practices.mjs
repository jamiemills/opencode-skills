// Development Practices dimension — inert renderer.
//
// T004 owns this module. It renders the deep-frozen practices model as a
// neutral Markdown section. It is deliberately INERT: it exports a factory
// (`createPracticesRenderer`) and a render function, but it is never
// registered in the existing-ten renderer map and nothing in the pipeline,
// CLI, enrich, validate, or write path dispatches it. Activation happens at
// the expanded-pipeline cutover (T224).
//
// Voice and privacy discipline: practices are reported from committed
// declarations and measured lexical signals only, never as verdicts on code
// quality or team culture. Entries render as category-grouped lists of
// repo-relative artifact paths with counts, plus a Style Guide & Conventions
// block carrying the bounded style facts (ruff rules, line length, dialect,
// make targets, hook stages, gate thresholds, deny rules, plugins, declared
// convention headings, exceptions hub). Values render backticked or in table
// value cells so the neutral-voice gate never flags them, and all
// user-derived strings pass through the shared render context's `escapeField`
// privacy hook.
//
// ESM only. Zero npm deps. Pure DATA; no filesystem or side effects.

import { compareAscii } from '../contracts/evidence.mjs';
import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

const CATEGORY_SECTIONS = Object.freeze([
  { category: 'methodology', heading: 'Methodology' },
  { category: 'enforcement', heading: 'Enforcement' },
  { category: 'automation', heading: 'Automation' },
  { category: 'ritual', heading: 'Ritual' },
  { category: 'quality_gate', heading: 'Quality Gates' },
  { category: 'agent_workflow', heading: 'Agent Workflow' },
  { category: 'style_guide', heading: 'Style Guide' },
]);

const CAP_LABELS = Object.freeze({
  entries: 'inventory entry total capped',
  files: 'file read cap reached',
  diagnostics: 'diagnostic list capped',
});

function completeSearchSpace(space) {
  return space !== null && typeof space === 'object'
    && space.complete === true
    && space.supported === true
    && space.readable === true
    && space.capped === false
    && space.error === false
    && space.malformed === false;
}

function summaryLine(model, escapeField) {
  const summary = model.summary ?? {};
  const filesInspected = Number.isSafeInteger(summary.filesInspected)
    ? String(summary.filesInspected)
    : '0';
  const gitNote = summary.isGit === true
    ? ` in a git repository${typeof summary.defaultBranch === 'string' && summary.defaultBranch.length > 0 ? ` (default branch \`${escapeField(summary.defaultBranch)}\`)` : ''}`
    : '';
  return `Declaration-backed inventory of committed development-practice declarations and measured signals across ${escapeField(filesInspected)} inspected file(s)${gitNote}.`;
}

function capNotes(model) {
  const notes = [];
  const capped = model.summary?.capped;
  if (capped === null || typeof capped !== 'object') return notes;
  const known = new Set(Object.keys(CAP_LABELS));
  for (const [key, label] of Object.entries(CAP_LABELS)) {
    if (capped[key] === true) notes.push(label);
  }
  for (const key of Object.keys(capped)) {
    if (!known.has(key) && capped[key] === true) notes.push(`${key} count capped`);
  }
  return notes;
}

function entryPath(entry) {
  if (typeof entry.path === 'string' && entry.path.length > 0) return entry.path;
  if (typeof entry.source?.path === 'string' && entry.source.path.length > 0) return entry.source.path;
  return null;
}

// T006 behaviour facts: the policy-content and agent-workflow facts rendered as
// behaviour lines inside their category groups. `noun` facts pair a count with
// a kind list; `noun: null` facts carry a bare count; `valueOnly` facts carry
// only kind tokens.
const BEHAVIOUR_FACTS = Object.freeze([
  { category: 'methodology', kind: 'csm-planning', heading: 'CSM planning', noun: 'plan' },
  { category: 'methodology', kind: 'no-bdd', heading: 'BDD', valueOnly: true },
  { category: 'methodology', kind: 'plan-gate-removed', heading: 'Plan gate removal', valueOnly: true },
  { category: 'methodology', kind: 'fuzz-replay-contract', heading: 'Fuzz replay contract', valueOnly: true },
  { category: 'methodology', kind: 'fuzz-seeds', heading: 'Fuzz seeds', noun: 'seed' },
  { category: 'methodology', kind: 'fuzz-decomposition', heading: 'Fuzz decomposition', noun: 'test' },
  { category: 'methodology', kind: 'fuzz-iterations', heading: 'Fuzz iterations', noun: null },
  { category: 'methodology', kind: 'fuzz-platform-gate', heading: 'Fuzz platform gate', valueOnly: true },
  { category: 'methodology', kind: 'fuzz-ci-blocking', heading: 'Fuzz CI', valueOnly: true },
  { category: 'enforcement', kind: 'policy-validator', heading: 'Policy validators', valueOnly: true },
  { category: 'quality_gate', kind: 'suppression-policy', heading: 'Suppression policy', valueOnly: true },
  { category: 'quality_gate', kind: 'suppression-exit-code', heading: 'Suppression exit codes', valueOnly: true },
  { category: 'quality_gate', kind: 'suppression-baseline', heading: 'Suppression baseline', noun: 'identity', plural: 'identities' },
  { category: 'quality_gate', kind: 'ratchet-engine', heading: 'Ratchet engine', valueOnly: true },
  { category: 'quality_gate', kind: 'mutation-exit-code', heading: 'Mutation exit codes', valueOnly: true },
  { category: 'quality_gate', kind: 'mutation-actionable', heading: 'Mutation actionable', valueOnly: true },
  { category: 'quality_gate', kind: 'mutation-waivers', heading: 'Mutation waivers', valueOnly: true },
  { category: 'quality_gate', kind: 'mutation-scope', heading: 'Mutation scope', valueOnly: true },
  { category: 'quality_gate', kind: 'mutation-schedule', heading: 'Mutation schedule', valueOnly: true },
  { category: 'quality_gate', kind: 'analyser-contract-registry', heading: 'Analyser contract registry', noun: 'analyser' },
  { category: 'quality_gate', kind: 'analyser-contract-validate', heading: 'Analyser contract validation', valueOnly: true },
  { category: 'agent_workflow', kind: 'conventions-block', heading: 'Enforced conventions block', noun: 'rule' },
  { category: 'agent_workflow', kind: 'quality-check-tools', heading: 'Reactive quality checks', valueOnly: true },
  { category: 'agent_workflow', kind: 'quality-gate-blocking', heading: 'Quality gate blocking', valueOnly: true },
  { category: 'agent_workflow', kind: 'quality-gate-override', heading: 'Quality gate override', valueOnly: true },
  { category: 'agent_workflow', kind: 'pre-push-docs-block', heading: 'Pre-push docs block', valueOnly: true },
  { category: 'agent_workflow', kind: 'npm-check-script', heading: 'npm check', valueOnly: true },
  { category: 'agent_workflow', kind: 'coverage-thresholds', heading: 'Coverage thresholds', valueOnly: true },
]);

const BEHAVIOUR_KINDS = new Set(BEHAVIOUR_FACTS.map((fact) => fact.kind));

function entryKind(entry) {
  const remainder = entry.matchedKey.slice(entry.matchedKey.indexOf(':') + 1);
  const colon = remainder.indexOf(':');
  return colon === -1 ? remainder : remainder.slice(0, colon);
}

// Group entries by category into a canonical-ordered list of category groups,
// each holding the count of distinct repo-relative paths and that sorted path
// list. Categories outside the canonical set follow in ASCII order so the
// section stays deterministic for any model the scanner produces.
function categoryGroups(model) {
  const groups = new Map();
  for (const entry of Array.isArray(model.entries) ? model.entries : []) {
    if (entry === null || typeof entry !== 'object' || typeof entry.category !== 'string') continue;
    if (BEHAVIOUR_KINDS.has(entryKind(entry))) continue;
    const path = entryPath(entry);
    if (path === null) continue;
    if (!groups.has(entry.category)) groups.set(entry.category, new Set());
    groups.get(entry.category).add(path);
  }
  const knownCategories = CATEGORY_SECTIONS.map((section) => section.category);
  const canonical = knownCategories.filter((category) => groups.has(category));
  const remaining = [...groups.keys()].filter((category) => !knownCategories.includes(category)).toSorted(compareAscii);
  return [...canonical, ...remaining].map((category) => {
    const section = CATEGORY_SECTIONS.find((entry) => entry.category === category);
    const paths = [...groups.get(category)].toSorted(compareAscii);
    return {
      category,
      heading: section?.heading ?? category,
      count: paths.length,
      paths,
    };
  });
}

function renderCategoryGroup(group, escapeField) {
  const lines = [];
  lines.push(`### ${group.heading} (${group.count})`);
  lines.push('');
  for (const path of group.paths) {
    lines.push(`- \`${escapeField(path)}\``);
  }
  lines.push('');
  return lines;
}

function behaviourFactEntries(model, fact) {
  return factEntries(model, fact.category, fact.kind)
    .filter((entry) => hasFactValue(fact, entry));
}

function renderBehaviourLines(model, category, escapeField) {
  const lines = [];
  for (const fact of BEHAVIOUR_FACTS) {
    if (fact.category !== category) continue;
    const entries = behaviourFactEntries(model, fact);
    for (const entry of entries) {
      const path = `\`${escapeField(entry.path)}\``;
      const kinds = kindTokenList(entry, escapeField);
      if (fact.valueOnly) {
        lines.push(`- **${fact.heading}**: ${path}: ${kinds}`);
        continue;
      }
      if (fact.noun === null) {
        lines.push(`- **${fact.heading}**: ${path}: ${entry.count}`);
        continue;
      }
      const label = pluralize(entry.count, fact.noun, fact.plural);
      lines.push(kinds.length > 0
        ? `- **${fact.heading}**: ${path}: ${label}: ${kinds}`
        : `- **${fact.heading}**: ${path}: ${label}`);
    }
  }
  if (lines.length > 0) lines.push('');
  return lines;
}

// Display cap for kind lists inside the Style Guide & Conventions block. The
// model may hold up to 256 kinds per entry; the block shows the first few and
// discloses the remainder numerically.
const STYLE_KIND_DISPLAY_CAP = 64;

// The value-carrying style facts rendered into the Style Guide & Conventions
// block, in canonical order. Each fact selects entries whose matchedKey begins
// with `<category>:<kind>:` and renders count and/or kinds. `valueOnly` facts
// carry a kind token as the value (no count); `noun` facts pair a count with a
// kind list.
const STYLE_FACTS = Object.freeze([
  { category: 'style_guide', kind: 'ruff-select', heading: 'Ruff rules', noun: 'code' },
  { category: 'style_guide', kind: 'ruff-ignore', heading: 'Ignored rule codes', noun: 'code' },
  { category: 'style_guide', kind: 'line-length', heading: 'Line length', noun: null },
  { category: 'style_guide', kind: 'docstring-dialect', heading: 'Docstring dialect', valueOnly: true },
  { category: 'style_guide', kind: 'quote-style', heading: 'Quote style', valueOnly: true },
  { category: 'automation', kind: 'make-targets', heading: 'Make targets', noun: 'target' },
  { category: 'automation', kind: 'make-check-toggles', heading: 'Check toggles', noun: 'toggle' },
  { category: 'automation', kind: 'make-ci-quality', heading: 'CI quality membership', noun: 'member' },
  { category: 'enforcement', kind: 'hook-stages', heading: 'Hook stages', noun: 'stage', plural: 'stages' },
  { category: 'enforcement', kind: 'hook-jobs', heading: 'Hook jobs', noun: 'job' },
  { category: 'agent_workflow', kind: 'deny-rules', heading: 'Deny rules', noun: 'rule' },
  { category: 'agent_workflow', kind: 'deny-rule-semantics', heading: 'Deny rule semantics', valueOnly: true },
  { category: 'agent_workflow', kind: 'opencode-plugins', heading: 'Plugin inventory', noun: 'plugin' },
  { category: 'quality_gate', kind: 'gates-header', heading: 'Gate policy', valueOnly: true },
  { category: 'style_guide', kind: 'declared-conventions', heading: 'Declared conventions', noun: 'heading' },
  { category: 'style_guide', kind: 'exceptions-hub', heading: 'Exceptions hub', noun: null },
  { category: 'style_guide', kind: 'exit-code-constant', heading: 'Exit code constants', noun: 'code' },
  { category: 'style_guide', kind: 'exit-code-exception', heading: 'Exception exit codes', noun: 'pair' },
  { category: 'style_guide', kind: 'exit-code-http', heading: 'HTTP status mapping', valueOnly: true },
]);

const GATE_VALUE_PREFIX = 'quality_gate:gate-value:';
const CHECK_TOGGLE_PREFIX = 'quality_gate:check-toggle:';
const HOOK_STAGE_PREFIX = 'enforcement:hook-stage:';

function factEntries(model, category, kind) {
  const prefix = `${category}:${kind}:`;
  return (Array.isArray(model.entries) ? model.entries : [])
    .filter((entry) => entry.category === category && entry.matchedKey.startsWith(prefix))
    .toSorted((left, right) => compareAscii(left.path, right.path));
}

function hasFactValue(fact, entry) {
  if (fact.valueOnly) return Array.isArray(entry.kinds) && entry.kinds.length > 0;
  return Number.isSafeInteger(entry.count);
}

function subkeyOf(matchedKey, prefix) {
  const remainder = matchedKey.slice(prefix.length);
  const colon = remainder.indexOf(':');
  return colon === -1 ? remainder : remainder.slice(0, colon);
}

function gateKey(entry) {
  return subkeyOf(entry.matchedKey, GATE_VALUE_PREFIX);
}

function gateValueEntries(model) {
  return (Array.isArray(model.entries) ? model.entries : [])
    .filter((entry) => entry.category === 'quality_gate' && entry.matchedKey.startsWith(GATE_VALUE_PREFIX))
    .toSorted((left, right) => compareAscii(gateKey(left), gateKey(right))
      || compareAscii(left.path, right.path));
}

function checkToggleKey(entry) {
  return subkeyOf(entry.matchedKey, CHECK_TOGGLE_PREFIX);
}

function checkToggleEntries(model) {
  return (Array.isArray(model.entries) ? model.entries : [])
    .filter((entry) => entry.category === 'quality_gate' && entry.matchedKey.startsWith(CHECK_TOGGLE_PREFIX))
    .toSorted((left, right) => compareAscii(checkToggleKey(left), checkToggleKey(right))
      || compareAscii(left.path, right.path));
}

function hookStageKey(entry) {
  return subkeyOf(entry.matchedKey, HOOK_STAGE_PREFIX);
}

function hookStageEntries(model) {
  return (Array.isArray(model.entries) ? model.entries : [])
    .filter((entry) => entry.category === 'enforcement' && entry.matchedKey.startsWith(HOOK_STAGE_PREFIX))
    .toSorted((left, right) => compareAscii(hookStageKey(left), hookStageKey(right))
      || compareAscii(left.path, right.path));
}

function pluralize(count, noun, plural) {
  return `${count} ${count === 1 ? noun : plural ?? `${noun}s`}`;
}

function kindTokenList(entry, _escapeField) {
  if (!Array.isArray(entry.kinds) || entry.kinds.length === 0) return '';
  const shown = entry.kinds.slice(0, STYLE_KIND_DISPLAY_CAP);
  const tokens = shown.map((token) => `\`${token}\``);
  const remaining = entry.kinds.length - shown.length;
  if (remaining > 0) tokens.push(`... (+${remaining} more)`);
  return tokens.join(', ');
}

function renderFactSection(fact, entries, escapeField) {
  const lines = [`#### ${fact.heading}`, ''];
  for (const entry of entries) {
    const path = `\`${escapeField(entry.path)}\``;
    const kinds = kindTokenList(entry, escapeField);
    if (fact.valueOnly) {
      lines.push(`- ${path}: ${kinds}`);
      continue;
    }
    if (fact.noun === null) {
      lines.push(`- ${path}: ${entry.count}`);
      continue;
    }
    const label = pluralize(entry.count, fact.noun, fact.plural);
    if (kinds.length === 0) {
      lines.push(`- ${path}: ${label}`);
      continue;
    }
    lines.push(`- ${path}: ${label}: ${kinds}`);
  }
  lines.push('');
  return lines;
}

function decodeValueToken(token) {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

function gateValueCell(entry, escapeField) {
  if (Number.isSafeInteger(entry.count)) return String(entry.count);
  if (Array.isArray(entry.kinds) && entry.kinds.length > 0) {
    const value = entry.kinds.map((token) => decodeValueToken(token)).join(' ');
    return `\`${escapeField(value, { inTable: true })}\``;
  }
  return '`present`';
}

function renderGateSection(entries, escapeField) {
  const lines = ['#### Gate thresholds', ''];
  lines.push('| Key | Value |');
  lines.push('|-----|-------|');
  for (const entry of entries) {
    const key = escapeField(gateKey(entry), { inTable: true });
    lines.push(`| ${key} | ${gateValueCell(entry, escapeField)} |`);
  }
  lines.push('');
  return lines;
}

function renderCheckToggleSection(entries, escapeField) {
  const lines = ['#### Gate check toggles', ''];
  lines.push('| Toggle | State |');
  lines.push('|--------|-------|');
  for (const entry of entries) {
    const key = escapeField(checkToggleKey(entry), { inTable: true });
    lines.push(`| ${key} | ${entry.count === 1 ? 'on' : 'off'} |`);
  }
  lines.push('');
  return lines;
}

function renderHookStageSection(entries, escapeField) {
  const lines = ['#### Hook stage pipeline', ''];
  for (const entry of entries) {
    const hook = escapeField(hookStageKey(entry));
    const kinds = kindTokenList(entry, escapeField);
    const label = `${entry.count} ${entry.count === 1 ? 'stage' : 'stages'}`;
    lines.push(kinds.length > 0
      ? `- \`${escapeField(entry.path)}\`: ${hook} (${label}: ${kinds})`
      : `- \`${escapeField(entry.path)}\`: ${hook} (${label})`);
  }
  lines.push('');
  return lines;
}

// Render the Style Guide & Conventions block: bounded counts, kind slugs,
// threshold values, check toggles and hook-stage pipelines on top of the
// category path inventory. The block is absent when no value-carrying style
// fact exists.
function renderStyleGuideBlock(model, escapeField) {
  const sections = [];
  for (const fact of STYLE_FACTS) {
    const entries = factEntries(model, fact.category, fact.kind)
      .filter((entry) => hasFactValue(fact, entry));
    if (entries.length === 0) continue;
    sections.push(...renderFactSection(fact, entries, escapeField));
  }
  const gates = gateValueEntries(model);
  if (gates.length > 0) sections.push(...renderGateSection(gates, escapeField));
  const toggles = checkToggleEntries(model);
  if (toggles.length > 0) sections.push(...renderCheckToggleSection(toggles, escapeField));
  const stages = hookStageEntries(model);
  if (stages.length > 0) sections.push(...renderHookStageSection(stages, escapeField));
  if (sections.length === 0) return [];
  return ['### Style Guide & Conventions', '', ...sections];
}

function renderDiagnostics(model, context) {
  if (!Array.isArray(model.diagnostics) || model.diagnostics.length === 0) return [];
  const { escapeField } = context;
  const lines = [];
  lines.push('### Diagnostics');
  lines.push('');
  const sorted = [...model.diagnostics].toSorted((left, right) => compareAscii(left.path, right.path)
    || compareAscii(left.reason, right.reason)
    || (left.line ?? 0) - (right.line ?? 0));
  for (const entry of sorted) {
    const location = entry.line === null || entry.line === undefined
      ? `\`${escapeField(entry.path)}\``
      : `\`${escapeField(entry.path)}:${entry.line}\``;
    lines.push(`- ${location}: ${escapeField(entry.reason)} (${escapeField(entry.status)})`);
  }
  lines.push('');
  return lines;
}

/**
 * Render the practices model as a neutral Markdown section.
 * @param {string} _repoName - repository name (unused; retained for the shared
 *   renderer signature).
 * @param {object} model - the deep-frozen practices model (`findings` from the
 *   scanner).
 * @param {object} context - render context from `render/base.mjs`.
 * @returns {string} The `## Development Practices` Markdown section.
 */
export function renderPractices(_repoName, model, context = DEFAULT_RENDER_CONTEXT) {
  if (!model || typeof model !== 'object') return '';
  const { escapeField } = context;
  const lines = [];
  lines.push('## Development Practices');
  lines.push('');
  lines.push(summaryLine(model, escapeField));
  lines.push('');

  const notes = capNotes(model);
  if (notes.length > 0) {
    lines.push(`- ${notes.join('; ')}.`);
    lines.push('');
  }

  const groups = categoryGroups(model);
  if (groups.length === 0 && completeSearchSpace(model.searchSpace)) {
    lines.push(`No development-practice artifacts detected in ${escapeField(String(model.searchSpace.filesInspected))} inspected file(s).`);
    lines.push('');
  }

  for (const group of groups) {
    lines.push(...renderCategoryGroup(group, escapeField));
    lines.push(...renderBehaviourLines(model, group.category, escapeField));
  }
  lines.push(...renderStyleGuideBlock(model, escapeField));
  lines.push(...renderDiagnostics(model, context));

  return lines.join('\n');
}

/**
 * Create an inert practices renderer. Never registered anywhere.
 * @param {object} options - `{ context }` render context override.
 * @returns {{ render: (model: object) => string }} A frozen renderer.
 */
export function createPracticesRenderer({ context = DEFAULT_RENDER_CONTEXT } = {}) {
  if (context === null || typeof context !== 'object' || typeof context.escapeField !== 'function') {
    throw new TypeError('createPracticesRenderer requires a render context with escapeField');
  }
  return Object.freeze({
    render(model) {
      return renderPractices('repository', model, context);
    },
  });
}
