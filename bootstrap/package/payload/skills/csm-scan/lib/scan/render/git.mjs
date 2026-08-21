import { DEFAULT_RENDER_CONTEXT } from "./base.mjs";

export function renderGit(_repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return "";
  if (!findings.isGit) {
    return ["## Git Practices", "", "_No git repository detected._", ""].join("\n");
  }

  const { escapeField } = context;
  const lines = [];
  lines.push("## Git Practices");
  lines.push("");
  lines.push(`- **Overview**: ${escapeField(findings.overview || "N/A")}`);
  lines.push(`- **Branch pattern**: ${escapeField(findings.branchPattern || "N/A")}`);
  lines.push(`- **Default branch**: ${escapeField(findings.defaultBranch || "N/A")}`);
  lines.push(`- **Commit style**: ${escapeField(findings.commitStyle || "N/A")}`);
  lines.push(`- **PR template**: ${findings.prTemplate ? "Yes" : "No"}`);
  lines.push(`- **Issue templates**: ${findings.hasIssueTemplates ? "Yes" : "No"}`);
  lines.push(`- **Remote**: ${escapeField(findings.remote || "N/A")}`);
  lines.push(`- **Contributors**: ${findings.contributorCount || 0}`);
  lines.push("");

  if (findings.prTemplate) {
    lines.push("- PR template found (`.github/PULL_REQUEST_TEMPLATE.md`)");
    lines.push("");
  }
  if (findings.hasIssueTemplates) {
    lines.push("- Issue templates found (`.github/ISSUE_TEMPLATE/`)");
    lines.push("");
  }

  return lines.join("\n");
}
