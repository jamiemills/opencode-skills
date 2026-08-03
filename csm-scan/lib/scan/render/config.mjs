import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

// Render a type-checker tool's display label. A pyright entry that carries a
// declared mode (deep/config.mjs enrichStrictFacts) is surfaced as
// `pyright (strict)` so the Configuration section shows the strict-mode fact
// only when pyright actually declares it.
function typeCheckerLabel(tool) {
  const name = (tool && tool.name) || String(tool);
  if (tool && tool.name === 'pyright') {
    if (tool.strict === true || tool.typeCheckingMode) {
      return `${name} (${tool.strict === true ? 'strict' : tool.typeCheckingMode})`;
    }
  }
  return name;
}

export function renderConfig(repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return '';
  const { escapeField } = context;
  const lines = [];
  lines.push(`## Configuration — \`${escapeField(repoName)}\``);
  lines.push('');

  const hasAny =
    findings.lint || findings.format || findings.typescript || findings.scripts || findings.ci || findings.docker || findings.envVars;

  if (!hasAny) {
    lines.push('_No configuration files detected._');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('| Tool | Config File | Details |');
  lines.push('|------|-------------|---------|');

  const linterNames = Array.isArray(findings.linters) && findings.linters.length
    ? findings.linters.map((l) => (l && l.name) || String(l)).join(', ')
    : (findings.lint ? findings.lint.config : null);
  if (linterNames) {
    lines.push(`| Lint | \`${escapeField(linterNames, { inTable: true })}\` | detected |`);
  } else {
    lines.push('| Lint | — | not detected |');
  }

  const formatterNames = Array.isArray(findings.formatters) && findings.formatters.length
    ? findings.formatters.map((f) => (f && f.name) || String(f)).join(', ')
    : findings.format;
  if (formatterNames) {
    lines.push(`| Format | \`${escapeField(formatterNames, { inTable: true })}\` | detected |`);
  } else {
    lines.push('| Format | — | not detected |');
  }

  const typeCheckerNames = Array.isArray(findings.typeCheckers) && findings.typeCheckers.length
    ? findings.typeCheckers.map(typeCheckerLabel).join(', ')
    : null;
  if (findings.typescript) {
    const ts = findings.typescript;
    const details = [
      ts.strict ? 'strict' : '',
      ts.target ? `target: ${ts.target}` : '',
      ts.module ? `module: ${ts.module}` : '',
      ts.moduleResolution ? `moduleResolution: ${ts.moduleResolution}` : '',
      ts.noImplicitAny ? 'noImplicitAny' : '',
      ts.declaration ? 'declaration' : '',
      ts.paths ? 'path aliases' : '',
    ].filter(Boolean).join(', ');
    lines.push(`| TypeScript | \`tsconfig.json\` | ${escapeField(details, { inTable: true }) || 'present'} |`);
  } else if (typeCheckerNames) {
    lines.push(`| Type checking | \`${escapeField(typeCheckerNames, { inTable: true })}\` | detected |`);
  } else {
    lines.push('| Type checking | — | not detected |');
  }

  if (Array.isArray(findings.hooks) && findings.hooks.length) {
    const hookNames = findings.hooks.map((h) => (h && (h.tool || h.name)) || String(h)).join(', ');
    lines.push(`| Hooks | \`${escapeField(hookNames, { inTable: true })}\` | detected |`);
  }

  lines.push('');

  if (Array.isArray(findings.buildTools) && findings.buildTools.length > 0) {
    const items = findings.buildTools.map((b) => `${escapeField(b.name)} (\`${escapeField(b.config)}\`)`).join(', ');
    lines.push(`- **Build tools**: ${items}`);
  }
  if (Array.isArray(findings.runtimes) && findings.runtimes.length > 0) {
    const items = findings.runtimes.map((r) => `${escapeField(r.name)} (\`${escapeField(r.config)}\`)`).join(', ');
    lines.push(`- **Alternative runtimes/manifests**: ${items}`);
  }
  if (Array.isArray(findings.markers) && findings.markers.length > 0) {
    lines.push(`- **Markers present**: ${escapeField(findings.markers.join(', '))}`);
  }
  lines.push('');

  if (findings.scripts) {
    lines.push('### NPM Scripts');
    lines.push('');
    lines.push('| Script | Command |');
    lines.push('|--------|---------|');
    for (const [name, cmd] of Object.entries(findings.scripts)) {
      lines.push(`| ${escapeField(name, { inTable: true })} | \`${escapeField(cmd, { inTable: true })}\` |`);
    }
    lines.push('');
  }

  if (findings.ci) {
    lines.push('### CI/CD');
    lines.push('');
    lines.push(`- **Platform**: ${escapeField(findings.ci.platform)}`);
    lines.push(`- **Workflows**: ${findings.ci.workflowCount}`);
    if (findings.ci.jobs.length > 0) {
      lines.push(`- **Jobs**: ${escapeField(findings.ci.jobs.join(', '))}`);
    }
    lines.push('');
  }

  if (findings.docker) {
    lines.push('### Docker');
    lines.push('');
    for (const f of findings.docker) {
      lines.push(`- \`${escapeField(f)}\``);
    }
    lines.push('');
  }

  if (findings.envVars) {
    lines.push('### Environment Variables');
    lines.push('');
    for (const env of findings.envVars) {
      lines.push(`- **${escapeField(env.file)}**: ${env.varCount} variables`);
      if (env.vars.length > 0) {
        lines.push(`  - \`${escapeField(env.vars.join('`, `'))}\``);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
