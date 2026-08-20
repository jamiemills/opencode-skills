// Governance & Ownership dimension — inert renderer.
//
// T215 owns this module. It renders the deep-frozen governance model as a
// neutral Markdown section. It is deliberately INERT: it exports a factory
// (`createGovernanceRenderer`) and a render function, but it is never
// registered in the existing-ten renderer map and nothing in the pipeline,
// CLI, enrich, validate, or write path dispatches it. Activation happens at
// T223/T224.
//
// Voice and privacy discipline: ownership is reported from CODEOWNERS
// declarations only and is never inferred from commits; identities render as
// opaque report-local labels; dates and declared ADR statuses are reported as
// facts, never as verdicts; no effectiveness, freshness, or legal conclusions.
// All user-derived strings pass through the shared render context's
// `escapeField` privacy hook.
//
// ESM only. Zero npm deps. Pure DATA; no filesystem or side effects.

import { compareAscii } from '../contracts/evidence.mjs';
import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

const CATEGORY_SECTIONS = Object.freeze([
  { category: 'policy', heading: 'Policies' },
  { category: 'contribution', heading: 'Contribution' },
  { category: 'review', heading: 'Review' },
  { category: 'release', heading: 'Release' },
  { category: 'runbook', heading: 'Runbooks' },
  { category: 'support', heading: 'Support' },
  { category: 'funding', heading: 'Funding' },
]);

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
  const { summary } = model;
  const gitNote = summary.isGit
    ? ` in a git repository${summary.defaultBranch ? ` (default branch \`${escapeField(summary.defaultBranch)}\`)` : ''}`
    : '';
  return `Declaration-backed governance and ownership inventory across ${escapeField(String(summary.filesInspected))} inspected file(s)${gitNote}. Ownership is reported from CODEOWNERS declarations only and is never inferred from commits.`;
}

function capNotes(model) {
  const notes = [];
  const { capped } = model.summary;
  if (capped.entries) notes.push('inventory entry total capped');
  if (capped.rules) notes.push('CODEOWNERS rule total capped');
  if (capped.assignees) notes.push('assignee list capped');
  if (capped.links) notes.push('explicit link count capped');
  if (capped.files) notes.push('file read cap reached');
  if (capped.diagnostics) notes.push('diagnostic list capped');
  return notes;
}

function table(context, columns, rows) {
  const { escapeField } = context;
  const lines = [];
  lines.push(`| ${columns.map((column) => escapeField(column, { inTable: true })).join(' | ')} |`);
  lines.push(`| ${columns.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.map((cell) => escapeField(cell, { inTable: true })).join(' | ')} |`);
  }
  return lines.join('\n');
}

function evidenceCell(entry, escapeField) {
  const line = entry.source.line ?? '';
  return `\`${escapeField(entry.source.path)}${line ? `:${line}` : ''}\``;
}

function renderCodeowners(model, context) {
  const { escapeField } = context;
  const ownership = model.ownership;
  const lines = [];
  lines.push('### CODEOWNERS');
  lines.push('');
  lines.push(`- Files: ${escapeField(String(ownership.files))}`);
  lines.push(`- Patterns: ${escapeField(String(ownership.patterns))}`);
  lines.push(`- Assignees: ${escapeField(String(ownership.assigneeCount))} distinct report-local labels across ${escapeField(String(ownership.assignmentCount))} assignments.`);
  lines.push('');
  if (ownership.rules.length > 0) {
    lines.push(table(context, ['Pattern', 'Assigned labels', 'Evidence'],
      ownership.rules.map((rule) => [
        rule.anchored ? `/${rule.pattern}` : rule.pattern,
        rule.labels.join(', '),
        `\`${escapeField(rule.path)}:${rule.line}\``,
      ])));
    lines.push('');
  }
  if (ownership.assignees.length > 0) {
    lines.push(table(context, ['Report-local label', 'Assignments'],
      ownership.assignees.map((assignee) => [assignee.label, String(assignee.count)])));
    lines.push('');
  }
  return lines;
}

function renderAdr(model, context) {
  const decisions = model.entries
    .filter((entry) => entry.category === 'decision' && entry.details?.kind === 'adr')
    .toSorted((left, right) => compareAscii(left.details.id ?? '', right.details.id ?? '')
      || compareAscii(left.source.path, right.source.path));
  if (decisions.length === 0) return [];
  const lines = [];
  lines.push('### Architecture Decision Records');
  lines.push('');
  lines.push(table(context, ['ID', 'Declared status', 'Declared date', 'Evidence'],
    decisions.map((entry) => [
      entry.details.id ?? '—',
      entry.details.status ?? '—',
      entry.details.date ?? '—',
      evidenceCell(entry, context.escapeField),
    ])));
  lines.push('');
  return lines;
}

function renderCategoryEntries(category, model, context) {
  const entries = model.entries
    .filter((entry) => entry.category === category)
    .toSorted((left, right) => compareAscii(left.source.path, right.source.path));
  if (entries.length === 0) return [];
  const heading = CATEGORY_SECTIONS.find((entry) => entry.category === category)?.heading ?? category;
  const lines = [];
  lines.push(`### ${heading}`);
  lines.push('');
  lines.push(table(context, ['Artifact', 'Kind', 'Evidence'],
    entries.map((entry) => [entry.source.path, entry.details?.kind ?? entry.dialect, evidenceCell(entry, context.escapeField)])));
  lines.push('');
  return lines;
}

function renderReferences(model, context) {
  const references = model.entries
    .filter((entry) => entry.category === 'reference' && entry.details?.kind === 'link')
    .toSorted((left, right) => compareAscii(left.details.url, right.details.url)
      || compareAscii(left.source.path, right.source.path)
      || (left.source.line ?? 0) - (right.source.line ?? 0));
  if (references.length === 0) return [];
  const lines = [];
  lines.push('### References (explicit links)');
  lines.push('');
  lines.push(table(context, ['URL', 'Evidence'],
    references.map((entry) => [entry.details.url, evidenceCell(entry, context.escapeField)])));
  lines.push('');
  return lines;
}

function renderDiagnostics(model, context) {
  if (model.diagnostics.length === 0) return [];
  const { escapeField } = context;
  const lines = [];
  lines.push('### Diagnostics');
  lines.push('');
  for (const entry of model.diagnostics) {
    const location = entry.line === null
      ? `\`${escapeField(entry.path)}\``
      : `\`${escapeField(entry.path)}:${entry.line}\``;
    lines.push(`- ${location}: ${escapeField(entry.reason)} (${escapeField(entry.status)})`);
  }
  lines.push('');
  return lines;
}

/**
 * Render the governance model as a neutral Markdown section.
 * @param {string} _repoName - repository name (unused; retained for the shared
 *   renderer signature).
 * @param {object} model - the deep-frozen governance model (`findings` from the
 *   scanner).
 * @param {object} context - render context from `render/base.mjs`.
 * @returns {string} The `## Governance & Ownership` Markdown section.
 */
export function renderGovernance(_repoName, model, context = DEFAULT_RENDER_CONTEXT) {
  if (!model || typeof model !== 'object') return '';
  const { escapeField } = context;
  const lines = [];
  lines.push('## Governance & Ownership');
  lines.push('');
  lines.push(summaryLine(model, escapeField));
  lines.push('');

  const notes = capNotes(model);
  if (notes.length > 0) {
    lines.push(`- ${notes.join('; ')}.`);
    lines.push('');
  }

  if (model.summary.entries === 0 && completeSearchSpace(model.searchSpace)) {
    lines.push(`No governance or ownership artifacts detected in ${escapeField(String(model.searchSpace.filesInspected))} inspected file(s).`);
    lines.push('');
  }

  lines.push(...renderCodeowners(model, context));
  lines.push(...renderAdr(model, context));
  for (const { category } of CATEGORY_SECTIONS) {
    lines.push(...renderCategoryEntries(category, model, context));
  }
  lines.push(...renderReferences(model, context));
  lines.push(...renderDiagnostics(model, context));

  return lines.join('\n');
}

/**
 * Create an inert governance renderer. Never registered anywhere.
 * @param {object} options - `{ context }` render context override.
 * @returns {{ render: (model: object) => string }} A frozen renderer.
 */
export function createGovernanceRenderer({ context = DEFAULT_RENDER_CONTEXT } = {}) {
  if (context === null || typeof context !== 'object' || typeof context.escapeField !== 'function') {
    throw new TypeError('createGovernanceRenderer requires a render context with escapeField');
  }
  return Object.freeze({
    render(model) {
      return renderGovernance('repository', model, context);
    },
  });
}
