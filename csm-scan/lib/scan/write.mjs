import { writeFile } from 'node:fs/promises';

function escapeMd(s) {
  return String(s).replace(/[|\\`*_{}[\]<>#+\-.]/g, '\\$&');
}

function formatBytes(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function findDim(deep, name) {
  return deep.find((d) => d.dimension === name)?.findings;
}

function structureSection(repoName, findings) {
  if (!findings) return '';
  const lines = [];
  lines.push(`## Repository Structure — \`${escapeMd(repoName)}\``);
  lines.push('');
  lines.push('**[observed]** Directory tree (max depth 4):');
  lines.push('');
  lines.push('```');
  lines.push(findings.tree || '(empty repository)');
  lines.push('```');
  lines.push('');
  lines.push('| Extension | Files |');
  lines.push('|-----------|------:|');
  const sorted = Object.entries(findings.fileCounts || {}).sort((a, b) => b[1] - a[1]);
  for (const [ext, count] of sorted) {
    lines.push(`| .${escapeMd(ext)} | ${count} |`);
  }
  lines.push(`| **Total** | **${findings.totalFiles || 0}** |`);
  lines.push('');
  return lines.join('\n');
}

function stackSection(repoName, findings) {
  if (!findings) return '';
  const lines = [];
  lines.push(`## Technology Stack — \`${escapeMd(repoName)}\``);
  lines.push('');
  lines.push('| Layer | Tool | Version |');
  lines.push('|-------|------|---------|');
  lines.push(`| Runtime | ${escapeMd(findings.runtime)} | — |`);
  lines.push(`| Language | ${escapeMd(findings.language)} | — |`);
  lines.push(`| Framework | ${escapeMd(findings.framework)} | — |`);
  lines.push(`| Package Manager | ${escapeMd(findings.packageManager)} | — |`);
  if (findings.name) lines.push(`| Package | ${escapeMd(findings.name)} | ${escapeMd(findings.version || '—')} |`);
  if (findings.type) lines.push(`| Module System | ${escapeMd(findings.type)} | — |`);
  if (findings.main) lines.push(`| Entry Point | \`${escapeMd(findings.main)}\` | — |`);
  lines.push('');
  if (findings.keyDeps && findings.keyDeps.length > 0) {
    lines.push('### Dependencies');
    lines.push('');
    for (const dep of findings.keyDeps) {
      const ver = findings.deps[dep] || '—';
      lines.push(`- \`${escapeMd(dep)}\` — ${escapeMd(ver)}`);
    }
    lines.push('');
  }
  if (findings.keyDevDeps && findings.keyDevDeps.length > 0) {
    lines.push('### Dev Dependencies');
    lines.push('');
    for (const dep of findings.keyDevDeps) {
      const ver = findings.devDeps[dep] || '—';
      lines.push(`- \`${escapeMd(dep)}\` — ${escapeMd(ver)}`);
    }
    lines.push('');
  }
  if (findings.scripts && Object.keys(findings.scripts).length > 0) {
    lines.push('### Scripts');
    lines.push('');
    lines.push('| Script | Command |');
    lines.push('|--------|---------|');
    for (const [name, cmd] of Object.entries(findings.scripts)) {
      lines.push(`| ${escapeMd(name)} | \`${escapeMd(cmd)}\` |`);
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

function configSection(repoName, findings) {
  if (!findings) return '';
  const lines = [];
  lines.push(`## Configuration — \`${escapeMd(repoName)}\``);
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

  if (findings.lint) {
    lines.push(`| **[observed]** Lint | \`${escapeMd(findings.lint.config)}\` | ${escapeMd(findings.lint.style)} config |`);
  } else {
    lines.push('| **[unverified]** Lint | — | not detected |');
  }

  if (findings.format) {
    lines.push(`| **[observed]** Format | \`${escapeMd(findings.format)}\` | prettier |`);
  } else {
    lines.push('| **[unverified]** Format | — | not detected |');
  }

  if (findings.typescript) {
    const details = [
      findings.typescript.strict ? 'strict' : '',
      findings.typescript.target ? `target: ${findings.typescript.target}` : '',
      findings.typescript.paths ? 'path aliases' : '',
    ].filter(Boolean).join(', ');
    lines.push(`| TypeScript | \`tsconfig.json\` | ${escapeMd(details) || 'present'} |`);
  } else {
    lines.push('| TypeScript | — | not detected |');
  }

  lines.push('');

  if (findings.scripts) {
    lines.push('### NPM Scripts');
    lines.push('');
    lines.push('| Script | Command |');
    lines.push('|--------|---------|');
    for (const [name, cmd] of Object.entries(findings.scripts)) {
      lines.push(`| ${escapeMd(name)} | \`${escapeMd(cmd)}\` |`);
    }
    lines.push('');
  }

  if (findings.ci) {
    lines.push('### CI/CD');
    lines.push('');
    lines.push(`- **Platform**: ${escapeMd(findings.ci.platform)}`);
    lines.push(`- **Workflows**: ${findings.ci.workflowCount}`);
    if (findings.ci.jobs.length > 0) {
      lines.push(`- **Jobs**: ${escapeMd(findings.ci.jobs.join(', '))}`);
    }
    lines.push('');
  }

  if (findings.docker) {
    lines.push('### Docker');
    lines.push('');
    for (const f of findings.docker) {
      lines.push(`- \`${escapeMd(f)}\``);
    }
    lines.push('');
  }

  if (findings.envVars) {
    lines.push('### Environment Variables');
    lines.push('');
    for (const env of findings.envVars) {
      lines.push(`- **${escapeMd(env.file)}**: ${env.varCount} variables`);
      if (env.vars.length > 0) {
        lines.push(`  - \`${escapeMd(env.vars.join('`, `'))}\``);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function testingSection(repoName, findings) {
  if (!findings) return '';
  const lines = [];
  lines.push(`## Testing — \`${escapeMd(repoName)}\``);
  lines.push('');

  lines.push(`- **[observed]** **Framework**: ${escapeMd(findings.framework.join(', '))}`);
  lines.push(`- **[observed]** **Test files**: ${findings.fileCount}${findings.naming.length > 0 ? ` (${escapeMd(findings.naming.join(', '))})` : ''}`);
  if (findings.sampleFiles && findings.sampleFiles.length > 0) {
    lines.push(`- **[observed]** **Sample files**: \`${escapeMd(findings.sampleFiles.slice(0, 10).join('`, `'))}\``);
  }

  if (findings.testDirs && findings.testDirs.length > 0) {
    lines.push(`- **Test directories**: \`${escapeMd(findings.testDirs.slice(0, 5).join('`, `'))}\``);
  }

  if (findings.coverage) {
    lines.push(`- **Coverage**: ${escapeMd(findings.coverage.join(', '))}`);
  }

  if (findings.configFiles) {
    lines.push(`- **Config files**: \`${escapeMd(findings.configFiles.join('`, `'))}\``);
  }

  if (findings.script) {
    lines.push(`- **Test script**: \`${escapeMd(findings.script)}\``);
  }

  lines.push('');
  return lines.join('\n');
}

function conventionsSection(repoName, findings) {
  if (!findings) return '';
  const lines = [];
  lines.push(`## Code Conventions — \`${escapeMd(repoName)}\``);
  lines.push('');

  if (findings.importStyle) {
    lines.push(`- **[inferred]** **Import style**: ${escapeMd(findings.importStyle.type)}`);
    if (findings.importStyle.hasTypeImports) {
      lines.push('  - Uses `import type` for type-only imports');
    }
    if (findings.importStyle.hasDynamicImports) {
      lines.push('  - Uses dynamic `import()` calls');
    }
    if (findings.importStyle.samples.length > 0) {
      lines.push('  - Sample imports:');
      for (const s of findings.importStyle.samples) {
        lines.push(`    - \`${escapeMd(s.file)}\`: \`${escapeMd(s.line)}\``);
      }
    }
  }

  if (findings.fileNaming) {
    lines.push(`- **[inferred]** **File naming**: ${escapeMd(findings.fileNaming.dominant)} (of ${findings.fileNaming.total} files sampled)`);
    const sorted = Object.entries(findings.fileNaming.patterns).sort((a, b) => b[1] - a[1]);
    const patternSummary = sorted.map(([k, v]) => `${k}: ${v}`).join(', ');
    lines.push(`  - Distribution: ${escapeMd(patternSummary)}`);
  }

  if (findings.errorHandling) {
    lines.push(`- **Error handling**: ${escapeMd(findings.errorHandling.patterns.join(', '))}`);
  }

  if (findings.moduleSystem) {
    lines.push(`- **Module system**: ${escapeMd(findings.moduleSystem.inferred)}`);
    if (findings.moduleSystem.packageJsonType) {
      lines.push(`  - package.json \`type\`: "${findings.moduleSystem.packageJsonType}"`);
    }
  }

  if (findings.commentDensity) {
    lines.push(`- **Comment density**: ${escapeMd(findings.commentDensity)}`);
  }

  if (findings.docstrings && Object.keys(findings.docstrings.patterns).length > 0) {
    lines.push('');
    lines.push('### Docstrings');
    lines.push('');
    for (const [lang, pattern] of Object.entries(findings.docstrings.patterns)) {
      lines.push(`- **${escapeMd(lang)}**: ${escapeMd(pattern)}`);
      if (findings.docstrings.coverage[lang]) {
        lines.push(`  - Coverage: ${escapeMd(findings.docstrings.coverage[lang])}`);
      }
    }
    if (findings.docstrings.samples.length > 0) {
      lines.push('');
      lines.push('| Language | File | Symbol |');
      lines.push('|----------|------|--------|');
      for (const s of findings.docstrings.samples) {
        lines.push(`| ${escapeMd(s.language)} | \`${escapeMd(s.file)}\` | \`${escapeMd(s.symbol)}\` |`);
      }
    }
  }

  if (findings.languageStandards) {
    const ls = findings.languageStandards;
    if (ls.standards.length > 0) {
      lines.push('');
      lines.push('### Language Standards');
      lines.push('');
      for (const std of ls.standards) {
        lines.push(`- ${escapeMd(std)}`);
      }
    }
    if (ls.inferred.length > 0) {
      lines.push('');
      lines.push('### Inferred/Detected');
      lines.push('');
      for (const inf of ls.inferred) {
        lines.push(`- ${escapeMd(inf)}`);
      }
    }
  }

  if (findings.largestFiles && findings.largestFiles.length > 0) {
    lines.push('');
    lines.push('### Largest Files');
    lines.push('');
    lines.push('| File | Size |');
    lines.push('|------|-----:|');
    for (const f of findings.largestFiles) {
      lines.push(`| \`${escapeMd(f.path)}\` | ${escapeMd(f.size)} |`);
    }
    lines.push('');
  }

  lines.push('');
  return lines.join('\n');
}

function gitSection(findings) {
  if (!findings) return '';
  if (!findings.isGit) {
    return [
      '## Git Practices',
      '',
      '_No git repository detected._',
      '',
    ].join('\n');
  }

  const lines = [];
  lines.push('## Git Practices');
  lines.push('');
  lines.push(`- **[observed]** **Overview**: ${escapeMd(findings.overview || 'N/A')}`);
  lines.push(`- **[inferred]** **Branch pattern**: ${escapeMd(findings.branchPattern || 'N/A')}`);
  lines.push(`- **[observed]** **Default branch**: ${escapeMd(findings.defaultBranch || 'N/A')}`);
  lines.push(`- **[inferred]** **Commit style**: ${escapeMd(findings.commitStyle || 'N/A')}`);
  lines.push(`- **PR template**: ${findings.prTemplate ? 'Yes' : 'No'}`);
  lines.push(`- **Issue templates**: ${findings.hasIssueTemplates ? 'Yes' : 'No'}`);
  lines.push(`- **Remote**: ${escapeMd(findings.remote || 'N/A')}`);
  lines.push(`- **Contributors**: ${findings.contributorCount || 0}`);
  lines.push('');

  if (findings.topContributors && findings.topContributors.length > 0) {
    lines.push('### Top Contributors');
    lines.push('');
    lines.push('| Contributor | Commits |');
    lines.push('|-------------|--------:|');
    for (const c of findings.topContributors) {
      lines.push(`| ${escapeMd(c.name)} | ${c.commits} |`);
    }
    lines.push('');
  }

  if (findings.prTemplate) {
    lines.push('- PR template found (`.github/PULL_REQUEST_TEMPLATE.md`)');
    lines.push('');
  }
  if (findings.hasIssueTemplates) {
    lines.push('- Issue templates found (`.github/ISSUE_TEMPLATE/`)');
    lines.push('');
  }

  return lines.join('\n');
}

function architectureSection(findings) {
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
  lines.push(`> **[inferred]** Architecture is inferred heuristically from import analysis of ${layers.totalFiles} source files with ${layers.totalEdges} internal dependency edges.`);
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

function overviewSection(overview) {
  if (!overview) return '';
  const lines = [];
  lines.push('## Repository Overview');
  lines.push('');
  lines.push(`- **[observed]** **Name**: ${escapeMd(overview.name || 'unknown')}`);
  lines.push(`- **[observed]** **Path**: \`${escapeMd(overview.path || '')}\``);
  lines.push(`- **[observed]** **Languages**: ${escapeMd((overview.languages || []).join(', ') || 'none detected')}`);
  lines.push(`- **[observed]** **Package Manager**: ${escapeMd(overview.packageManager || 'unknown')}`);
  lines.push(`- **[observed]** **Total Files**: ${overview.totalFiles || 0}`);
  if (overview.isGit) lines.push(`- **[observed]** **Git**: yes (${escapeMd(overview.gitRoot || '')})`);
  if (overview.description) lines.push(`- **[observed]** **Description**: ${escapeMd(overview.description)}`);
  lines.push('');
  return lines.join('\n');
}

function documentationSection(findings) {
  if (!findings) return '';
  const lines = [];
  lines.push('## Documentation');
  lines.push('');

  if (findings.readme) {
    const r = findings.readme;
    lines.push(`- **[observed]** **README**: ${r.present ? `\`${escapeMd(r.path || 'README.md')}\`` : 'not found'}`);
    if (r.present) {
      if (r.sections > 0) lines.push(`  - Sections detected: ${r.sections}`);
      if (r.hasSetup) lines.push('  - Has setup/installation instructions');
      if (r.hasArchitecture) lines.push('  - Has architecture section');
      if (r.hasApi) lines.push('  - Has API documentation section');
      if (r.hasContributing) lines.push('  - Has contributing section');
      if (r.hasLicense) lines.push('  - References license');
      if (r.badges > 0) lines.push(`  - Badges: ${r.badges} ${r.badgeTypes.length > 0 ? `(${escapeMd(r.badgeTypes.join(', '))})` : ''}`);
    }
  }

  if (findings.contributing) {
    lines.push(`- **CONTRIBUTING.md**: ${findings.contributing.present ? `\`${escapeMd(findings.contributing.path)}\`` : 'not found'}`);
  }
  if (findings.codeOfConduct) {
    lines.push('- **CODE_OF_CONDUCT.md**: present');
  }

  if (findings.license) {
    lines.push(`- **License**: ${findings.license.present ? escapeMd(findings.license.name) : 'not found'}`);
    if (findings.license.present && findings.license.path) {
      lines.push(`  - File: \`${escapeMd(findings.license.path)}\``);
    }
  }

  if (findings.changelog) {
    lines.push(`- **Changelog**: ${findings.changelog.present ? `\`${escapeMd(findings.changelog.path)}\` (${escapeMd(findings.changelog.format)})` : 'not found'}`);
    if (findings.changelog.format === 'Keep a Changelog') {
      lines.push('  - Follows [Keep a Changelog](https://keepachangelog.com/) conventions');
    }
  }

  if (findings.adrs && findings.adrs.length > 0) {
    lines.push('- **Architecture Decision Records (ADRs)**:');
    for (const adr of findings.adrs) {
      lines.push(`  - \`${escapeMd(adr.path)}\` (${adr.count} record${adr.count !== 1 ? 's' : ''})`);
    }
  }

  if (findings.commentRatio && findings.commentRatio.codeLines > 0) {
    lines.push(`- **Comment ratio**: ${findings.commentRatio.ratio}% (${findings.commentRatio.commentLines} comment / ${findings.commentRatio.codeLines} code lines)`);
  }

  if (findings.todoCount > 0) {
    lines.push(`- **TODO/FIXME markers**: ${findings.todoCount} files`);
  }

  lines.push('');
  return lines.join('\n');
}

function securitySection(findings) {
  if (!findings) return '';
  const lines = [];
  lines.push('## Security');
  lines.push('');

  if (findings.secrets) {
    lines.push(`- **[inferred]** **Secret pattern matches**: ${findings.secrets.count} type(s) detected`);
    if (findings.secrets.count > 0) {
      for (const s of findings.secrets.findings) {
        lines.push(`  - **${escapeMd(s.pattern)}**: ${s.totalFiles} file(s) (e.g. \`${escapeMd(s.files[0] || 'unknown')}\`)`);
      }
    }
  }

  if (findings.auth) {
    lines.push(`- **Authentication**: ${findings.auth.detected ? findings.auth.frameworks.map((f) => f.label).join(', ') : 'no framework detected'}`);
    if (findings.auth.detected && findings.auth.frameworks.length > 0) {
      for (const f of findings.auth.frameworks) {
        lines.push(`  - \`${escapeMd(f.package)}\` → ${escapeMd(f.label)}`);
      }
    }
  }

  if (findings.securityHeaders && findings.securityHeaders.length > 0) {
    lines.push('- **Security headers**:');
    for (const h of findings.securityHeaders) {
      lines.push(`  - ${escapeMd(h.name)} (${h.fileCount} file(s))`);
    }
  }

  if (findings.inputValidation) {
    lines.push(`- **Input validation**: ${findings.inputValidation.detected ? findings.inputValidation.libraries.map((l) => l.label).join(', ') : 'no validation library detected'}`);
    if (findings.inputValidation.detected && findings.inputValidation.libraries.length > 0) {
      for (const l of findings.inputValidation.libraries) {
        lines.push(`  - \`${escapeMd(l.package)}\` → ${escapeMd(l.label)}`);
      }
    }
  }

  if (findings.rateLimiting) {
    lines.push(`- **Rate limiting**: ${findings.rateLimiting.detected ? 'detected' : 'not detected'}`);
    if (findings.rateLimiting.detected) {
      if (findings.rateLimiting.libraries.length > 0) {
        for (const l of findings.rateLimiting.libraries) {
          lines.push(`  - \`${escapeMd(l.package)}\` → ${escapeMd(l.label)}`);
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
  if (findings.hasAuditScript) {
    lines.push('- **Audit script**: present in package.json scripts');
  }

  lines.push('');
  return lines.join('\n');
}

function operationsSection(findings) {
  if (!findings) return '';
  const lines = [];
  lines.push('## Operations');
  lines.push('');

  if (findings.dockerfiles && findings.dockerfiles.length > 0) {
    lines.push('### Docker');
    lines.push('');
    lines.push('**[observed]** Docker configuration detected:');
    lines.push('');
    for (const df of findings.dockerfiles) {
      lines.push(`- **\`${escapeMd(df.name)}\`** (${df.lineCount} lines)`);
      if (df.baseImages.length > 0) {
        lines.push(`  - Base images: ${escapeMd(df.baseImages.join(', '))}`);
      }
      if (df.isMultiStage) lines.push('  - Multi-stage build');
      if (df.isAlpine) lines.push('  - Alpine-based');
      if (df.isSlim) lines.push('  - Slim-based');
      if (df.hasHealthcheck) lines.push('  - Has HEALTHCHECK');
      if (df.hasUser) lines.push('  - Uses non-root USER');
      if (df.exposedPorts.length > 0) {
        lines.push(`  - Exposed ports: ${df.exposedPorts.join(', ')}`);
      }
      lines.push('');
    }
  }

  if (findings.dockerCompose && findings.dockerCompose.present) {
    lines.push('### Docker Compose');
    lines.push('');
    for (const svc of findings.dockerCompose.services) {
      lines.push(`- **\`${escapeMd(svc.file)}\`**: ${svc.count} services`);
      if (svc.names.length > 0) {
        lines.push(`  - Services: ${escapeMd(svc.names.join(', '))}`);
      }
    }
    if (findings.dockerCompose.networks.length > 0) {
      lines.push(`  - Networks: ${escapeMd(findings.dockerCompose.networks.join(', '))}`);
    }
    if (findings.dockerCompose.volumes.length > 0) {
      lines.push(`  - Volumes: ${escapeMd(findings.dockerCompose.volumes.join(', '))}`);
    }
    lines.push('');
  }

  if (findings.ci && findings.ci.length > 0) {
    lines.push('### CI/CD');
    lines.push('');
    for (const ci of findings.ci) {
      if (ci.platform === 'GitHub Actions') {
        lines.push(`- **${escapeMd(ci.platform)}**: ${ci.workflowCount} workflow(s)`);
        if (ci.jobs.length > 0) {
          lines.push(`  - Jobs: ${escapeMd(ci.jobs.join(', '))}`);
        }
        if (ci.triggers.length > 0) {
          lines.push(`  - Triggers: ${escapeMd(ci.triggers.join(', '))}`);
        }
      } else if (ci.platform === 'GitLab CI') {
        lines.push(`- **${escapeMd(ci.platform)}**: stages ${escapeMd((ci.stages || []).join(', ') || 'unknown')}`);
      } else {
        lines.push(`- **${escapeMd(ci.platform)}**: detected`);
      }
    }
    lines.push('');
  }

  if (findings.envConfig) {
    lines.push('### Environment Configuration');
    lines.push('');
    if (findings.envConfig.envFiles && findings.envConfig.envFiles.length > 0) {
      for (const env of findings.envConfig.envFiles) {
        lines.push(`- \`${escapeMd(env.file)}\`: ${env.varCount} variable(s)`);
      }
    }
    if (findings.envConfig.configDir) lines.push('- Config directory detected (`config/`)');
    if (findings.envConfig.appConfigFile) lines.push('- App config file detected');
    lines.push('');
  }

  if (findings.healthChecks) {
    lines.push(`- **Health checks**: ${findings.healthChecks.detected ? `${findings.healthChecks.references.length} reference(s) found` : 'not detected'}`);
    lines.push('');
  }

  if (findings.gracefulShutdown && findings.gracefulShutdown.length > 0) {
    lines.push('- **Graceful shutdown**:');
    for (const gs of findings.gracefulShutdown) {
      lines.push(`  - ${escapeMd(gs.pattern)} (${gs.fileCount} file(s))`);
    }
    lines.push('');
  }

  if (findings.monitoring && findings.monitoring.libraries && findings.monitoring.libraries.length > 0) {
    lines.push('- **Monitoring/Observability**:');
    for (const lib of findings.monitoring.libraries) {
      lines.push(`  - \`${escapeMd(lib.package)}\` → ${escapeMd(lib.label)}`);
    }
    lines.push('');
  }

  if (findings.hasMakefile) {
    lines.push('- **Makefile**: present');
  }
  if (findings.hasDockerignore) {
    lines.push('- **.dockerignore**: present');
  }
  if (findings.hasDeployScripts) {
    lines.push('- **Deploy scripts**: detected');
  }
  if (findings.procfile) {
    lines.push('- **Procfile**: present (Heroku/Platform-as-a-Service)');
  }

  lines.push('');
  return lines.join('\n');
}

function dimensionSection(dimResult) {
  const lines = [];
  let sectionBody = '';

  switch (dimResult.dimension) {
    case 'structure':
      sectionBody = structureSection('repository', dimResult.findings);
      break;
    case 'stack':
      sectionBody = stackSection('repository', dimResult.findings);
      break;
    case 'config':
      sectionBody = configSection('repository', dimResult.findings);
      break;
    case 'testing':
      sectionBody = testingSection('repository', dimResult.findings);
      break;
    case 'conventions':
      sectionBody = conventionsSection('repository', dimResult.findings);
      break;
    case 'git':
      sectionBody = gitSection(dimResult.findings);
      break;
    case 'architecture':
      sectionBody = architectureSection(dimResult.findings);
      break;
    case 'documentation':
      sectionBody = documentationSection(dimResult.findings);
      break;
    case 'security':
      sectionBody = securitySection(dimResult.findings);
      break;
    case 'operations':
      sectionBody = operationsSection(dimResult.findings);
      break;
    default:
      return '';
  }

  if (dimResult.confidence) {
    const tag = dimResult.confidence;
    const cohesion = dimResult.cohesiveness !== undefined ? ` | Cohesion: ${dimResult.cohesiveness}` : '';
    const sig = dimResult.signal ? ` | Signal: ${dimResult.signal}` : '';
    lines.push(`> **Confidence**: **[${tag}]**${cohesion}${sig}`);
    lines.push('');
  }

  lines.push(sectionBody);
  return lines.join('\n');
}

function stubSection(title) {
  return [
    `## ${escapeMd(title)}`,
    '',
    '_Not yet scanned — pending future scanner modules._',
    '',
  ].join('\n');
}

export async function writeNORMS(findings, outPath) {
  const lines = [];
  const firstRepo = findings.repos[0];
  const firstOverview = firstRepo?.overview;
  const titleRepo = firstOverview?.name || firstRepo?.overview?.name || 'unknown';

  lines.push(`# NORMS — ${escapeMd(titleRepo)}`);
  lines.push('');
  lines.push(`> Generated by csm-scan on ${findings.generated}`);
  if (findings.repos.length > 1) {
    const names = findings.repos.map((r) => r.overview?.name || 'unknown').join(', ');
    lines.push(`> Scanned repos: ${escapeMd(names)}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('### Confidence Tags');
  lines.push('');
  lines.push('| Tag | Meaning |');
  lines.push('|-----|---------|');
  lines.push('| `[observed]` | Found directly in config files, lockfiles, or explicit artifacts — high confidence |');
  lines.push('| `[inferred]` | Pattern detected from code sampling, conventions, or heuristics — moderate confidence |');
  lines.push('| `[unverified]` | Low sample size, ambiguous signal, or uncertain heuristic — low confidence |');
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const repo of findings.repos) {
    lines.push(overviewSection(repo.overview));

    for (const dim of repo.deep) {
      lines.push(dimensionSection(dim));
    }
  }

  const content = lines.join('\n');
  await writeFile(outPath, content, 'utf-8');
  return content;
}
