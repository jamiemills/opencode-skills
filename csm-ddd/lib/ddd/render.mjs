"use strict";

import { GRAPH_FORMAT, REPORT_FORMAT } from "./contracts.mjs";

const SECTION_ORDER = [
  ["Capabilities", renderCapabilities],
  ["Context hypotheses", renderHypotheses],
  ["Terminology and conflicts", renderTerms],
  ["Seams and candidate slices", renderSeams],
  ["Coverage and open questions", renderCoverage],
];

export function renderReport({
  runId,
  generatedAt,
  repoName,
  extraction,
  synthesis,
  clarification,
}) {
  const lines = [];
  lines.push("---");
  lines.push(`format: ${REPORT_FORMAT}`);
  lines.push(`runId: ${runId}`);
  lines.push(`graphRunId: ${runId}`);
  lines.push(`generatedAt: ${generatedAt}`);
  lines.push("---");
  lines.push("");
  lines.push(`# DDD repository analysis: ${repoName}`);
  lines.push("");
  lines.push("All context claims below are hypotheses with an explicit basis and confidence.");
  lines.push(`Machine-readable companion graph run: \`${runId}\`.`);
  lines.push("");
  for (const [heading, renderer] of SECTION_ORDER) {
    lines.push(`## ${heading}`);
    lines.push("");
    lines.push(renderer(extraction, synthesis, clarification));
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderCapabilities(extraction, synthesis) {
  const rows = synthesis.capabilities.map(
    (cap) =>
      `- **${cap.dir}** — classification \`${cap.classification}\` (inbound ${cap.inbound}, outbound ${cap.outbound}); status \`observed\`, basis static_analysis`,
  );
  const gitLine =
    extraction.git?.available && extraction.git.coChangePairs.length > 0
      ? [
          ``,
          `Co-change coupling (bounded history): ${extraction.git.coChangePairs
            .slice(0, 5)
            .map((p) => `${p.a} <-> ${p.b} x${p.count}`)
            .join("; ")}`,
        ]
      : [];
  return [...(rows.length > 0 ? rows : ["No capability clusters detected."]), ...gitLine].join(
    "\n",
  );
}

function renderHypotheses(_extraction, synthesis) {
  const items = synthesis.capabilities.map(
    (cap) =>
      `- \`${cap.dir}\` is a bounded-context CANDIDATE — hypothesis only; requires domain and ownership validation.`,
  );
  for (const edge of synthesis.edges) {
    items.push(`- Relationship hypothesis: ${edge.source} -> ${edge.target} (${edge.relation}).`);
  }
  return items.length > 0 ? items.join("\n") : "No context hypotheses formed.";
}

function renderTerms(_extraction, synthesis) {
  const ambiguous = synthesis.terms.filter((t) => t.ambiguous);
  if (ambiguous.length === 0) {
    const count = synthesis.terms.length;
    return `${count} term(s) inventoried; none show conflicting meanings across directories.`;
  }
  return ambiguous
    .map(
      (term) =>
        `- AMBIGUITY: "${term.term}" appears in ${[...new Set(term.locations.map((l) => l.split("/").slice(0, -1).join("/")))].join(", ")} — competing meanings possible.`,
    )
    .join("\n");
}

function renderSeams(_extraction, synthesis, clarification) {
  const items = synthesis.seams.map((seam) =>
    [
      `- **${seam.subject}** (rank ${synthesis.ordering.find((o) => o.subject === seam.subject)?.rank ?? "?"}):`,
      `  - enabling point: ${seam.enablingPoint}`,
      `  - observable behavior: ${seam.observableBehavior}`,
      `  - side effects: ${seam.sideEffects}`,
      `  - redirectable slice: ${seam.redirectableSlice}`,
      `  - rollback: ${seam.rollbackOption}`,
    ].join("\n"),
  );
  if (clarification?.gaps?.length > 0) {
    items.push("", "Unresolved questions recorded as unverified gaps:");
    for (const gap of clarification.gaps) items.push(`  - [${gap.id}] ${gap.note}`);
  }
  return items.length > 0 ? items.join("\n") : "No seams identified.";
}

function renderCoverage(extraction, _synthesis, clarification) {
  const caps = extraction.caps;
  const answerCount = clarification?.answerCount ?? clarification?.answers?.length ?? 0;
  return [
    `Scan coverage: ${caps.filesScanned} files / ${caps.bytesScanned} bytes under caps maxFiles=${caps.maxFiles}, maxBytes=${caps.maxBytes}${caps.truncatedByFiles || caps.truncatedByBytes ? " — TRUNCATED, coverage unverified" : " — complete within bounds"}.`,
    `NORMS.md: ${extraction.norms.loaded ? (extraction.norms.authentic ? "loaded as authentic scan output" : "loaded but UNTRUSTED (no csm-scan markers)") : "not present"}.`,
    `User answers applied: ${answerCount}; unresolved gaps: ${clarification?.gaps?.length ?? 0}.`,
  ].join("\n");
}

export function parseReport(markdown) {
  const text = String(markdown);
  const fence = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fence) throw new Error("report missing front matter");
  const meta = {};
  for (const line of fence[1].split("\n")) {
    const m = /^([A-Za-z]+):\s*(.+)$/.exec(line);
    if (m) meta[m[1]] = m[2];
  }
  const sections = [];
  const headingRe = /^## (.+)$/gm;
  let match;
  while ((match = headingRe.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const next = text.indexOf("\n## ", start);
    const body = text.slice(start, next === -1 ? undefined : next).trim();
    sections.push({ heading: match[1], body });
  }
  return {
    format: meta.format,
    runId: meta.runId,
    graphRunId: meta.graphRunId,
    generatedAt: meta.generatedAt,
    title: (text.match(/^# (.+)$/m)?.[1] ?? "").trim(),
    sections,
  };
}

export function buildGraphEnvelopeObject({
  runId,
  generatedAt,
  extraction,
  synthesis,
  clarification,
}) {
  const evidence = [...extraction.evidence, ...(synthesis.evidence ?? [])];
  const claims = [...extraction.claims, ...synthesis.claims];
  if (clarification?.claims) claims.push(...clarification.claims);
  if (clarification?.evidence) evidence.push(...clarification.evidence);
  if (clarification?.gaps) claims.push(...clarification.gaps);
  const nodes = synthesis.nodes.map((n) => ({ ...n }));
  const edges = synthesis.edges.map((e) => ({ ...e }));
  const answers = (clarification?.answers ?? []).map((a) => ({
    questionId: a.questionId,
    subject: a.subject,
    value: a.value,
    providedBy: a.providedBy,
  }));
  return {
    format: GRAPH_FORMAT,
    runId,
    generatedAt,
    nodes,
    edges,
    claims,
    evidence,
    questions: clarification?.questions ?? [],
    answers,
  };
}
