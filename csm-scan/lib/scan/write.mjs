import { writeFile } from 'node:fs/promises';

function escapeMd(s) {
  return String(s).replace(/[|\\`*_{}[\]<>#+\-.]/g, '\\$&');
}

function formatBytes(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function structureSection(repo) {
  const s = repo.structure;
  if (!s) return '';
  const lines = [];
  lines.push(`## Repository Structure — \`${escapeMd(repo.name)}\``);
  lines.push('');
  lines.push('```');
  lines.push(s.tree || '(empty repository)');
  lines.push('```');
  lines.push('');
  lines.push('| Extension | Files |');
  lines.push('|-----------|------:|');
  const sorted = Object.entries(s.fileCounts || {}).sort((a, b) => b[1] - a[1]);
  for (const [ext, count] of sorted) {
    lines.push(`| .${escapeMd(ext)} | ${count} |`);
  }
  lines.push(`| **Total** | **${s.totalFiles || 0}** |`);
  lines.push('');
  return lines.join('\n');
}

function stackSection(repo) {
  const st = repo.stack;
  if (!st) return '';
  const lines = [];
  lines.push(`## Technology Stack — \`${escapeMd(repo.name)}\``);
  lines.push('');
  lines.push('| Layer | Tool | Version |');
  lines.push('|-------|------|---------|');
  lines.push(`| Runtime | ${escapeMd(st.runtime)} | — |`);
  lines.push(`| Language | ${escapeMd(st.language)} | — |`);
  lines.push(`| Framework | ${escapeMd(st.framework)} | — |`);
  lines.push(`| Package Manager | ${escapeMd(st.packageManager)} | — |`);
  if (st.name) lines.push(`| Package | ${escapeMd(st.name)} | ${escapeMd(st.version || '—')} |`);
  if (st.type) lines.push(`| Module System | ${escapeMd(st.type)} | — |`);
  if (st.main) lines.push(`| Entry Point | \`${escapeMd(st.main)}\` | — |`);
  lines.push('');
  if (st.keyDeps.length > 0) {
    lines.push('### Dependencies');
    lines.push('');
    for (const dep of st.keyDeps) {
      const ver = st.deps[dep] || '—';
      lines.push(`- \`${escapeMd(dep)}\` — ${escapeMd(ver)}`);
    }
    lines.push('');
  }
  if (st.keyDevDeps.length > 0) {
    lines.push('### Dev Dependencies');
    lines.push('');
    for (const dep of st.keyDevDeps) {
      const ver = st.devDeps[dep] || '—';
      lines.push(`- \`${escapeMd(dep)}\` — ${escapeMd(ver)}`);
    }
    lines.push('');
  }
  if (Object.keys(st.scripts).length > 0) {
    lines.push('### Scripts');
    lines.push('');
    lines.push('| Script | Command |');
    lines.push('|--------|---------|');
    for (const [name, cmd] of Object.entries(st.scripts)) {
      lines.push(`| ${escapeMd(name)} | \`${escapeMd(cmd)}\` |`);
    }
    lines.push('');
  }
  if (st.docker || st.ci) {
    lines.push('### Infrastructure');
    lines.push('');
    if (st.docker) lines.push('- Docker support detected (Dockerfile / docker-compose.yml)');
    if (st.ci) lines.push('- CI/CD detected (`.github/workflows/`)');
    lines.push('');
  }
  return lines.join('\n');
}

function configSection(repo) {
  const c = repo.config;
  if (!c) return '';
  const lines = [];
  lines.push(`## Configuration — \`${escapeMd(repo.name)}\``);
  lines.push('');

  const hasAny =
    c.lint || c.format || c.typescript || c.scripts || c.ci || c.docker || c.envVars;

  if (!hasAny) {
    lines.push('_No configuration files detected._');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('| Tool | Config File | Details |');
  lines.push('|------|-------------|---------|');

  if (c.lint) {
    lines.push(`| Lint | \`${escapeMd(c.lint.config)}\` | ${escapeMd(c.lint.style)} config |`);
  } else {
    lines.push('| Lint | — | not detected |');
  }

  if (c.format) {
    lines.push(`| Format | \`${escapeMd(c.format)}\` | prettier |`);
  } else {
    lines.push('| Format | — | not detected |');
  }

  if (c.typescript) {
    const details = [
      c.typescript.strict ? 'strict' : '',
      c.typescript.target ? `target: ${c.typescript.target}` : '',
      c.typescript.paths ? 'path aliases' : '',
    ].filter(Boolean).join(', ');
    lines.push(`| TypeScript | \`tsconfig.json\` | ${escapeMd(details) || 'present'} |`);
  } else {
    lines.push('| TypeScript | — | not detected |');
  }

  lines.push('');

  if (c.scripts) {
    lines.push('### NPM Scripts');
    lines.push('');
    lines.push('| Script | Command |');
    lines.push('|--------|---------|');
    for (const [name, cmd] of Object.entries(c.scripts)) {
      lines.push(`| ${escapeMd(name)} | \`${escapeMd(cmd)}\` |`);
    }
    lines.push('');
  }

  if (c.ci) {
    lines.push('### CI/CD');
    lines.push('');
    lines.push(`- **Platform**: ${escapeMd(c.ci.platform)}`);
    lines.push(`- **Workflows**: ${c.ci.workflowCount}`);
    if (c.ci.jobs.length > 0) {
      lines.push(`- **Jobs**: ${escapeMd(c.ci.jobs.join(', '))}`);
    }
    lines.push('');
  }

  if (c.docker) {
    lines.push('### Docker');
    lines.push('');
    for (const f of c.docker) {
      lines.push(`- \`${escapeMd(f)}\``);
    }
    lines.push('');
  }

  if (c.envVars) {
    lines.push('### Environment Variables');
    lines.push('');
    for (const env of c.envVars) {
      lines.push(`- **${escapeMd(env.file)}**: ${env.varCount} variables`);
      if (env.vars.length > 0) {
        lines.push(`  - \`${escapeMd(env.vars.join('`, `'))}\``);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function testingSection(repo) {
  const t = repo.testing;
  if (!t) return '';
  const lines = [];
  lines.push(`## Testing — \`${escapeMd(repo.name)}\``);
  lines.push('');

  lines.push(`- **Framework**: ${escapeMd(t.framework.join(', '))}`);
  lines.push(`- **Test files**: ${t.fileCount}${t.naming.length > 0 ? ` (${escapeMd(t.naming.join(', '))})` : ''}`);
  if (t.sampleFiles.length > 0) {
    lines.push(`- **Sample files**: \`${escapeMd(t.sampleFiles.slice(0, 10).join('`, `'))}\``);
  }

  if (t.testDirs && t.testDirs.length > 0) {
    lines.push(`- **Test directories**: \`${escapeMd(t.testDirs.slice(0, 5).join('`, `'))}\``);
  }

  if (t.coverage) {
    lines.push(`- **Coverage**: ${escapeMd(t.coverage.join(', '))}`);
  }

  if (t.configFiles) {
    lines.push(`- **Config files**: \`${escapeMd(t.configFiles.join('`, `'))}\``);
  }

  if (t.script) {
    lines.push(`- **Test script**: \`${escapeMd(t.script)}\``);
  }

  lines.push('');
  return lines.join('\n');
}

function conventionsSection(repo) {
  const cv = repo.conventions;
  if (!cv) return '';
  const lines = [];
  lines.push(`## Code Conventions — \`${escapeMd(repo.name)}\``);
  lines.push('');

  if (cv.importStyle) {
    lines.push(`- **Import style**: ${escapeMd(cv.importStyle.type)}`);
    if (cv.importStyle.hasTypeImports) {
      lines.push('  - Uses `import type` for type-only imports');
    }
    if (cv.importStyle.hasDynamicImports) {
      lines.push('  - Uses dynamic `import()` calls');
    }
    if (cv.importStyle.samples.length > 0) {
      lines.push('  - Sample imports:');
      for (const s of cv.importStyle.samples) {
        lines.push(`    - \`${escapeMd(s.file)}\`: \`${escapeMd(s.line)}\``);
      }
    }
  }

  if (cv.fileNaming) {
    lines.push(`- **File naming**: ${escapeMd(cv.fileNaming.dominant)} (of ${cv.fileNaming.total} files sampled)`);
    const sorted = Object.entries(cv.fileNaming.patterns).sort((a, b) => b[1] - a[1]);
    const patternSummary = sorted.map(([k, v]) => `${k}: ${v}`).join(', ');
    lines.push(`  - Distribution: ${escapeMd(patternSummary)}`);
  }

  if (cv.errorHandling) {
    lines.push(`- **Error handling**: ${escapeMd(cv.errorHandling.patterns.join(', '))}`);
  }

  if (cv.moduleSystem) {
    lines.push(`- **Module system**: ${escapeMd(cv.moduleSystem.inferred)}`);
    if (cv.moduleSystem.packageJsonType) {
      lines.push(`  - package.json \`type\`: "${cv.moduleSystem.packageJsonType}"`);
    }
  }

  if (cv.commentDensity) {
    lines.push(`- **Comment density**: ${escapeMd(cv.commentDensity)}`);
  }

  if (cv.largestFiles && cv.largestFiles.length > 0) {
    lines.push('');
    lines.push('### Largest Files');
    lines.push('');
    lines.push('| File | Size |');
    lines.push('|------|-----:|');
    for (const f of cv.largestFiles) {
      lines.push(`| \`${escapeMd(f.path)}\` | ${escapeMd(f.size)} |`);
    }
    lines.push('');
  }

  lines.push('');
  return lines.join('\n');
}

function gitSection(repo) {
  const g = repo.git;
  if (!g) return '';
  if (!g.isGit) {
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
  lines.push(`- **Overview**: ${escapeMd(g.overview || 'N/A')}`);
  lines.push(`- **Branch pattern**: ${escapeMd(g.branchPattern || 'N/A')}`);
  lines.push(`- **Default branch**: ${escapeMd(g.defaultBranch || 'N/A')}`);
  lines.push(`- **Commit style**: ${escapeMd(g.commitStyle || 'N/A')}`);
  lines.push(`- **PR template**: ${g.prTemplate ? 'Yes' : 'No'}`);
  lines.push(`- **Issue templates**: ${g.hasIssueTemplates ? 'Yes' : 'No'}`);
  lines.push(`- **Remote**: ${escapeMd(g.remote || 'N/A')}`);
  lines.push(`- **Contributors**: ${g.contributorCount || 0}`);
  lines.push('');

  if (g.topContributors && g.topContributors.length > 0) {
    lines.push('### Top Contributors');
    lines.push('');
    lines.push('| Contributor | Commits |');
    lines.push('|-------------|--------:|');
    for (const c of g.topContributors) {
      lines.push(`| ${escapeMd(c.name)} | ${c.commits} |`);
    }
    lines.push('');
  }

  if (g.prTemplate) {
    lines.push('- PR template found (`.github/PULL_REQUEST_TEMPLATE.md`)');
    lines.push('');
  }
  if (g.hasIssueTemplates) {
    lines.push('- Issue templates found (`.github/ISSUE_TEMPLATE/`)');
    lines.push('');
  }

  return lines.join('\n');
}

function architectureSection(repo) {
  const a = repo.architecture;
  if (!a) return '';
  const layers = a.layers;
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
  lines.push(`> **Note**: Architecture is inferred heuristically from import analysis of ${layers.totalFiles} source files with ${layers.totalEdges} internal dependency edges.`);
  lines.push('');

  lines.push('### Module Graph');
  lines.push('');
  lines.push('```');
  lines.push(a.asciiGraph || '_(no graph generated)_');
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

  if (a.c4Context) {
    lines.push('### C4 — System Context');
    lines.push('');
    lines.push(a.c4Context);
    lines.push('');
  }

  if (a.c4Container) {
    lines.push('### C4 — Containers');
    lines.push('');
    lines.push(a.c4Container);
    lines.push('');
  }

  if (a.c4Component) {
    lines.push('### C4 — Components');
    lines.push('');
    lines.push(a.c4Component);
    lines.push('');
  }

  return lines.join('\n');
}

function stubSection(title) {
  return [
    `## ${title}`,
    '',
    '_Not yet scanned — pending future scanner modules._',
    '',
  ].join('\n');
}

export async function writeNORMS(findings, outPath) {
  const lines = [];
  const firstRepo = findings.repos[0];
  const titleRepo = firstRepo ? firstRepo.name : 'unknown';

  lines.push(`# NORMS — ${escapeMd(titleRepo)}`);
  lines.push('');
  lines.push(`> Generated by csm-scan on ${findings.generated}`);
  if (findings.repos.length > 1) {
    const names = findings.repos.map((r) => r.name).join(', ');
    lines.push(`> Scanned repos: ${escapeMd(names)}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const repo of findings.repos) {
    lines.push(structureSection(repo));
    lines.push(stackSection(repo));
    lines.push(configSection(repo));
    lines.push(testingSection(repo));
    lines.push(conventionsSection(repo));
  }

  for (const repo of findings.repos) {
    lines.push(gitSection(repo));
    lines.push(architectureSection(repo));
  }

  const content = lines.join('\n');
  await writeFile(outPath, content, 'utf-8');
  return content;
}
