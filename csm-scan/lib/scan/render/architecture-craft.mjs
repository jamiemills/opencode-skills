// Architecture — expanded-pipeline craft assessment renderer.
//
// The expanded pipeline renders the architecture section through the shared
// `renderArchitecture` (which the legacy ten-dimension writer also uses), then
// appends a neutral craft assessment: coupling aggregates and SOLID/pattern
// indicators derived from the already-computed import graph and layer
// classification via the pure `craft.mjs` derivations. The legacy-ten writer
// never imports this module, so its fixture hashes stay byte-identical.
//
// Voice and privacy: counts and repository-relative paths only; no evaluative
// words, no "hub"/"violation"/"high coupling"/"criticality"/"dead code".
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA — no filesystem,
// network, child-process, or executable access.

import { deepFreeze } from '../contracts/evidence.mjs';
import { computeCouplingAggregates, computeSolidIndicators } from '../deep/architecture/craft.mjs';
import { renderArchitecture } from './architecture.mjs';

export const DEFAULT_RENDER_CONTEXT = deepFreeze({
  escapeField: (value) => String(value ?? '').replace(/\|/g, '\\|'),
});

function renderCoupling(aggregates, escapeField) {
  const lines = [];
  lines.push('### Craft Assessment — Coupling');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Maximum fan-in | ${aggregates.fanIn?.max?.count ?? 0} |`);
  lines.push(`| Maximum fan-out | ${aggregates.fanOut?.max?.count ?? 0} |`);
  lines.push(`| Files above fan-in threshold (${aggregates.fanInThreshold?.threshold ?? 10}) | ${aggregates.fanInThreshold?.count ?? 0} |`);
  lines.push(`| Cyclic groups | ${aggregates.cyclicGroups?.count ?? 0} |`);
  lines.push(`| Layer-boundary edges | ${aggregates.layerBoundaries?.crossingCount ?? 0} |`);
  lines.push('');
  const topIn = aggregates.fanIn?.max?.files;
  if (Array.isArray(topIn) && topIn.length > 0) {
    lines.push('Highest fan-in files:');
    lines.push('');
    for (const path of topIn) {
      lines.push(`- \`${escapeField(path)}\``);
    }
    lines.push('');
  }
  return lines;
}

function renderSolid(indicators, escapeField) {
  const lines = [];
  lines.push('### Craft Assessment — Design Indicators');
  lines.push('');
  const rows = [];
  if (indicators.interfaceReferences) rows.push(['Interface-typed references', indicators.interfaceReferences.count ?? 0]);
  if (indicators.dependencyDirection) {
    rows.push(['Downward dependencies', indicators.dependencyDirection.downward ?? 0]);
    rows.push(['Upward dependencies', indicators.dependencyDirection.upward ?? 0]);
  }
  if (indicators.patternSuffixes) {
    for (const [suffix, count] of Object.entries(indicators.patternSuffixes.counts ?? {})) {
      rows.push([`Pattern suffix ${suffix}`, count]);
    }
  }
  if (rows.length > 0) {
    lines.push('| Indicator | Count |');
    lines.push('|-----------|-------|');
    for (const [name, count] of rows) lines.push(`| ${name} | ${count} |`);
    lines.push('');
  }
  if (Array.isArray(indicators.portAdapterDirs?.paths) && indicators.portAdapterDirs.paths.length > 0) {
    lines.push('Port/contract/adapter directories:');
    lines.push('');
    for (const path of indicators.portAdapterDirs.paths) {
      lines.push(`- \`${escapeField(path)}\``);
    }
    lines.push('');
  }
  return lines;
}

/**
 * Render the neutral craft assessment subsection from architecture findings.
 * @param {object} findings - architecture scanner findings (importGraph,
 *   layers).
 * @param {object} context - render context with `escapeField`.
 * @returns {string} the craft assessment Markdown block, or '' for empty
 *   findings.
 */
export function renderArchitectureCraft(findings, context = DEFAULT_RENDER_CONTEXT) {
  if (findings === null || typeof findings !== 'object') return '';
  const escapeField = context?.escapeField ?? DEFAULT_RENDER_CONTEXT.escapeField;
  const input = { findings };
  const aggregates = computeCouplingAggregates(input);
  const indicators = computeSolidIndicators(input);
  const lines = [];
  lines.push('### Craft Assessment');
  lines.push('');
  const coupling = renderCoupling(aggregates, escapeField);
  if (coupling.length > 0) lines.push(...coupling);
  const solid = renderSolid(indicators, escapeField);
  if (solid.length > 0) lines.push(...solid);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

/**
 * Expanded-pipeline architecture renderer: the shared architecture section
 * followed by the craft assessment. Legacy-ten output is unaffected (the
 * legacy writer does not use this renderer).
 * @param {object} _repoName - unused (kept for signature parity).
 * @param {object} findings - architecture scanner findings.
 * @param {object} context - render context.
 * @returns {string} combined Markdown section.
 */
export function renderArchitectureExpanded(_repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  const base = renderArchitecture(_repoName, findings);
  if (base === '') return '';
  const craft = renderArchitectureCraft(findings, context);
  return craft === '' ? base : `${base}\n${craft}`;
}
