// Development Practices dimension — inert renderer.
//
// T005 owns this module. It renders the deep-frozen practices model as a
// neutral Markdown section. It is deliberately INERT: it exports a factory
// (`createPracticesRenderer`) and a render function, but it is never
// registered in the existing-ten renderer map and nothing in the pipeline,
// CLI, enrich, validate, or write path dispatches it. Activation happens at
// the expanded-pipeline cutover (T011).
//
// Voice and privacy discipline: practices are reported from committed
// declarations and measured lexical signals only, never as verdicts on code
// quality or team culture. Entries render as category-grouped lists of
// repo-relative artifact paths with counts; no raw values, excerpts, or
// evaluative vocabulary appear in the output. All user-derived strings pass
// through the shared render context's `escapeField` privacy hook.
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

// Group entries by category into a canonical-ordered list of category groups,
// each holding the count of distinct repo-relative paths and that sorted path
// list. Categories outside the canonical set follow in ASCII order so the
// section stays deterministic for any model the scanner produces.
function categoryGroups(model) {
  const groups = new Map();
  for (const entry of Array.isArray(model.entries) ? model.entries : []) {
    if (entry === null || typeof entry !== 'object' || typeof entry.category !== 'string') continue;
    const path = entryPath(entry);
    if (path === null) continue;
    if (!groups.has(entry.category)) groups.set(entry.category, new Set());
    groups.get(entry.category).add(path);
  }
  const knownCategories = CATEGORY_SECTIONS.map((section) => section.category);
  const canonical = knownCategories.filter((category) => groups.has(category));
  const remaining = [...groups.keys()].filter((category) => !knownCategories.includes(category)).sort(compareAscii);
  return [...canonical, ...remaining].map((category) => {
    const section = CATEGORY_SECTIONS.find((entry) => entry.category === category);
    const paths = [...groups.get(category)].sort(compareAscii);
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

function renderDiagnostics(model, context) {
  if (!Array.isArray(model.diagnostics) || model.diagnostics.length === 0) return [];
  const { escapeField } = context;
  const lines = [];
  lines.push('### Diagnostics');
  lines.push('');
  const sorted = [...model.diagnostics].sort((left, right) => compareAscii(left.path, right.path)
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
  }
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
