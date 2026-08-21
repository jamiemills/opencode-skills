import { DEFAULT_RENDER_CONTEXT } from "./base.mjs";

export function renderDocumentation(_repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return "";
  const { escapeField } = context;
  const lines = [];
  lines.push("## Documentation");
  lines.push("");

  if (findings.readme) {
    const r = findings.readme;
    lines.push(
      `- **README**: ${r.present ? `\`${escapeField(r.path || "README.md")}\`` : "not found"}`,
    );
    if (r.present) {
      if (r.sections > 0) lines.push(`  - Sections detected: ${r.sections}`);
      if (r.hasSetup) lines.push("  - Has setup/installation instructions");
      if (r.hasArchitecture) lines.push("  - Has architecture section");
      if (r.hasApi) lines.push("  - Has API documentation section");
      if (r.hasContributing) lines.push("  - Has contributing section");
      if (r.hasLicense) lines.push("  - References license");
      if (r.badges > 0)
        lines.push(
          `  - Badges: ${r.badges} ${r.badgeTypes.length > 0 ? `(${escapeField(r.badgeTypes.join(", "))})` : ""}`,
        );
    }
  }

  if (findings.contributing) {
    lines.push(
      `- **CONTRIBUTING.md**: ${findings.contributing.present ? `\`${escapeField(findings.contributing.path)}\`` : "not found"}`,
    );
  }
  if (findings.codeOfConduct) {
    lines.push("- **CODE_OF_CONDUCT.md**: present");
  }

  if (findings.security) {
    if (findings.security.present) {
      lines.push(`- **SECURITY.md**: \`${escapeField(findings.security.path)}\``);
      if (findings.security.purpose) {
        lines.push(`  - Purpose: ${escapeField(findings.security.purpose)}`);
      }
    }
  }

  if (findings.license) {
    lines.push(
      `- **License**: ${findings.license.present ? escapeField(findings.license.name) : "not found"}`,
    );
    if (findings.license.present && findings.license.path) {
      lines.push(`  - File: \`${escapeField(findings.license.path)}\``);
    }
  }

  if (findings.changelog) {
    lines.push(
      `- **Changelog**: ${findings.changelog.present ? `\`${escapeField(findings.changelog.path)}\` (${escapeField(findings.changelog.format)})` : "not found"}`,
    );
    if (findings.changelog.format === "Keep a Changelog") {
      lines.push("  - Follows [Keep a Changelog](https://keepachangelog.com/) conventions");
    }
  }

  if (findings.adrs && findings.adrs.length > 0) {
    lines.push("- **Architecture Decision Records (ADRs)**:");
    for (const adr of findings.adrs) {
      lines.push(
        `  - \`${escapeField(adr.path)}\` (${adr.count} record${adr.count !== 1 ? "s" : ""})`,
      );
    }
  }

  if (
    findings.referenceDocs &&
    findings.referenceDocs.present &&
    Array.isArray(findings.referenceDocs.docs)
  ) {
    for (const doc of findings.referenceDocs.docs) {
      const markerText =
        Array.isArray(doc.markers) && doc.markers.length > 0
          ? `, ${escapeField(doc.markers.join(", "))}`
          : "";
      lines.push(
        `- **Reference docs**: \`${escapeField(doc.path)}\` (${doc.lines} lines${markerText})`,
      );
    }
  }

  if (
    findings.docToolchain &&
    findings.docToolchain.present &&
    findings.docToolchain.scripts.length > 0
  ) {
    lines.push(
      `- **Doc toolchain**: ${findings.docToolchain.scripts.map((script) => `\`${escapeField(script)}\``).join(", ")}`,
    );
  }

  if (findings.commentRatio && findings.commentRatio.codeLines > 0) {
    const totalLines = findings.commentRatio.commentLines + findings.commentRatio.codeLines;
    lines.push(
      `- **Comment ratio**: ${findings.commentRatio.ratio}% (${findings.commentRatio.commentLines} comment / ${totalLines} total lines)`,
    );
  }

  if (findings.todoCount > 0) {
    lines.push(`- **TODO/FIXME markers**: ${findings.todoCount} files`);
  }

  lines.push("");
  return lines.join("\n");
}
