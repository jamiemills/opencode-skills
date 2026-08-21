import { DEFAULT_RENDER_CONTEXT } from "./base.mjs";

const SCOPE_CAVEAT = "rg-scoped enumeration, excluding hidden/gitignored paths";

function extTable(escapeField, entries) {
  const lines = [];
  for (const entry of entries) {
    const [ext, ...counts] = entry;
    lines.push(`| .${escapeField(ext, { inTable: true })} | ${counts.join(" | ")} |`);
  }
  return lines;
}

export function renderStructure(repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return "";
  const { escapeField } = context;
  const lines = [];
  lines.push(`## Repository Structure — \`${escapeField(repoName)}\``);
  lines.push("");
  lines.push("Directory tree (max depth 4):");
  lines.push("");
  lines.push("```");
  lines.push(findings.tree || "(empty repository)");
  lines.push("```");
  lines.push("");

  const rgCounts = findings.fileCounts || {};
  const rgTotal = findings.totalFiles || 0;
  const gitCounts = findings.gitTrackedFileCounts;
  const gitTotal = findings.gitTrackedTotalFiles;
  const dualScope =
    gitTotal != null &&
    gitCounts !== null &&
    gitCounts !== undefined &&
    typeof gitCounts === "object";

  if (dualScope) {
    lines.push(`> Total Files: ${gitTotal} git-tracked (${rgTotal} in ${SCOPE_CAVEAT}).`);
    lines.push("");
  }

  if (dualScope) {
    const exts = [...new Set([...Object.keys(rgCounts), ...Object.keys(gitCounts)])];
    const entries = exts
      .map((ext) => [ext, rgCounts[ext] ?? 0, gitCounts[ext] ?? 0])
      .toSorted((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    lines.push("| Extension | Files (rg-scoped) | Files (git-tracked) |");
    lines.push("|-----------|------------------:|--------------------:|");
    lines.push(...extTable(escapeField, entries));
    lines.push(`| **Total** | **${rgTotal}** | **${gitTotal}** |`);
  } else {
    const sorted = Object.entries(rgCounts).toSorted((a, b) => b[1] - a[1]);
    lines.push("| Extension | Files |");
    lines.push("|-----------|------:|");
    lines.push(...extTable(escapeField, sorted));
    lines.push(`| **Total** | **${rgTotal}** |`);
  }
  lines.push("");
  return lines.join("\n");
}
