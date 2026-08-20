// Inert Architecture graph-facts renderer extension.
//
// T217 owns this module. It is a pure factory: nothing in the pipeline, CLI,
// write, enrich, validate, or existing-ten renderer imports or invokes it. A
// future registration task (T223/T224) may wire it in; until then it exists
// solely so the raw graph facts have a neutral, deterministic Markdown form.
//
// It renders ONLY raw, verdict-free facts:
//   - disclosed graph bounds (files/edges inspected and omitted)
//   - measurement-universe metadata
//   - edge-kind counts
//   - self-loops
//   - Tarjan strongly-connected components (cyclic components)
//   - a bounded fan-in/fan-out listing
//
// No hub/coupling/quality verdict, ranking, or recommendation is emitted. The
// existing `render/architecture.mjs` renderer is untouched.
//
// ESM only. Zero npm deps. node: builtins only. Read-only; no filesystem,
// network, child-process, or executable access.

import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

const MAX_LISTED_SELF_LOOPS = 20;
const MAX_LISTED_COMPONENTS = 20;
const MAX_LISTED_FAN_ROWS = 50;
const MAX_LISTED_INDICATORS = 20;

export function createArchitectureExtensionRenderer({ context = DEFAULT_RENDER_CONTEXT } = {}) {
  if (!context || typeof context.escapeField !== 'function') {
    throw new TypeError('architecture extension renderer requires a render context');
  }

  function renderGraphFacts(facts) {
    const lines = [];
    const esc = (value) => context.escapeField(value, { inTable: true });

    lines.push('### Architecture — Graph Facts');
    lines.push('');
    lines.push('Raw graph facts reported without coupling or quality judgment.');
    lines.push('');

    lines.push('| Measurement | Value |');
    lines.push('|-------------|------:|');
    lines.push(`| Files inspected | ${esc(facts.bounds.filesInspected)} |`);
    lines.push(`| Files omitted | ${esc(facts.bounds.filesOmitted)} |`);
    lines.push(`| Edges inspected | ${esc(facts.bounds.edgesInspected)} |`);
    lines.push(`| Edges omitted | ${esc(facts.bounds.edgesOmitted)} |`);
    lines.push(`| Capped | ${facts.bounds.capped ? 'yes' : 'no'} |`);
    lines.push('');

    lines.push('| Universe | Value |');
    lines.push('|----------|-------|');
    lines.push(`| Ecosystems | ${esc(facts.universe.ecosystems.join(', ')) || '—'} |`);
    lines.push(`| Module files | ${esc(facts.universe.moduleFiles)} |`);
    lines.push(`| Source files | ${esc(facts.universe.sourceFiles)} |`);
    lines.push(`| Test files excluded | ${esc(facts.universe.testFilesExcluded)} |`);
    lines.push(`| Declaration files excluded | ${esc(facts.universe.declarationFilesExcluded)} |`);
    lines.push('');

    const kinds = Object.entries(facts.edgeKindCounts);
    if (kinds.length > 0) {
      lines.push('| Edge Kind | Count |');
      lines.push('|-----------|------:|');
      for (const [kind, count] of kinds) lines.push(`| ${esc(kind)} | ${esc(count)} |`);
      lines.push('');
    }

    if (facts.selfLoops.length > 0) {
      lines.push(`- **Self-loops**: ${facts.selfLoops.length} file(s)`);
      for (const file of facts.selfLoops.slice(0, MAX_LISTED_SELF_LOOPS)) {
        lines.push(`  - \`${esc(file)}\``);
      }
      if (facts.selfLoops.length > MAX_LISTED_SELF_LOOPS) {
        lines.push(`  - ... +${facts.selfLoops.length - MAX_LISTED_SELF_LOOPS} more`);
      }
      lines.push('');
    }

    const components = facts.stronglyConnectedComponents.cyclicComponents;
    if (components.length > 0) {
      lines.push(`- **Strongly-connected components**: ${facts.stronglyConnectedComponents.totalComponents} total (${facts.stronglyConnectedComponents.singletonComponents} singleton; ${components.length} cyclic)`);
      for (const component of components.slice(0, MAX_LISTED_COMPONENTS)) {
        lines.push(`  - ${component.size} member(s): ${component.members.map(esc).join(', ')}`);
      }
      if (components.length > MAX_LISTED_COMPONENTS) {
        lines.push(`  - ... +${components.length - MAX_LISTED_COMPONENTS} more`);
      }
      lines.push('');
    }

    const indicatorCount = facts.dynamicIndicators.length;
    if (indicatorCount > 0) {
      lines.push(`- **Dynamic indicators**: ${indicatorCount} construct(s) recorded (${facts.universe.indicatorsOmitted} omitted by cap)`);
      for (const indicator of facts.dynamicIndicators.slice(0, MAX_LISTED_INDICATORS)) {
        const target = indicator.specifier === null ? '(dynamic)' : `\`${esc(indicator.specifier)}\``;
        lines.push(`  - ${esc(indicator.file)}:${indicator.line} ${esc(indicator.kind)} ${target}`);
      }
      if (indicatorCount > MAX_LISTED_INDICATORS) {
        lines.push(`  - ... +${indicatorCount - MAX_LISTED_INDICATORS} more`);
      }
      lines.push('');
    }

    const fanFiles = Object.keys(facts.fanOut).toSorted().slice(0, MAX_LISTED_FAN_ROWS);
    if (fanFiles.length > 0) {
      lines.push('| File | Fan-in | Fan-out |');
      lines.push('|------|-------:|--------:|');
      for (const file of fanFiles) {
        lines.push(`| \`${esc(file)}\` | ${esc(facts.fanIn[file] ?? 0)} | ${esc(facts.fanOut[file] ?? 0)} |`);
      }
      if (Object.keys(facts.fanOut).length > MAX_LISTED_FAN_ROWS) {
        lines.push(`| ... | | +${Object.keys(facts.fanOut).length - MAX_LISTED_FAN_ROWS} more |`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  return Object.freeze({
    render(repoName, findings, _renderContext = context) {
      if (!findings || !findings.graphFacts) return '';
      return renderGraphFacts(findings.graphFacts);
    },
  });
}

export const DEFAULT_ARCHITECTURE_EXTENSION_RENDERER = createArchitectureExtensionRenderer();
