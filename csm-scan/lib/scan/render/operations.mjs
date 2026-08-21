import { DEFAULT_RENDER_CONTEXT } from "./base.mjs";

export function renderOperations(_repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return "";
  const { escapeField } = context;
  const lines = [];
  lines.push("## Operations");
  lines.push("");

  if (findings.dockerfiles && findings.dockerfiles.length > 0) {
    lines.push("### Docker");
    lines.push("");
    lines.push("Docker configuration detected:");
    lines.push("");
    for (const df of findings.dockerfiles) {
      lines.push(`- **\`${escapeField(df.name)}\`** (${df.lineCount} lines)`);
      if (df.baseImages.length > 0) {
        lines.push(`  - Base images: ${escapeField(df.baseImages.join(", "))}`);
      }
      if (df.isMultiStage) lines.push("  - Multi-stage build");
      if (df.isAlpine) lines.push("  - Alpine-based");
      if (df.isSlim) lines.push("  - Slim-based");
      if (df.hasHealthcheck) lines.push("  - Has HEALTHCHECK");
      if (df.hasUser) lines.push("  - Uses non-root USER");
      if (df.exposedPorts.length > 0) {
        lines.push(`  - Exposed ports: ${df.exposedPorts.join(", ")}`);
      }
      lines.push("");
    }
  }

  if (findings.dockerCompose && findings.dockerCompose.present) {
    lines.push("### Docker Compose");
    lines.push("");
    for (const svc of findings.dockerCompose.services) {
      lines.push(`- **\`${escapeField(svc.file)}\`**: ${svc.count} services`);
      if (svc.names.length > 0) {
        lines.push(`  - Services: ${escapeField(svc.names.join(", "))}`);
      }
    }
    if (findings.dockerCompose.networks.length > 0) {
      lines.push(`  - Networks: ${escapeField(findings.dockerCompose.networks.join(", "))}`);
    }
    if (findings.dockerCompose.volumes.length > 0) {
      lines.push(`  - Volumes: ${escapeField(findings.dockerCompose.volumes.join(", "))}`);
    }
    lines.push("");
  }

  if (findings.ci && findings.ci.length > 0) {
    lines.push("### CI/CD");
    lines.push("");
    for (const ci of findings.ci) {
      if (ci.platform === "GitHub Actions") {
        lines.push(`- **${escapeField(ci.platform)}**: ${ci.workflowCount} workflow(s)`);
        if (ci.jobs.length > 0) {
          lines.push(`  - Jobs: ${escapeField(ci.jobs.join(", "))}`);
        }
        if (ci.triggers.length > 0) {
          lines.push(`  - Triggers: ${escapeField(ci.triggers.join(", "))}`);
        }
        if (ci.workflows && ci.workflows.length > 0) {
          lines.push("  - Workflows:");
          for (const workflow of ci.workflows) {
            const title = workflow.name ? `${workflow.file} (${workflow.name})` : workflow.file;
            lines.push(`    - **\`${escapeField(title)}\`**`);
            if (workflow.triggers && workflow.triggers.length > 0) {
              lines.push(`      - Triggers: ${escapeField(workflow.triggers.join(", "))}`);
            }
            if (workflow.permissions && Object.keys(workflow.permissions).length > 0) {
              const perms = Object.entries(workflow.permissions)
                .map(([scope, value]) => `\`${escapeField(scope)}: ${escapeField(value)}\``)
                .join(", ");
              lines.push(`      - Permissions: ${perms}`);
            }
            if (workflow.concurrency) {
              const conc = [];
              if (workflow.concurrency.group)
                conc.push(`group \`${escapeField(workflow.concurrency.group)}\``);
              if (workflow.concurrency.cancelInProgress !== null) {
                conc.push(`cancel-in-progress: ${workflow.concurrency.cancelInProgress}`);
              }
              if (conc.length > 0) lines.push(`      - Concurrency: ${conc.join("; ")}`);
            }
            if (workflow.jobs && workflow.jobs.length > 0) {
              lines.push("      - Jobs:");
              for (const job of workflow.jobs) {
                lines.push(`        - \`${escapeField(job.id)}\`:`);
                if (job.name) lines.push(`          - name: ${escapeField(job.name)}`);
                if (job.runsOn && job.runsOn.length > 0) {
                  const labels = job.runsOn.map((label) => `\`${escapeField(label)}\``).join(", ");
                  lines.push(`          - runs-on: ${labels}`);
                }
                if (job.needs && job.needs.length > 0) {
                  const needs = job.needs.map((n) => `\`${escapeField(n)}\``).join(", ");
                  lines.push(`          - needs: ${needs}`);
                }
                if (job.if) lines.push(`          - if: \`${escapeField(job.if)}\``);
                if (job.continueOnError !== null)
                  lines.push(`          - continue-on-error: ${job.continueOnError}`);
                if (job.matrix) {
                  const rows = Object.entries(job.matrix)
                    .map(
                      ([dim, values]) =>
                        `${escapeField(dim)}: ${values.map((v) => `\`${escapeField(v)}\``).join(", ")}`,
                    )
                    .join("; ");
                  lines.push(`          - matrix: ${rows}`);
                }
                if (job.failFast !== null) lines.push(`          - fail-fast: ${job.failFast}`);
                if (job.permissions && Object.keys(job.permissions).length > 0) {
                  const perms = Object.entries(job.permissions)
                    .map(([scope, value]) => `\`${escapeField(scope)}: ${escapeField(value)}\``)
                    .join(", ");
                  lines.push(`          - permissions: ${perms}`);
                }
              }
            }
            if (workflow.pins && workflow.pins.length > 0) {
              lines.push("      - Action pins:");
              for (const pin of workflow.pins) {
                const ref = pin.sha ? `\`${escapeField(pin.sha)}\`` : `\`${escapeField(pin.ref)}\``;
                const version = pin.version ? ` (# ${pin.version})` : "";
                lines.push(`        - \`${escapeField(pin.action)}\` @ ${ref}${version}`);
              }
            }
            if (workflow.escalatedScopes && workflow.escalatedScopes.length > 0) {
              const scopes = workflow.escalatedScopes
                .map((token) => `\`${escapeField(token)}\``)
                .join(", ");
              lines.push(`      - Escalated permissions: ${scopes}`);
            }
            if (workflow.releasePipeline) {
              const facts = [
                `oidc: ${workflow.releasePipeline.oidc}`,
                `skip-existing: ${workflow.releasePipeline.skipExisting}`,
                `triple-match: ${workflow.releasePipeline.tripleMatch}`,
              ];
              lines.push(`      - Release pipeline: ${facts.join("; ")}`);
            }
          }
        }
      } else if (ci.platform === "GitLab CI") {
        lines.push(
          `- **${escapeField(ci.platform)}**: stages ${escapeField((ci.stages || []).join(", ") || "unknown")}`,
        );
      } else {
        lines.push(`- **${escapeField(ci.platform)}**: detected`);
      }
    }
    lines.push("");
  }

  if (findings.envConfig) {
    lines.push("### Environment Configuration");
    lines.push("");
    if (findings.envConfig.envFiles && findings.envConfig.envFiles.length > 0) {
      for (const env of findings.envConfig.envFiles) {
        lines.push(`- \`${escapeField(env.file)}\`: ${env.varCount} variable(s)`);
      }
    }
    if (findings.envConfig.configDir) lines.push("- Config directory detected (`config/`)");
    if (findings.envConfig.appConfigFile) lines.push("- App config file detected");
    lines.push("");
  }

  if (findings.healthChecks) {
    lines.push(
      `- **Health checks**: ${findings.healthChecks.detected ? `${findings.healthChecks.references.length} reference(s) found` : "not detected"}`,
    );
    lines.push("");
  }

  if (findings.gracefulShutdown && findings.gracefulShutdown.length > 0) {
    lines.push("- **Graceful shutdown**:");
    for (const gs of findings.gracefulShutdown) {
      lines.push(`  - ${escapeField(gs.pattern)} (${gs.fileCount} file(s))`);
    }
    lines.push("");
  }

  if (
    findings.monitoring &&
    findings.monitoring.libraries &&
    findings.monitoring.libraries.length > 0
  ) {
    lines.push("- **Monitoring/Observability**:");
    for (const lib of findings.monitoring.libraries) {
      lines.push(`  - \`${escapeField(lib.package)}\` → ${escapeField(lib.label)}`);
    }
    lines.push("");
  }

  if (findings.hasMakefile) {
    lines.push("- **Makefile**: present");
  }
  if (findings.hasJustfile) {
    lines.push("- **Justfile**: present");
  }
  if (findings.hasDockerignore) {
    lines.push("- **.dockerignore**: present");
  }
  if (findings.hasDeployScripts) {
    lines.push("- **Deploy scripts**: detected");
  }
  if (findings.procfile) {
    lines.push("- **Procfile**: present (Heroku/Platform-as-a-Service)");
  }

  lines.push("");
  return lines.join("\n");
}
