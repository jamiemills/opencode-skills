// Assurance & Supply Chain dimension — inert renderer.
//
// T216 owns this module. It is deliberately INERT: it exports a factory
// (`createAssuranceRenderer`) and a render function, but it is never registered
// in the existing-ten renderer map and nothing in the pipeline, CLI, enrich,
// validate, or write path dispatches it. Activation happens at T223/T224.
//
// Every rendered record references admissible evidence: each row carries the
// repo-relative artifact path. Standards references are described as metadata
// references to registered standards with a `metadata_only` disposition; the
// renderer never claims compliance, conformance, compatibility, or any
// vulnerability verdict. Prose is neutral and factual; counts and caps are
// disclosed, not graded.
//
// ESM only. Zero npm deps. Pure DATA; no filesystem or side effects.

import { compareAscii } from '../contracts/evidence.mjs';
import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

function renderTable(context, columns, rows) {
  const { escapeField } = context;
  const lines = [];
  lines.push(`| ${columns.map((column) => escapeField(column, { inTable: true })).join(' | ')} |`);
  lines.push(`| ${columns.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.map((cell) => escapeField(cell, { inTable: true })).join(' | ')} |`);
  }
  return lines.join('\n');
}

function summaryLine(model, escapeField) {
  const s = model.summary;
  const parts = [
    `${s.manifests} manifest(s)`,
    `${s.locks} lockfile(s)`,
    `${s.pins} pin(s)`,
    `${s.sources} source(s)`,
    `${s.licenses} license reference(s)`,
    `${s.sboms} SBOM(s)`,
    `${s.vexes} VEX(s)`,
    `${s.sarifs} SARIF(s)`,
    `${s.configurations} tool configuration(s)`,
    `${s.toolResults} tool result(s)`,
    `${s.accessibility} accessibility artifact(s)`,
    `${s.attestations} attestation(s)`,
    `${s.standards} standard reference(s)`,
  ];
  return `Inventory of declared supply-chain evidence: ${parts.join(', ')} across ${escapeField(String(model.searchSpace.filesInspected))} inspected file(s).`;
}

function capNotes(model) {
  const notes = [];
  const { capped } = model.summary;
  for (const [key, label] of [
    ['manifests', 'manifest'], ['locks', 'lockfile'], ['pins', 'pin'],
    ['sources', 'source'], ['licenses', 'license'], ['sboms', 'SBOM'],
    ['vexes', 'VEX'], ['sarifs', 'SARIF'], ['configurations', 'tool configuration'],
    ['toolResults', 'tool result'], ['accessibility', 'accessibility artifact'],
    ['attestations', 'attestation'], ['standards', 'standard reference'],
  ]) {
    if (capped[key]) notes.push(`${label} count capped`);
  }
  if (capped.files) notes.push('file read cap reached');
  return notes;
}

function section(model, category, heading, columns, rowFor, context) {
  const rows = Array.isArray(model[category]) ? model[category] : [];
  if (rows.length === 0) return [];
  const lines = [];
  lines.push(`### ${heading} (${rows.length})`);
  lines.push('');
  lines.push(renderTable(context, columns, rows.map((row) => rowFor(row))));
  lines.push('');
  return lines;
}

/**
 * Render the assurance model as a neutral Markdown section.
 * @param {string} _repoName - repository name (unused; retained for the shared
 *   renderer signature).
 * @param {object} model - the deep-frozen assurance model (`findings` from the
 *   scanner).
 * @param {object} context - render context from `render/base.mjs`.
 * @returns {string} The `## Assurance & Supply Chain` Markdown section.
 */
export function renderAssurance(_repoName, model, context = DEFAULT_RENDER_CONTEXT) {
  if (!model || typeof model !== 'object') return '';
  const { escapeField } = context;
  const lines = [];
  lines.push('## Assurance & Supply Chain');
  lines.push('');
  lines.push('> Static inventory of declared supply-chain evidence. No package resolution, advisory lookup, scanner execution, or signature validation.');
  lines.push('');
  lines.push(summaryLine(model, escapeField));
  lines.push('');

  const notes = capNotes(model);
  if (notes.length > 0) {
    lines.push(`- ${notes.join('; ')}.`);
    lines.push('');
  }

  const sections = [
    section(model, 'manifest', 'Dependency manifests', ['Format', 'Ecosystem', 'Path'],
      (row) => [row.details.format, row.details.ecosystem ?? '—', row.path], context),
    section(model, 'lock', 'Lockfiles', ['Format', 'Path'],
      (row) => [row.details.format, row.path], context),
    section(model, 'pin', 'Declared pins', ['Package', 'Version', 'Scope', 'Path'],
      (row) => [row.details.package, row.details.version, row.details.scope, row.path], context),
    section(model, 'source', 'Dependency sources', ['Kind', 'Host', 'Path'],
      (row) => [row.details.kind, row.details.host ?? '—', row.path], context),
    section(model, 'license', 'License references', ['Identifier', 'Declared', 'Path'],
      (row) => [row.details.identifier ?? '—', row.details.declared, row.path], context),
    section(model, 'sbom', 'Software bill of materials', ['Format', 'Spec version', 'Components', 'Path'],
      (row) => [row.details.format, row.details.specVersion ?? '—', String(row.details.projection?.componentCount ?? 0), row.path], context),
    section(model, 'vex', 'VEX documents', ['Format', 'Spec version', 'Statements', 'Path'],
      (row) => [row.details.format, row.details.specVersion ?? '—', String(row.details.statementCount ?? 0), row.path], context),
    section(model, 'sarif', 'Static-analysis results', ['Version', 'Runs', 'Results', 'Path'],
      (row) => [row.details.version ?? '—', String(row.details.projection?.runCount ?? 0), String(row.details.projection?.resultCount ?? 0), row.path], context),
    section(model, 'configuration', 'Tool configuration', ['Tool', 'Path'],
      (row) => [row.details.tool, row.path], context),
    section(model, 'tool_result', 'Tool result artifacts', ['Tool', 'Format', 'Path'],
      (row) => [row.details.tool, row.details.format ?? '—', row.path], context),
    section(model, 'accessibility', 'Accessibility artifacts', ['Kind', 'Declared', 'Path'],
      (row) => [row.details.kind, row.details.declared ?? '—', row.path], context),
    section(model, 'attestation', 'Attestations', ['Format', 'Kind', 'Path'],
      (row) => [row.details.format, row.details.kind, row.path], context),
    section(model, 'standard', 'Standards references (metadata only)', ['Standard', 'Edition key', 'Disposition', 'Path'],
      (row) => [row.details.registryId, row.details.editionKey, row.details.disposition, row.path], context),
  ];
  lines.push(...sections.flat());

  if ((model.summary?.records ?? 0) === 0) {
    lines.push(`No declared supply-chain evidence detected in ${model.searchSpace.filesInspected} inspected file(s).`);
    lines.push('');
  }

  if (model.diagnostics.length > 0) {
    lines.push('### Diagnostics');
    lines.push('');
    for (const entry of [...model.diagnostics].toSorted((left, right) => compareAscii(left.path, right.path))) {
      lines.push(`- \`${escapeField(entry.path)}\`: ${escapeField(entry.reason)} (${escapeField(entry.status)})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Create an inert assurance renderer. Never registered anywhere.
 * @param {object} options - `{ context }` render context override.
 * @returns {{ render: (model: object) => string }} A frozen renderer.
 */
export function createAssuranceRenderer({ context = DEFAULT_RENDER_CONTEXT } = {}) {
  if (context === null || typeof context !== 'object' || typeof context.escapeField !== 'function') {
    throw new TypeError('createAssuranceRenderer requires a render context with escapeField');
  }
  return Object.freeze({
    render(model) {
      return renderAssurance('repository', model, context);
    },
  });
}
