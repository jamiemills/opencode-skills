// Maintainability dimension — inert renderer.
//
// T214 owns this module. It is deliberately INERT: it exports a factory
// (`createMaintainabilityRenderer`) and a render function, but it is never
// registered in the existing-ten renderer map and nothing in the pipeline,
// CLI, enrich, validate, or write path dispatches it. Activation happens at
// T223/T224.
//
// Voice discipline: raw counts, disclosed measurement universes, and exact
// evidence only. No quality scores, semantic-clone claims, defect prediction,
// developer ranking, or recommendations. When coverage is partial the section
// states that measurements describe only the inspected files and draws no
// repository-wide conclusion. All user-derived strings pass through the shared
// render context's `escapeField` privacy hook.
//
// ESM only. Zero npm deps. Pure DATA; no filesystem or side effects.

import { compareAscii } from '../contracts/evidence.mjs';
import { DEFAULT_RENDER_CONTEXT } from './base.mjs';
import { BRANCH_CATEGORIES } from '../deep/maintainability/tokenizer.mjs';
import { OTHER_EXTENSION_LABEL, SIZE_BUCKETS } from '../deep/maintainability/model.mjs';

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

function branchTotals(model) {
  const totals = new Map();
  for (const record of model.branchPoints) {
    const entry = totals.get(record.dialect) ?? {
      dialect: record.dialect,
      files: 0,
      counts: Object.fromEntries(BRANCH_CATEGORIES.map((category) => [category, 0])),
      capped: false,
    };
    entry.files += 1;
    if (record.capped) entry.capped = true;
    for (const category of BRANCH_CATEGORIES) entry.counts[category] += record.counts[category];
    totals.set(record.dialect, entry);
  }
  return [...totals.values()].sort((left, right) => compareAscii(left.dialect, right.dialect));
}

function sizeBucketLabel(bucket) {
  const match = SIZE_BUCKETS.find((entry) => entry.label === bucket);
  if (match === undefined || !Number.isFinite(match.limit)) return bucket;
  return `${bucket} (under ${match.limit} bytes)`;
}

function capNotes(model) {
  const notes = [];
  const { capped } = model.summary;
  const readLimitReached = model.searchSpace?.capped === true;
  if (capped.read) notes.push('read cap reached');
  if (capped.files) {
    if (readLimitReached) notes.push('source file cap reached');
    else notes.push('some eligible source files were not measured');
  }
  if (capped.tokens) notes.push('token cap reached in one or more files');
  if (capped.windows) notes.push('duplicate window cap reached');
  if (capped.groups) notes.push('duplicate group cap reached');
  if (capped.spans) notes.push('duplicate span cap reached');
  if (capped.occurrences) notes.push('duplicate occurrence cap reached');
  if (capped.blocks) notes.push('duplicate verification cap reached');
  return notes;
}

/**
 * Render the maintainability model as a neutral Markdown section.
 * @param {string} _repoName - repository name (unused; retained for the shared
 *   renderer signature).
 * @param {object} model - the deep-frozen maintainability model (`findings`
 *   from the scanner).
 * @param {object} context - render context from `render/base.mjs`.
 * @returns {string} The `## Maintainability` Markdown section.
 */
export function renderMaintainability(_repoName, model, context = DEFAULT_RENDER_CONTEXT) {
  if (!model || typeof model !== 'object') return '';
  const { escapeField } = context;
  const { summary } = model;
  const lines = [];
  lines.push('## Maintainability');
  lines.push('');
  lines.push('> Lexical, declaration-backed measurements. No quality scores, semantic-clone claims, defect prediction, or recommendations.');
  lines.push('');

  if (summary.partialCoverage) {
    lines.push(`> Coverage is partial: ${summary.filesMeasured} of ${summary.eligibleFiles} eligible source file(s) measured. Measurements describe only the inspected files; no repository-wide conclusion is drawn.`);
    lines.push('');
  }

  const notes = capNotes(model);
  if (notes.length > 0) {
    lines.push(`> Caps applied: ${notes.join('; ')}.`);
    lines.push('');
  }

  lines.push(`Measured ${summary.filesMeasured} source file(s) (${summary.tokens} tokens) across ${summary.dialects.length} supported dialect(s). ${summary.branchPoints} branch-keyword token(s) counted, ${summary.duplicateGroups} exact duplicate group(s), ${summary.generatedFiles} generated/vendored boundary (boundaries), ${summary.toolEvidence} declared maintainability tool(s).`);
  lines.push('');

  // Measurement universe ---------------------------------------------------
  const universe = model.measurementUniverse;
  lines.push('### Measurement universe');
  lines.push('');
  lines.push(renderTable(context,
    ['Metric', 'Value'],
    [
      ['Files inspected', String(universe.filesInspected)],
      ['Bytes inspected', String(universe.bytesInspected)],
      ['Records inspected', String(universe.recordsInspected)],
      ['Measured source files', String(universe.measuredFiles)],
      ['Eligible source files', String(universe.eligibleFiles)],
      ['Omitted (capped) records', String(universe.omittedCount)],
      ['Excluded unsupported-language files', String(universe.excludedFiles)],
    ],
  ));
  lines.push('');
  if (universe.supportedDialects.length > 0) {
    lines.push(`Supported dialects measured: ${universe.supportedDialects.map((entry) => escapeField(entry)).join(', ')}.`);
    lines.push('');
  }
  if (universe.excludedLanguages.length > 0) {
    lines.push('Unsupported languages excluded from measurement:');
    lines.push('');
    lines.push(renderTable(context, ['Extension', 'Files excluded'],
      universe.excludedLanguages.map((entry) => [entry.extension, String(entry.count)])));
    lines.push('');
    if (universe.excludedLanguages.some((entry) => entry.extension === OTHER_EXTENSION_LABEL)) {
      lines.push(`> Extensions outside the disclosed charset are reported as \`${OTHER_EXTENSION_LABEL}\` instead of verbatim.`);
      lines.push('');
    }
  }

  // Size distribution ------------------------------------------------------
  if (model.sizeDistribution.length > 0) {
    lines.push('### Size distribution (measured files)');
    lines.push('');
    lines.push(renderTable(context, ['Bucket', 'Files'],
      model.sizeDistribution.map((entry) => [sizeBucketLabel(entry.bucket), String(entry.count)])));
    lines.push('');
  }

  // Branch-point approximation ---------------------------------------------
  const totals = branchTotals(model);
  if (totals.length > 0) {
    lines.push('### Branch-point approximation (lexical)');
    lines.push('');
    lines.push('Counts are branch-keyword tokens per dialect across the measured files. They are a lexical approximation, not semantic branch counts.');
    lines.push('');
    lines.push(renderTable(context,
      ['Dialect', 'Files', ...BRANCH_CATEGORIES.map((category) => escapeField(category))],
      totals.map((entry) => [entry.dialect, String(entry.files),
        ...BRANCH_CATEGORIES.map((category) => String(entry.counts[category]))]),
    ));
    lines.push('');
  }

  // Exact token duplicates ---------------------------------------------------
  if (model.duplicateGroups.length > 0) {
    lines.push(`### Exact token duplicates (${summary.duplicateGroups} group(s), ${summary.duplicateSpans} span(s))`);
    lines.push('');
    lines.push('Spans are exact 50-token windows on the normalized token stream that were hashed, verified, and merged. No semantic clones are claimed.');
    lines.push('');
    lines.push(renderTable(context, ['Group', 'Path', 'Lines', 'Tokens'],
      model.duplicateGroups.flatMap((group) => group.spans.map((span) => [
        group.id,
        span.path,
        `${span.startLine}-${span.endLine}`,
        String(span.tokenCount),
      ]))));
    lines.push('');
  }

  // Generated / vendor boundaries ------------------------------------------
  if (model.generatedBoundaries.length > 0) {
    lines.push(`### Generated and vendored boundaries (${summary.generatedFiles})`);
    lines.push('');
    lines.push('Boundaries are classified only from exact evidence: directory markers, filename markers, and generated-code header comments.');
    lines.push('');
    lines.push(renderTable(context, ['Path', 'Reason', 'Marker', 'Line'],
      model.generatedBoundaries.map((entry) => [
        entry.path,
        entry.reason,
        entry.marker,
        entry.line === null ? '' : String(entry.line),
      ])));
    lines.push('');
  }

  // Declared tools ---------------------------------------------------------
  if (model.toolEvidence.length > 0) {
    lines.push(`### Declared maintainability tools (${summary.toolEvidence})`);
    lines.push('');
    lines.push('Tool presence comes only from committed config files, manifest sections, and dependency declarations.');
    lines.push('');
    lines.push(renderTable(context, ['Tool', 'Kind', 'Evidence', 'Line'],
      model.toolEvidence.map((entry) => [
        entry.tool,
        entry.kind,
        entry.source ?? entry.file,
        String(entry.line),
      ])));
    lines.push('');
  }

  if (model.files.length === 0) {
    lines.push('No supported source files were measured. Unsupported-language files were excluded from measurement with disclosure.');
    lines.push('');
  }

  if (model.diagnostics.length > 0) {
    lines.push('### Diagnostics');
    lines.push('');
    for (const entry of model.diagnostics) {
      const location = entry.line === null
        ? `\`${escapeField(entry.path)}\``
        : `\`${escapeField(entry.path)}:${entry.line}\``;
      lines.push(`- ${location}: ${escapeField(entry.reason)} (${escapeField(entry.status)})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Create an inert maintainability renderer. Never registered anywhere.
 * @param {object} options - `{ context }` render context override.
 * @returns {{ render: (model: object) => string }} A frozen renderer.
 */
export function createMaintainabilityRenderer({ context = DEFAULT_RENDER_CONTEXT } = {}) {
  if (context === null || typeof context !== 'object' || typeof context.escapeField !== 'function') {
    throw new TypeError('createMaintainabilityRenderer requires a render context with escapeField');
  }
  return Object.freeze({
    render(model) {
      return renderMaintainability('repository', model, context);
    },
  });
}
