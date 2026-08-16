import { DEFAULT_RENDER_CONTEXT } from './base.mjs';
import { isSecretPatternName } from '../deep/security.mjs';

export function renderSecurity(_repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return '';
  const { escapeField } = context;
  const { escapeField: escapeRaw } = DEFAULT_RENDER_CONTEXT;
  const lines = [];
  lines.push('## Security');
  lines.push('');

  if (findings.secrets) {
    lines.push(`- **Secret pattern matches**: ${findings.secrets.count} type(s) detected`);
    if (findings.secrets.count > 0) {
      for (const s of findings.secrets.findings) {
        const allowlisted = s && s.fixtureAllowlisted ? ' (fixture-allowlisted)' : '';
        // Pattern names come from the scanner's internal vocabulary, not repo
        // content; render them markdown-escaped only so reports stay readable.
        const patternLabel = isSecretPatternName(s.pattern) ? escapeRaw(s.pattern) : escapeField(s.pattern);
        lines.push(`  - **${patternLabel}**: ${s.totalFiles} file(s) (e.g. \`${escapeField(s.files[0] || 'unknown')}\`)${allowlisted}`);
      }
    }
  }

  if (findings.auth) {
    const firstParty = findings.auth.firstParty;
    const firstPartyClusters = firstParty && firstParty.detected ? firstParty.clusters.join(', ') : '';
    if (findings.auth.detected) {
      lines.push(`- **Authentication**: ${findings.auth.frameworks.map((f) => f.label).join(', ')}`);
      if (findings.auth.frameworks.length > 0) {
        for (const f of findings.auth.frameworks) {
          lines.push(`  - \`${escapeField(f.package)}\` → ${escapeField(f.label)}`);
        }
      }
      if (firstPartyClusters) {
        lines.push(`  - First-party auth subsystem: ${escapeField(firstPartyClusters)}`);
      }
    } else if (firstPartyClusters) {
      lines.push(`- **Authentication**: no third-party auth library; first-party auth subsystem present (${escapeField(firstPartyClusters)})`);
    } else {
      lines.push('- **Authentication**: no framework detected');
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
  if (findings.dependabotEvidence && typeof findings.dependabotEvidence === 'object') {
    const evidence = findings.dependabotEvidence;
    const status = evidence.status;
    if (status === 'configured') {
      lines.push('- **Dependabot**: configured');
    } else if (status === 'inferred') {
      lines.push('- **Dependabot**: not configured (no .github/dependabot.yml); dependabot/* branches present');
      if (Array.isArray(evidence.branches) && evidence.branches.length > 0) {
        const shown = evidence.branches.slice(0, 5).map((b) => `\`${escapeField(b)}\``).join(', ');
        lines.push(`  - Branch evidence: ${shown}${evidence.branchCount > 5 ? ` (+${evidence.branchCount - 5} more)` : ''}`);
      }
    } else if (status === 'unverified') {
      lines.push('- **Dependabot**: not configured (branch evidence unverified)');
    } else {
      lines.push('- **Dependabot**: not configured');
    }
  } else if (findings.dependabot !== undefined) {
    lines.push(`- **Dependabot**: ${findings.dependabot ? 'configured' : 'not configured'}`);
  }

  if (findings.gitleaks && typeof findings.gitleaks === 'object') {
    const g = findings.gitleaks;
    if (g.configPresent || g.ignorePresent) {
      const parts = [];
      if (g.configPresent) {
        parts.push(`.gitleaks.toml present (${g.allowlistPathCount} allowlisted path(s), ${g.stopwordCount} stopword(s))`);
      }
      if (g.ignorePresent) {
        parts.push(`.gitleaksignore present (${g.ignoreEntryCount} entr${g.ignoreEntryCount === 1 ? 'y' : 'ies'})`);
      }
      lines.push(`- **Gitleaks context**: ${parts.join('; ')}`);
      if (Array.isArray(g.fixtureAllowlisted) && g.fixtureAllowlisted.length > 0) {
        lines.push(`  - Fixture-allowlisted pattern(s): ${escapeField(g.fixtureAllowlisted.join(', '))} (inferred)`);
      }
    }
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

  // F-002/F-018 disclosure: a truncated scan window or a failed hidden-file
  // enumeration must be visible in the report, never silently dropped.
  const coverage = findings.scanCoverage;
  if (coverage && typeof coverage === 'object'
      && ((typeof coverage.filesSkipped === 'number' && coverage.filesSkipped > 0)
        || (typeof coverage.hiddenFilesSkipped === 'number' && coverage.hiddenFilesSkipped > 0)
        || coverage.hiddenEnumerationFailed === true)) {
    const visibleTotal = (coverage.scannedFiles || 0) + (coverage.filesSkipped || 0);
    const hiddenStatus = coverage.hiddenEnumerationFailed === true ? 'FAILED' : 'OK';
    lines.push(
      `- **Scan coverage**: ${coverage.scannedFiles || 0} of ${visibleTotal} visible file(s) scanned; `
        + `${coverage.hiddenScanned || 0} hidden file(s) scanned; hidden enumeration ${hiddenStatus}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}
