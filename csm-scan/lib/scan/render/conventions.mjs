import { DEFAULT_RENDER_CONTEXT } from "./base.mjs";

export function renderConventions(repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return "";
  const { escapeField } = context;
  const lines = [];
  lines.push(`## Code Conventions — \`${escapeField(repoName)}\``);
  lines.push("");

  if (findings.enforcedConventionsBlock) {
    const block = findings.enforcedConventionsBlock;
    const ruleCount = Number.isSafeInteger(block.ruleCount) ? block.ruleCount : null;
    const sourcePath =
      typeof block.sourcePath === "string" && block.sourcePath.length > 0 ? block.sourcePath : null;
    if (ruleCount !== null && sourcePath !== null) {
      lines.push(
        `- **Enforced conventions block**: ${ruleCount} rules declared in \`${sourcePath}\` (tokenized facts in Development Practices)`,
      );
    }
  }

  if (findings.importStyle) {
    lines.push(`- **Import style**: ${escapeField(findings.importStyle.type)}`);
    if (findings.importStyle.hasTypeImports) {
      lines.push("  - Uses `import type` for type-only imports");
    }
    if (findings.importStyle.hasDynamicImports) {
      lines.push("  - Uses dynamic `import()` calls");
    }
    if (findings.importStyle.samples.length > 0) {
      lines.push("  - Sample imports:");
      for (const s of findings.importStyle.samples) {
        lines.push(`    - \`${escapeField(s.file)}\`: \`${escapeField(s.line)}\``);
      }
    }
  }

  if (findings.fileNaming) {
    const universeNote = findings.fileNaming.universe ? ` (${findings.fileNaming.universe})` : "";
    lines.push(
      `- **File naming**: ${escapeField(findings.fileNaming.dominant)} across ${findings.fileNaming.total} source files${universeNote}`,
    );
    const sorted = Object.entries(findings.fileNaming.patterns).toSorted((a, b) => b[1] - a[1]);
    const patternSummary = sorted.map(([k, v]) => `${k}: ${v}`).join(", ");
    lines.push(`  - Distribution: ${escapeField(patternSummary)}`);
  }

  if (findings.errorHandling) {
    lines.push(`- **Error handling**: ${escapeField(findings.errorHandling.patterns.join(", "))}`);
  }

  if (findings.moduleSystem) {
    lines.push(`- **Module system**: ${escapeField(findings.moduleSystem.inferred)}`);
    if (findings.moduleSystem.packageJsonType) {
      lines.push(`  - package.json \`type\`: "${findings.moduleSystem.packageJsonType}"`);
    }
  }

  if (findings.commentDensity) {
    lines.push(`- **Comment density**: ${escapeField(findings.commentDensity)}`);
  }

  if (
    findings.symbolNaming &&
    findings.symbolNaming.dominant &&
    findings.symbolNaming.dominant !== "unknown"
  ) {
    const sn = findings.symbolNaming;
    const dominantCount =
      sn.counts && typeof sn.counts[sn.dominant] === "number" ? sn.counts[sn.dominant] : null;
    const countText = dominantCount !== null ? ` (${dominantCount} symbols)` : "";
    lines.push(`- **Symbol naming**: ${escapeField(sn.dominant)} dominant${countText}`);
  }

  if (findings.asyncUsage && (findings.asyncUsage.async > 0 || findings.asyncUsage.await > 0)) {
    const au = findings.asyncUsage;
    const universeNote =
      typeof au.sourceFiles === "number" && au.sourceFiles > 0
        ? `across ${au.sourceFiles} production source files`
        : "across the production source tree";
    lines.push(
      `- **Async/await usage**: ${au.async} async declaration(s), ${au.await} await reference(s) ${universeNote}`,
    );
  }

  if (findings.unsafeCount && typeof findings.unsafeCount.count === "number") {
    const u = findings.unsafeCount;
    if (u.count === 0) {
      lines.push("- **Unsafe blocks**: 0");
    } else {
      const kinds = Object.entries(u.kinds || {})
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      lines.push(`- **Unsafe usage**: ${u.count}${kinds ? ` (${kinds})` : ""}`);
    }
  }

  if (findings.shellHygiene) {
    const sh = findings.shellHygiene;
    lines.push(
      `- **Shell hygiene**: pipefail adopted in ${escapeField(sh.pipefailAdoption || `${sh.filesWithPipefail}/${sh.totalShellFiles} files`)}`,
    );
    if (sh.shebang && sh.shebang.present > 0) {
      lines.push(
        `  - Shebangs present in ${sh.shebang.present} file(s)${sh.shebang.envBased ? ` (${sh.shebang.envBased} env-based)` : ""}`,
      );
    }
    if (sh.shellcheckDirectives > 0) {
      lines.push(`  - shellcheck directives: ${sh.shellcheckDirectives}`);
    }
  }

  if (findings.pythonTypeHints && typeof findings.pythonTypeHints.ratio === "number") {
    const th = findings.pythonTypeHints;
    const universeNote =
      typeof th.sourceFiles === "number" && th.sourceFiles > 0
        ? ` across ${th.sourceFiles} production source files`
        : "";
    lines.push(
      `- **Type hints**: ${th.ratio}% of defs annotated (${th.annotatedDefs}/${th.totalDefs})${universeNote}`,
    );
    if (th.futureAnnotations) lines.push("  - `from __future__ import annotations` present");
    if (th.pyrightTypeCheckingMode) {
      lines.push(`  - pyright typeCheckingMode: \`${th.pyrightTypeCheckingMode}\``);
    }
  }

  if (findings.tsAnnotations && typeof findings.tsAnnotations.annotationDensity === "number") {
    const ta = findings.tsAnnotations;
    lines.push(
      `- **TS annotations**: ${ta.interfaceCount} interface(s), ${ta.typeCount} type alias(es); ${ta.annotationDensity}% annotation density`,
    );
  }

  if (findings.docstrings && Object.keys(findings.docstrings.patterns).length > 0) {
    lines.push("");
    lines.push("### Docstrings");
    lines.push("");
    for (const [lang, pattern] of Object.entries(findings.docstrings.patterns)) {
      lines.push(`- **${escapeField(lang)}**: ${escapeField(pattern)}`);
      if (findings.docstrings.coverage[lang]) {
        lines.push(`  - Coverage: ${escapeField(findings.docstrings.coverage[lang])}`);
      }
    }
    if (findings.docstrings.samples.length > 0) {
      lines.push("");
      lines.push("| Language | File | Symbol |");
      lines.push("|----------|------|--------|");
      for (const s of findings.docstrings.samples) {
        lines.push(
          `| ${escapeField(s.language, { inTable: true })} | \`${escapeField(s.file, { inTable: true })}\` | \`${escapeField(s.symbol, { inTable: true })}\` |`,
        );
      }
    }
  }

  if (findings.languageStandards) {
    const ls = findings.languageStandards;
    if (ls.standards.length > 0) {
      lines.push("");
      lines.push("### Language Standards");
      lines.push("");
      for (const std of ls.standards) {
        lines.push(`- ${escapeField(std)}`);
      }
    }
    if (ls.inferred.length > 0) {
      lines.push("");
      lines.push("### Inferred/Detected");
      lines.push("");
      for (const inf of ls.inferred) {
        lines.push(`- ${escapeField(inf)}`);
      }
    }
  }

  if (findings.largestFiles && findings.largestFiles.length > 0) {
    lines.push("");
    lines.push("### Largest Files");
    lines.push("");
    lines.push("| File | Size |");
    lines.push("|------|-----:|");
    for (const f of findings.largestFiles) {
      lines.push(
        `| \`${escapeField(f.path, { inTable: true })}\` | ${escapeField(f.size, { inTable: true })} |`,
      );
    }
    lines.push("");
  }

  lines.push("");
  return lines.join("\n");
}
