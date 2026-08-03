export function renderArchitecture(_repoName, findings) {
  if (!findings) return '';
  const layers = findings.layers;
  if (!layers || layers.totalFiles === 0) {
    return [
      '## Architecture',
      '',
      '_No source files detected for architectural analysis._',
      '',
    ].join('\n');
  }

  const lines = [];
  lines.push('## Architecture');
  lines.push('');
  lines.push(`> Architecture is inferred heuristically from import analysis of ${layers.totalFiles} source files with ${layers.totalEdges} internal dependency edges.`);
  lines.push('');

  lines.push('### Module Graph');
  lines.push('');
  lines.push('```');
  lines.push(findings.asciiGraph || '_(no graph generated)_');
  lines.push('```');
  lines.push('');

  lines.push('### Layer Breakdown');
  lines.push('');
  lines.push('| Layer | Count |');
  lines.push('|-------|------:|');
  lines.push(`| Entry Points | ${layers.entryPoints.length} |`);
  lines.push(`| Core Modules | ${layers.libModules.length} |`);
  lines.push(`| Shared Utilities | ${layers.shared.length} |`);
  lines.push(`| Other | ${layers.rest.length} |`);
  lines.push(`| **Total** | **${layers.totalFiles}** |`);
  lines.push('');

  if (findings.c4Context) {
    lines.push('### C4 — System Context');
    lines.push('');
    lines.push(findings.c4Context);
    lines.push('');
  }

  if (findings.c4Container) {
    lines.push('### C4 — Containers');
    lines.push('');
    lines.push(findings.c4Container);
    lines.push('');
  }

  if (findings.c4Component) {
    lines.push('### C4 — Components');
    lines.push('');
    lines.push(findings.c4Component);
    lines.push('');
  }

  if (findings.c4Code) {
    lines.push('### C4 — Code Level');
    lines.push('');
    lines.push(findings.c4Code);
    lines.push('');
  }

  return lines.join('\n');
}
