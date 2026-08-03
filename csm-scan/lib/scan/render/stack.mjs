import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

export function renderStack(repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return '';
  const { escapeField } = context;
  const lines = [];
  lines.push(`## Technology Stack — \`${escapeField(repoName)}\``);
  lines.push('');
  lines.push('| Layer | Tool | Version |');
  lines.push('|-------|------|---------|');
  lines.push(`| Runtime | ${escapeField(findings.runtime, { inTable: true })} | — |`);
  lines.push(`| Language | ${escapeField(findings.language, { inTable: true })} | — |`);
  lines.push(`| Framework | ${escapeField(findings.framework, { inTable: true })} | — |`);
  lines.push(`| Package Manager | ${escapeField(findings.packageManager, { inTable: true })} | — |`);
  if (findings.name) lines.push(`| Package | ${escapeField(findings.name, { inTable: true })} | ${escapeField(findings.version || '—', { inTable: true })} |`);
  if (findings.type) lines.push(`| Module System | ${escapeField(findings.type, { inTable: true })} | — |`);
  if (findings.main) lines.push(`| Entry Point | \`${escapeField(findings.main, { inTable: true })}\` | — |`);
  lines.push('');
  const versionPins = [];
  if (findings.nodeVersion) versionPins.push(`Node \`${escapeField(findings.nodeVersion, { inTable: true })}\``);
  if (findings.rustVersion) versionPins.push(`Rust MSRV \`${escapeField(findings.rustVersion, { inTable: true })}\``);
  if (findings.requiresPython) versionPins.push(`requires-python \`${escapeField(findings.requiresPython, { inTable: true })}\``);
  if (versionPins.length > 0) {
    lines.push(`- **Version pins**: ${versionPins.join(' · ')}`);
    lines.push('');
  }
  if (findings.keyDeps && findings.keyDeps.length > 0) {
    lines.push('### Dependencies');
    lines.push('');
    for (const dep of findings.keyDeps) {
      const ver = findings.deps[dep] || '—';
      lines.push(`- \`${escapeField(dep)}\` — ${escapeField(ver)}`);
    }
    lines.push('');
  }
  if (findings.keyDevDeps && findings.keyDevDeps.length > 0) {
    lines.push('### Dev Dependencies');
    lines.push('');
    for (const dep of findings.keyDevDeps) {
      const ver = findings.devDeps[dep] || '—';
      lines.push(`- \`${escapeField(dep)}\` — ${escapeField(ver)}`);
    }
    lines.push('');
  }
  if (findings.scripts && Object.keys(findings.scripts).length > 0) {
    lines.push('### Scripts');
    lines.push('');
    lines.push('| Script | Command |');
    lines.push('|--------|---------|');
    for (const [name, cmd] of Object.entries(findings.scripts)) {
      lines.push(`| ${escapeField(name, { inTable: true })} | \`${escapeField(cmd, { inTable: true })}\` |`);
    }
    lines.push('');
  }
  if (findings.docker || findings.ci) {
    lines.push('### Infrastructure');
    lines.push('');
    if (findings.docker) lines.push('- Docker support detected (Dockerfile / docker-compose.yml)');
    if (findings.ci) lines.push('- CI/CD detected (`.github/workflows/`)');
    lines.push('');
  }
  return lines.join('\n');
}
