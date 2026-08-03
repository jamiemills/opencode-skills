import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

export function renderOperations(_repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return '';
  const { escapeField } = context;
  const lines = [];
  lines.push('## Operations');
  lines.push('');

  if (findings.dockerfiles && findings.dockerfiles.length > 0) {
    lines.push('### Docker');
    lines.push('');
    lines.push('Docker configuration detected:');
    lines.push('');
    for (const df of findings.dockerfiles) {
      lines.push(`- **\`${escapeField(df.name)}\`** (${df.lineCount} lines)`);
      if (df.baseImages.length > 0) {
        lines.push(`  - Base images: ${escapeField(df.baseImages.join(', '))}`);
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
      lines.push(`- **\`${escapeField(svc.file)}\`**: ${svc.count} services`);
      if (svc.names.length > 0) {
        lines.push(`  - Services: ${escapeField(svc.names.join(', '))}`);
      }
    }
    if (findings.dockerCompose.networks.length > 0) {
      lines.push(`  - Networks: ${escapeField(findings.dockerCompose.networks.join(', '))}`);
    }
    if (findings.dockerCompose.volumes.length > 0) {
      lines.push(`  - Volumes: ${escapeField(findings.dockerCompose.volumes.join(', '))}`);
    }
    lines.push('');
  }

  if (findings.ci && findings.ci.length > 0) {
    lines.push('### CI/CD');
    lines.push('');
    for (const ci of findings.ci) {
      if (ci.platform === 'GitHub Actions') {
        lines.push(`- **${escapeField(ci.platform)}**: ${ci.workflowCount} workflow(s)`);
        if (ci.jobs.length > 0) {
          lines.push(`  - Jobs: ${escapeField(ci.jobs.join(', '))}`);
        }
        if (ci.triggers.length > 0) {
          lines.push(`  - Triggers: ${escapeField(ci.triggers.join(', '))}`);
        }
      } else if (ci.platform === 'GitLab CI') {
        lines.push(`- **${escapeField(ci.platform)}**: stages ${escapeField((ci.stages || []).join(', ') || 'unknown')}`);
      } else {
        lines.push(`- **${escapeField(ci.platform)}**: detected`);
      }
    }
    lines.push('');
  }

  if (findings.envConfig) {
    lines.push('### Environment Configuration');
    lines.push('');
    if (findings.envConfig.envFiles && findings.envConfig.envFiles.length > 0) {
      for (const env of findings.envConfig.envFiles) {
        lines.push(`- \`${escapeField(env.file)}\`: ${env.varCount} variable(s)`);
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
      lines.push(`  - ${escapeField(gs.pattern)} (${gs.fileCount} file(s))`);
    }
    lines.push('');
  }

  if (findings.monitoring && findings.monitoring.libraries && findings.monitoring.libraries.length > 0) {
    lines.push('- **Monitoring/Observability**:');
    for (const lib of findings.monitoring.libraries) {
      lines.push(`  - \`${escapeField(lib.package)}\` → ${escapeField(lib.label)}`);
    }
    lines.push('');
  }

  if (findings.hasMakefile) {
    lines.push('- **Makefile**: present');
  }
  if (findings.hasJustfile) {
    lines.push('- **Justfile**: present');
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
