// Data Architecture renderer (INERT).
//
// T212 owns this module. It renders a deep-frozen data model into a neutral
// Markdown section. It is deliberately INERT: it is exported as a pure factory
// function and is NOT registered in write.mjs, existing-ten.mjs, or any
// pipeline wiring; later tasks (T223/T224) decide activation.
//
// Voice discipline: factual, literal-subset descriptions only. No live-database
// claims, migration execution, query-plan statements, PII classification, or
// inferred lineage. Every row carries the repo-relative declaration path (and
// line) as admissible evidence; name-only fixtures render nothing because the
// model never contains them. All user-derived strings pass through the shared
// render context's `escapeField` privacy hook.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none).

import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

const STORE_LABEL = 'Stores';
const SCHEMA_LABEL = 'Schemas';

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

function pathCell(context, path, line) {
  return `${context.escapeField(path)}${line == null ? '' : `:${line}`}`;
}

function countsByEntity(records, entity) {
  let fields = 0;
  let keys = 0;
  for (const record of records) {
    if (record.signature.startsWith(`${entity}:`)) {
      if (record.category === 'field') fields++;
      else if (record.category === 'key') keys++;
    }
  }
  return { fields, keys };
}

function summaryLine(model, context) {
  const { summary } = model;
  const parts = [
    `${summary.entities} entit${summary.entities === 1 ? 'y' : 'ies'}`,
    `${summary.fields} field(s)`,
    `${summary.keys} key(s)`,
    `${summary.relations} relation(s)`,
    `${summary.migrations} migration(s)`,
    `${summary.stores} store(s)`,
    `${summary.caches} cache(s)`,
    `${summary.queues} queue(s)`,
    `${summary.edges} edge(s)`,
  ];
  return `Declaration-backed data architecture: ${parts.join(', ')} across ${context.escapeField(String(model.searchSpace.filesInspected))} inspected file(s).`;
}

function capNotes(model) {
  const notes = [];
  const { capped } = model.summary;
  for (const [key, label] of [
    ['entities', 'entity'], ['fields', 'field'], ['keys', 'key'], ['relations', 'relation'],
    ['migrations', 'migration'], ['stores', 'store'], ['schemas', 'schema'],
    ['caches', 'cache'], ['queues', 'queue'], ['edges', 'edge'], ['records', 'record'],
  ]) {
    if (capped[key]) notes.push(`${label} count capped`);
  }
  if (capped.files) notes.push('file read cap reached');
  return notes;
}

/**
 * Render a data model as a neutral Markdown section.
 *
 * @param {string} _repoName - repository label (unused; kept for parity with
 *   the existing renderer factory signature).
 * @param {object} model - deep-frozen data model from the data scanner.
 * @param {object} [context] - render context with a privacy `escapeField`.
 * @returns {string} Markdown section, or an empty string when no model is
 *   provided.
 */
export function renderData(_repoName, model, context = DEFAULT_RENDER_CONTEXT) {
  if (!model || typeof model !== 'object') return '';
  const lines = [];
  lines.push('## Data Architecture');
  lines.push('');
  lines.push('> Static literal parsing of declared stores, schemas, models, migrations, keys, relations, caches, and queues. No database connection, migration execution, query plans, PII classification, or inferred lineage.');
  lines.push('');
  lines.push(summaryLine(model, context));
  lines.push('');

  const notes = capNotes(model);
  if (notes.length > 0) {
    lines.push(`- ${notes.join('; ')}.`);
    lines.push('');
  }

  const allRecords = [
    ...(model.stores ?? []), ...(model.schemas ?? []), ...(model.entities ?? []),
    ...(model.fields ?? []), ...(model.keys ?? []), ...(model.relations ?? []),
    ...(model.migrations ?? []), ...(model.caches ?? []), ...(model.queues ?? []),
  ];

  if (model.stores.length > 0) {
    lines.push(`### ${STORE_LABEL} (${model.stores.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Store', 'Kind', 'Path'], model.stores.map((store) => [
      store.signature, store.details.kind, pathCell(context, store.source.path, store.source.line),
    ])));
    lines.push('');
  }
  if (model.schemas.length > 0) {
    lines.push(`### ${SCHEMA_LABEL} (${model.schemas.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Schema', 'Path'], model.schemas.map((schema) => [
      schema.signature, pathCell(context, schema.source.path, schema.source.line),
    ])));
    lines.push('');
  }
  if (model.migrations.length > 0) {
    lines.push(`### Migrations (${model.migrations.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Migration', 'Dialect', 'Revision', 'Predecessor', 'Path'], model.migrations.map((migration) => {
      const predecessor = migration.details.downRevision
        ?? (migration.details.dependencies.length > 0 ? migration.details.dependencies.join(', ') : null);
      return [
        migration.signature,
        migration.dialect,
        migration.details.revision ?? '—',
        predecessor ?? '—',
        pathCell(context, migration.source.path, migration.source.line),
      ];
    })));
    lines.push('');
  }
  if (model.entities.length > 0) {
    lines.push(`### Entities (${model.entities.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Entity', 'Table', 'Fields', 'Keys', 'Dialect', 'Path'], model.entities.map((entity) => {
      const { fields, keys } = countsByEntity(allRecords, entity.signature);
      return [
        entity.signature,
        entity.details.table ?? '—',
        String(fields),
        String(keys),
        entity.dialect,
        pathCell(context, entity.source.path, entity.source.line),
      ];
    })));
    lines.push('');
  }
  if (model.fields.length > 0) {
    lines.push(`### Fields (${model.fields.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Field', 'Type', 'Nullable', 'Path'], model.fields.map((field) => [
      field.signature,
      field.details.type ?? '—',
      field.details.nullable ? 'yes' : 'no',
      pathCell(context, field.source.path, field.source.line),
    ])));
    lines.push('');
  }
  if (model.keys.length > 0) {
    lines.push(`### Keys (${model.keys.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Key', 'Kind', 'Columns', 'Path'], model.keys.map((key) => [
      key.signature,
      key.details.kind,
      key.details.columns.join(', '),
      pathCell(context, key.source.path, key.source.line),
    ])));
    lines.push('');
  }
  if (model.relations.length > 0) {
    lines.push(`### Relations (${model.relations.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Relation', 'Kind', 'Target', 'Path'], model.relations.map((relation) => [
      relation.signature,
      relation.details.kind,
      relation.details.target,
      pathCell(context, relation.source.path, relation.source.line),
    ])));
    lines.push('');
  }
  if (model.caches.length > 0) {
    lines.push(`### Caches (${model.caches.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Cache', 'Scope', 'Path'], model.caches.map((cache) => [
      cache.signature, cache.details.scope, pathCell(context, cache.source.path, cache.source.line),
    ])));
    lines.push('');
  }
  if (model.queues.length > 0) {
    lines.push(`### Queues (${model.queues.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Queue', 'Scope', 'Path'], model.queues.map((queue) => [
      queue.signature, queue.details.scope, pathCell(context, queue.source.path, queue.source.line),
    ])));
    lines.push('');
  }
  if (model.edges.length > 0) {
    lines.push(`### Data Relations & Flow Edges (${model.edges.length})`);
    lines.push('');
    lines.push(renderTable(context, ['From', 'Edge', 'To', 'Evidence'], model.edges.map((edge) => [
      edge.from,
      edge.kind,
      edge.to,
      pathCell(context, edge.evidence.path, edge.evidence.line),
    ])));
    lines.push('');
  }

  const hasDeclarations = model.stores.length + model.schemas.length + model.entities.length
    + model.fields.length + model.keys.length + model.relations.length + model.migrations.length
    + model.caches.length + model.queues.length > 0;
  if (!hasDeclarations) {
    lines.push(`No declaration-backed data architecture detected in ${model.searchSpace.filesInspected} inspected file(s).`);
    lines.push('');
  }

  if (model.diagnostics.length > 0) {
    lines.push('### Diagnostics');
    lines.push('');
    for (const entry of model.diagnostics) {
      const location = entry.line === null
        ? `\`${context.escapeField(entry.path)}\``
        : `\`${context.escapeField(entry.path)}:${entry.line}\``;
      lines.push(`- ${location}: ${context.escapeField(entry.reason)} (${context.escapeField(entry.status)})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Create an inert data renderer. Never registered anywhere.
 * @param {object} options - `{ context }` render context override.
 * @returns {{ render: (model: object) => string }} A frozen renderer.
 */
export function createDataRenderer({ context = DEFAULT_RENDER_CONTEXT } = {}) {
  if (context === null || typeof context !== 'object' || typeof context.escapeField !== 'function') {
    throw new TypeError('createDataRenderer requires a render context with escapeField');
  }
  return Object.freeze({
    render(model) {
      return renderData('repository', model, context);
    },
  });
}
