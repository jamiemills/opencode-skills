import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

export function renderTesting(repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return '';
  const { escapeField } = context;
  const lines = [];
  lines.push(`## Testing — \`${escapeField(repoName)}\``);
  lines.push('');

  lines.push(`- **Framework**: ${escapeField(findings.framework.join(', '))}`);
  lines.push(`- **Test files**: ${findings.fileCount}${findings.naming.length > 0 ? ` (${escapeField(findings.naming.join(', '))})` : ''}`);
  if (findings.sampleFiles && findings.sampleFiles.length > 0) {
    lines.push(`- **Sample files**: \`${escapeField(findings.sampleFiles.slice(0, 10).join('`, `'))}\``);
  }

  if (findings.testDirs && findings.testDirs.length > 0) {
    lines.push(`- **Test directories**: \`${escapeField(findings.testDirs.slice(0, 5).join('`, `'))}\``);
  }

  if (findings.coverage) {
    lines.push(`- **Coverage**: ${escapeField(findings.coverage.join(', '))}`);
  }

  if (findings.configFiles) {
    lines.push(`- **Config files**: \`${escapeField(findings.configFiles.join('`, `'))}\``);
  }

  if (findings.script) {
    lines.push(`- **Test script**: \`${escapeField(findings.script)}\``);
  }

  lines.push('');
  return lines.join('\n');
}
