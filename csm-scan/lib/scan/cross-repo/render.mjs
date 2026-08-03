// Cross-repository Architecture — inert global renderer.
//
// T221 owns this module. It renders the deterministic cross-repository
// snapshot produced by `edges.mjs` as a neutral factual `## Cross-repository
// Architecture` Markdown section. It is deliberately INERT: it exports a
// factory (`createCrossRepositoryRenderer`) and a render function, but it is
// never registered in any renderer map and nothing in the pipeline, CLI,
// enrich, validate, or write path dispatches it. Activation happens at
// T223/T224.
//
// Guarantees:
//   - The renderer is an inert exported factory; it is never registered and
//     never performs filesystem, network, or child-process access.
//   - Prose is neutral and factual; counts and caps are disclosed, never
//     graded.
//   - Identity/edge coordinates are emitted exactly as resolved; ambiguous and
//     unresolved references are disclosed as records, never as edges.
//   - Output is deterministic for a given snapshot and privacy-safe (the
//     snapshot itself is privacy-validated before rendering).
//
// ESM only. Zero npm deps. Pure DATA; no filesystem or side effects.

import { compareAscii } from '../contracts/evidence.mjs';
import { DEFAULT_RENDER_CONTEXT } from '../render/base.mjs';

const CAP_LIMITS = Object.freeze({
  edges: 1024,
  external: 1024,
  ambiguous: 1024,
});

function count(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function cell(value, context) {
  const { escapeField } = context;
  return escapeField(value === null || value === undefined ? '—' : String(value), { inTable: true });
}

function table(context, columns, rows) {
  const { escapeField } = context;
  const lines = [];
  lines.push(`| ${columns.map((column) => escapeField(column, { inTable: true })).join(' | ')} |`);
  lines.push(`| ${columns.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.map((value) => cell(value, context)).join(' | ')} |`);
  }
  return lines;
}

function section(context, heading, count, columns, rows) {
  const lines = [`### ${heading} (${count})`, ''];
  if (rows.length === 0) {
    lines.push('- None.');
    lines.push('');
    return lines;
  }
  lines.push(...table(context, columns, rows));
  lines.push('');
  return lines;
}

function vcsDisplay(vcs) {
  if (vcs === null || typeof vcs !== 'object') return null;
  if (typeof vcs.host !== 'string' || typeof vcs.namespace !== 'string' || typeof vcs.repo !== 'string') return null;
  return `${vcs.host}/${vcs.namespace}/${vcs.repo}`;
}

function capNotes(model) {
  const notes = [];
  const capped = model.capped ?? {};
  for (const [key, limit] of Object.entries(CAP_LIMITS)) {
    if (capped[key]) notes.push(`${key} list capped at ${limit}`);
  }
  if (capped.references) notes.push('reference input capped');
  if (capped.candidates) notes.push('candidate list capped per reference');
  return notes;
}

/**
 * Render the cross-repository snapshot as a neutral Markdown section.
 * @param {string} _repoName - repository name (unused; retained for the shared
 *   renderer signature).
 * @param {object} model - the deep-frozen snapshot from `synthesizeCrossRepository`.
 * @param {object} context - render context from `render/base.mjs`.
 * @returns {string} The `## Cross-repository Architecture` Markdown section.
 */
export function renderCrossRepositoryGlobal(_repoName, model, context = DEFAULT_RENDER_CONTEXT) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return '';
  const metrics = model.metrics ?? {};
  const lines = [];

  lines.push('## Cross-repository Architecture');
  lines.push('');
  lines.push(`> Declared cross-repository references resolved against exact repository and component identities across ${count(metrics.repositories ?? 0, 'repository identity', 'repository identities')} and ${count(metrics.components ?? 0, 'component identity', 'component identities')}.`);
  lines.push('');
  lines.push(`Resolved edges: ${metrics.edges ?? 0} (${metrics.crossRepositoryEdges ?? 0} cross-repository, ${metrics.selfEdges ?? 0} self). External references: ${metrics.external ?? 0}. Ambiguous references: ${metrics.ambiguous ?? 0}. Unresolved identities: ${metrics.unresolved ?? 0}.`);
  lines.push('');

  const notes = capNotes(model);
  if (notes.length > 0) {
    lines.push(`- ${notes.join('; ')}.`);
    lines.push('');
  }

  const identityTable = model.identityTable ?? {};
  const repositories = [...(Array.isArray(identityTable.repositories) ? identityTable.repositories : [])]
    .sort((left, right) => compareAscii(left.repositoryId, right.repositoryId));
  lines.push(...section(context, 'Repository identities', repositories.length,
    ['Repository', 'VCS', 'Components', 'Packages'],
    repositories.map((repo) => [
      repo.repositoryId,
      vcsDisplay(repo.vcs),
      repo.componentRoots.length,
      repo.packageCoordinates.length,
    ]),
  ));

  const edges = model.edges?.edges ?? [];
  lines.push(...section(context, 'Resolved edges', edges.length,
    ['Kind', 'Source repository', 'Target', 'Reference', 'Scope'],
    edges.map((edge) => [
      edge.kind,
      edge.sourceRepository,
      edge.targetId,
      edge.coordinate,
      edge.self ? 'self' : 'cross-repository',
    ]),
  ));

  const external = model.edges?.external ?? [];
  lines.push(...section(context, 'External references', external.length,
    ['Kind', 'Repository', 'Reference', 'Evidence', 'Reason'],
    external.map((record) => [
      record.kind,
      record.sourceRepository,
      record.coordinate ?? 'unparseable',
      record.path,
      record.reason,
    ]),
  ));

  const ambiguous = model.edges?.ambiguous ?? [];
  lines.push(...section(context, 'Ambiguous references', ambiguous.length,
    ['Kind', 'Repository', 'Reference', 'Candidates'],
    ambiguous.map((record) => [
      record.kind,
      record.sourceRepository,
      record.coordinate,
      `${record.candidateCount}${record.candidatesCapped ? '+' : ''}`,
    ]),
  ));

  const unresolved = identityTable.unresolved ?? [];
  lines.push(...section(context, 'Unresolved identities', unresolved.length,
    ['Repository', 'Reason'],
    unresolved.map((record) => [record.repositoryId, record.reason]),
  ));

  return lines.join('\n');
}

/**
 * Create an inert cross-repository renderer. Never registered anywhere.
 * @param {object} options - `{ context }` render context override.
 * @returns {{ render: (model: object) => string }} A frozen renderer.
 */
export function createCrossRepositoryRenderer({ context = DEFAULT_RENDER_CONTEXT } = {}) {
  if (context === null || typeof context !== 'object' || typeof context.escapeField !== 'function') {
    throw new TypeError('createCrossRepositoryRenderer requires a render context with escapeField');
  }
  return Object.freeze({
    render(model) {
      return renderCrossRepositoryGlobal('repository', model, context);
    },
  });
}
