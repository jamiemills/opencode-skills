// Architecture renderer.
//
// Renders the architecture section. When a canonical declared-layer model
// (`quality/architecture.toml` or an equivalent convention, surfaced as
// `findings.canonical`) is present, the canonical layer table (with exact
// module counts), adapter-independence groups, composition-root membership,
// and seam-wiring assignments are rendered as the PRIMARY section, and the
// legacy heuristic module graph / C4 diagrams are labelled
// "heuristic — import-derived". Without a canonical model the output is
// byte-identical to the legacy heuristic-only render.
//
// ESM only. Zero npm deps. Pure DATA. Read-only.

function renderCanonical(lines, canonical) {
  lines.push("### Canonical Layer Model — declared layer model");
  lines.push("");
  lines.push(`Declared in \`${canonical.source}\`.`);
  lines.push("");
  lines.push("| Layer | Allowed Dependencies | Module Count |");
  lines.push("|-------|----------------------|-------------:|");
  for (const layer of canonical.layers) {
    const deps = layer.allowedDeps.length > 0 ? layer.allowedDeps.join(", ") : "—";
    lines.push(`| ${layer.name} | ${deps} | ${layer.moduleCount} |`);
  }
  lines.push("");

  if (canonical.adapterIndependence.length > 0) {
    lines.push(
      `**Adapter independence groups** — ${canonical.adapterIndependence.length} group(s):`,
    );
    lines.push("");
    lines.push("| Group | Modules | May import from |");
    lines.push("|-------|---------|-----------------|");
    for (const group of canonical.adapterIndependence) {
      const shown = group.modules.slice(0, 8);
      const moduleList =
        shown.join(", ") + (group.modules.length > 8 ? ` (+${group.modules.length - 8} more)` : "");
      const deps = group.mayImportFrom.length > 0 ? group.mayImportFrom.join(", ") : "—";
      lines.push(`| ${group.name} | ${moduleList} | ${deps} |`);
    }
    lines.push("");
  }

  if (canonical.compositionRoots.modules.length > 0) {
    lines.push(
      `**Composition roots** — ${canonical.compositionRoots.modules.length} declared module(s):`,
    );
    lines.push("");
    for (const module of canonical.compositionRoots.modules) {
      lines.push(`- \`${module}\``);
    }
    lines.push("");
  }

  if (canonical.seamWirings.length > 0) {
    lines.push(`**Seam wiring** — ${canonical.seamWirings.length} assignment(s):`);
    lines.push("");
    lines.push("| File | Seam | Attribute |");
    lines.push("|------|------|-----------|");
    for (const wiring of canonical.seamWirings) {
      lines.push(`| \`${wiring.file}\` | ${wiring.seam} | \`${wiring.attribute}\` |`);
    }
    lines.push("");
  }
}

export function renderArchitecture(_repoName, findings) {
  if (!findings) return "";
  const layers = findings.layers;
  if (!layers || layers.totalFiles === 0) {
    return [
      "## Architecture",
      "",
      "_No source files detected for architectural analysis._",
      "",
    ].join("\n");
  }

  const canonical = findings.canonical && findings.canonical.detected ? findings.canonical : null;
  const heuristic = canonical ? " (heuristic — import-derived)" : "";

  const lines = [];
  lines.push("## Architecture");
  lines.push("");
  if (canonical) {
    lines.push(
      "> Architecture is reported from the declared layer model (`quality/architecture.toml`) plus heuristic import analysis.",
    );
  } else {
    lines.push(
      `> Architecture is inferred heuristically from import analysis of ${layers.totalFiles} source files with ${layers.totalEdges} internal dependency edges.`,
    );
  }
  lines.push("");

  if (canonical) renderCanonical(lines, canonical);

  lines.push(`### Module Graph${heuristic}`);
  lines.push("");
  lines.push("```");
  lines.push(findings.asciiGraph || "_(no graph generated)_");
  lines.push("```");
  lines.push("");

  lines.push(`### Layer Breakdown${heuristic}`);
  lines.push("");
  lines.push("| Layer | Count |");
  lines.push("|-------|------:|");
  lines.push(`| Entry Points | ${layers.entryPoints.length} |`);
  lines.push(`| Core Modules | ${layers.libModules.length} |`);
  lines.push(`| Shared Utilities | ${layers.shared.length} |`);
  lines.push(`| Other | ${layers.rest.length} |`);
  lines.push(`| **Total** | **${layers.totalFiles}** |`);
  lines.push("");

  if (findings.c4Context) {
    lines.push(`### C4 — System Context${heuristic}`);
    lines.push("");
    lines.push(findings.c4Context);
    lines.push("");
  }

  if (findings.c4Container) {
    lines.push(`### C4 — Containers${heuristic}`);
    lines.push("");
    lines.push(findings.c4Container);
    lines.push("");
  }

  if (findings.c4Component) {
    lines.push(`### C4 — Components${heuristic}`);
    lines.push("");
    lines.push(findings.c4Component);
    lines.push("");
  }

  if (findings.c4Code) {
    lines.push(`### C4 — Code Level${heuristic}`);
    lines.push("");
    lines.push(findings.c4Code);
    lines.push("");
  }

  return lines.join("\n");
}
