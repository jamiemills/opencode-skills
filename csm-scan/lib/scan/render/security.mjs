import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

export function renderSecurity(_repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return '';
  const { escapeField } = context;
  const lines = [];
  lines.push('## Security');
  lines.push('');

  if (findings.secrets) {
    lines.push(`- **Secret pattern matches**: ${findings.secrets.count} type(s) detected`);
    if (findings.secrets.count > 0) {
      for (const s of findings.secrets.findings) {
        lines.push(`  - **${escapeField(s.pattern)}**: ${s.totalFiles} file(s) (e.g. \`${escapeField(s.files[0] || 'unknown')}\`)`);
      }
    }
  }

  if (findings.auth) {
    lines.push(`- **Authentication**: ${findings.auth.detected ? findings.auth.frameworks.map((f) => f.label).join(', ') : 'no framework detected'}`);
    if (findings.auth.detected && findings.auth.frameworks.length > 0) {
      for (const f of findings.auth.frameworks) {
        lines.push(`  - \`${escapeField(f.package)}\` → ${escapeField(f.label)}`);
      }
    }
  }

  if (findings.securityHeaders && findings.securityHeaders.length > 0) {
    lines.push('- **Security headers**:');
    for (const h of findings.securityHeaders) {
      lines.push(`  - ${escapeField(h.name)} (${h.fileCount} file(s))`);
    }
  }

  if (findings.inputValidation) {
    lines.push(`- **Input validation**: ${findings.inputValidation.detected ? findings.inputValidation.libraries.map((l) => l.label).join(', ') : 'no validation library detected'}`);
    if (findings.inputValidation.detected && findings.inputValidation.libraries.length > 0) {
      for (const l of findings.inputValidation.libraries) {
        lines.push(`  - \`${escapeField(l.package)}\` → ${escapeField(l.label)}`);
      }
    }
  }

  if (findings.rateLimiting) {
    lines.push(`- **Rate limiting**: ${findings.rateLimiting.detected ? 'detected' : 'not detected'}`);
    if (findings.rateLimiting.detected) {
      if (findings.rateLimiting.libraries.length > 0) {
        for (const l of findings.rateLimiting.libraries) {
          lines.push(`  - \`${escapeField(l.package)}\` → ${escapeField(l.label)}`);
        }
      }
      if (findings.rateLimiting.codeReferences > 0) {
        lines.push(`  - Code references: ${findings.rateLimiting.codeReferences} file(s)`);
      }
    }
  }

  if (findings.envExample !== undefined) {
    lines.push(`- **.env.example**: ${findings.envExample ? 'present' : 'not found'}`);
  }
  if (findings.gitignoreEnvProtected !== undefined) {
    lines.push(`- **.env in .gitignore**: ${findings.gitignoreEnvProtected ? 'yes' : 'no'}`);
  }
  if (findings.hasLockfile !== undefined) {
    lines.push(`- **Lockfile**: ${findings.hasLockfile ? 'present' : 'not found'}`);
  }
  if (findings.dependabot !== undefined) {
    lines.push(`- **Dependabot**: ${findings.dependabot ? 'configured' : 'not configured'}`);
  }
  if (Array.isArray(findings.securityTools) && findings.securityTools.length) {
    lines.push(`- **Security tooling**: ${escapeField(findings.securityTools.join(', '))}`);
  }
  const auditLines = [];
  if (Array.isArray(findings.auditEvidence)) {
    for (const evidence of findings.auditEvidence) {
      if (!evidence || typeof evidence.tool !== 'string' || !evidence.tool) continue;
      const tool = escapeField(evidence.tool);
      if (evidence.source === 'dependency') {
        auditLines.push(`  - Declared dependency: ${tool}`);
      } else if (evidence.source === 'package-script') {
        const prefix = 'package.json#scripts.';
        const name = typeof evidence.location === 'string' && evidence.location.startsWith(prefix)
          ? evidence.location.slice(prefix.length)
          : '';
        auditLines.push(`  - Package script${name ? ` ${escapeField(name)}` : ''}: ${tool}`);
      } else if (evidence.source === 'workflow') {
        const location = typeof evidence.location === 'string' && evidence.location
          ? ` (${escapeField(evidence.location)})`
          : '';
        auditLines.push(`  - Workflow reference${location}: ${tool}`);
      } else if (evidence.source === 'makefile') {
        auditLines.push(`  - Makefile reference: ${tool}`);
      }
    }
  }
  if (auditLines.length > 0) {
    lines.push('- **Audit evidence**:');
    lines.push(...auditLines);
  } else if (findings.hasAuditScript) {
    lines.push('- **Audit evidence**: detected');
  }

  lines.push('');
  return lines.join('\n');
}
