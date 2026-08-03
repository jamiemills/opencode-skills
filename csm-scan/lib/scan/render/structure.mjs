import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

export function renderStructure(repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return '';
  const { escapeField } = context;
  const lines = [];
  lines.push(`## Repository Structure — \`${escapeField(repoName)}\``);
  lines.push('');
  lines.push('Directory tree (max depth 4):');
  lines.push('');
  lines.push('```');
  lines.push(findings.tree || '(empty repository)');
  lines.push('```');
  lines.push('');
  lines.push('| Extension | Files |');
  lines.push('|-----------|------:|');
  const sorted = Object.entries(findings.fileCounts || {}).sort((a, b) => b[1] - a[1]);
  for (const [ext, count] of sorted) {
    lines.push(`| .${escapeField(ext, { inTable: true })} | ${count} |`);
  }
  lines.push(`| **Total** | **${findings.totalFiles || 0}** |`);
  lines.push('');
  return lines.join('\n');
}
