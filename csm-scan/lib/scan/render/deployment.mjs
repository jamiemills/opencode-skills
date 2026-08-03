// Deployment Topology renderer (INERT).
//
// T213 owns this module. It renders a deep-frozen deployment topology model
// into a neutral Markdown section. It is deliberately INERT: it is exported as
// a pure factory function and is NOT registered in write.mjs,
// existing-ten.mjs, or any pipeline wiring; later tasks (T220/T224) decide
// activation.
//
// Voice discipline: factual, literal-subset descriptions only. No drift, cost,
// availability, or security verdicts; no recommendation or quality language.
// All user-derived strings pass through the shared render context's
// `escapeField` privacy hook.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none).

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

/**
 * Render a deployment topology model as a neutral Markdown section.
 *
 * @param {string} _repoName - repository label (unused; kept for parity with
 *   the existing renderer factory signature).
 * @param {object} topology - deep-frozen topology from the deployment model.
 * @param {object} [context] - render context with a privacy `escapeField`.
 * @returns {string} Markdown section, or an empty string when no topology is
 *   provided.
 */
export function renderDeployment(_repoName, topology, context = DEFAULT_RENDER_CONTEXT) {
  if (!topology) return '';
  const lines = [];
  lines.push('## Deployment Topology');
  lines.push('');
  lines.push('> Static literal parsing of declared resources and direct references. No execution, drift, cost, availability, or security claims.');
  lines.push('');
  if (topology.capped) {
    lines.push(`> Scan capped: ${context.escapeField(topology.cappedKinds.join(', '))}`);
    lines.push('');
  }
  if (!topology.counts || topology.counts.artifacts === 0) {
    lines.push('- No deployment artifacts detected.');
    lines.push('');
    return lines.join('\n');
  }
  if (topology.images.length > 0) {
    lines.push(`### Images (${topology.images.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Image', 'Path'], topology.images.map((image) => [image.reference, image.path])));
    lines.push('');
  }
  if (topology.services.length > 0) {
    lines.push(`### Services (${topology.services.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Service', 'Image', 'Path'], topology.services.map((service) => [service.id, service.image ?? '—', service.path])));
    lines.push('');
  }
  if (topology.resources.length > 0) {
    lines.push(`### Resources (${topology.resources.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Resource', 'Kind', 'Path'], topology.resources.map((resource) => [resource.id, resource.kind, resource.path])));
    lines.push('');
  }
  if (topology.edges.length > 0) {
    lines.push(`### Topology Edges (${topology.edges.length})`);
    lines.push('');
    lines.push(renderTable(context, ['From', 'Edge', 'To', 'Path'], topology.edges.map((edge) => [edge.from, edge.kind, edge.to, edge.path])));
    lines.push('');
  }
  const indicatorCounts = new Map();
  for (const indicator of topology.indicators) {
    indicatorCounts.set(indicator.kind, (indicatorCounts.get(indicator.kind) ?? 0) + 1);
  }
  if (indicatorCounts.size > 0) {
    lines.push(`### Template Indicators (${topology.indicators.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Indicator', 'Count'], [...indicatorCounts.entries()]
      .sort(([left], [right]) => compareAscii(left, right))
      .map(([kind, count]) => [kind, String(count)])));
    lines.push('');
  }
  if (topology.stubs.length > 0) {
    lines.push(`### Unresolved References (${topology.stubs.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Kind', 'Reference', 'Path'], topology.stubs.map((stub) => [stub.kind, stub.label, stub.path])));
    lines.push('');
  }
  if (topology.diagnostics.length > 0) {
    lines.push(`### Diagnostics (${topology.diagnostics.length})`);
    lines.push('');
    lines.push(renderTable(context, ['Path', 'Status', 'Reason'], topology.diagnostics.map((entry) => [entry.path, entry.status, entry.reason])));
    lines.push('');
  }
  return lines.join('\n');
}
