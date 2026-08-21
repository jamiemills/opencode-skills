import { DEFAULT_RENDER_CONTEXT } from "./base.mjs";

export function renderStack(repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return "";
  const { escapeField } = context;
  const lines = [];
  lines.push(`## Technology Stack — \`${escapeField(repoName)}\``);
  lines.push("");
  lines.push("| Layer | Tool | Version |");
  lines.push("|-------|------|---------|");
  lines.push(`| Runtime | ${escapeField(findings.runtime, { inTable: true })} | — |`);
  lines.push(`| Language | ${escapeField(findings.language, { inTable: true })} | — |`);
  lines.push(`| Framework | ${escapeField(findings.framework, { inTable: true })} | — |`);
  lines.push(
    `| Package Manager | ${escapeField(findings.packageManager, { inTable: true })} | — |`,
  );
  if (findings.name)
    lines.push(
      `| Package | ${escapeField(findings.name, { inTable: true })} | ${escapeField(findings.version || "—", { inTable: true })} |`,
    );
  if (findings.type)
    lines.push(`| Module System | ${escapeField(findings.type, { inTable: true })} | — |`);
  if (findings.main)
    lines.push(`| Entry Point | \`${escapeField(findings.main, { inTable: true })}\` | — |`);
  lines.push("");
  const versionPins = [];
  if (findings.nodeVersion)
    versionPins.push(`Node \`${escapeField(findings.nodeVersion, { inTable: true })}\``);
  if (findings.rustVersion)
    versionPins.push(`Rust MSRV \`${escapeField(findings.rustVersion, { inTable: true })}\``);
  if (findings.requiresPython)
    versionPins.push(
      `requires-python \`${escapeField(findings.requiresPython, { inTable: true })}\``,
    );
  if (versionPins.length > 0) {
    lines.push(`- **Version pins**: ${versionPins.join(" · ")}`);
    lines.push("");
  }
  if (findings.keyDeps && findings.keyDeps.length > 0) {
    lines.push("### Dependencies");
    lines.push("");
    for (const dep of findings.keyDeps) {
      const ver = findings.deps[dep] || "—";
      lines.push(`- \`${escapeField(dep)}\` — ${escapeField(ver)}`);
    }
    lines.push("");
  }
  const devTools =
    findings.devTools && findings.devTools.length > 0
      ? findings.devTools
      : findings.keyDevDeps
        ? findings.keyDevDeps.map((name) => ({
            name,
            spec: findings.devDeps[name] || null,
            sources: ["devDependencies"],
          }))
        : null;
  if (devTools && devTools.length > 0) {
    lines.push("### Dev Dependencies");
    lines.push("");
    for (const tool of devTools) {
      const spec = tool.spec || "—";
      const extras = tool.sources
        .filter((source) => source.startsWith("optionalDependencies:"))
        .map((source) => source.slice("optionalDependencies:".length));
      const suffix = extras.length > 0 ? ` (extra: ${extras.join(", ")})` : "";
      lines.push(`- \`${escapeField(tool.name)}\` — ${escapeField(spec)}${suffix}`);
    }
    lines.push("");
  }
  if (findings.scripts && Object.keys(findings.scripts).length > 0) {
    lines.push("### Scripts");
    lines.push("");
    // T005: script bodies can embed deploy tokens and registry credentials, so
    // only the script name and a command count are rendered — never the body.
    lines.push("| Script | Commands |");
    lines.push("|--------|----------|");
    for (const [name, cmd] of Object.entries(findings.scripts)) {
      const count = Array.isArray(cmd) ? cmd.length : 1;
      lines.push(`| ${escapeField(name, { inTable: true })} | ${count} command(s) |`);
    }
    lines.push("");
  }
  if (findings.docker || findings.ci) {
    lines.push("### Infrastructure");
    lines.push("");
    if (findings.docker) lines.push("- Docker support detected (Dockerfile / docker-compose.yml)");
    if (findings.ci) lines.push("- CI/CD detected (`.github/workflows/`)");
    lines.push("");
  }
  return lines.join("\n");
}
