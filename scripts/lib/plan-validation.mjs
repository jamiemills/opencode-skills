"use strict";

import fs from "node:fs";
import path from "node:path";
import { validateSchema } from "../../csm-ddd/lib/ddd/validate.mjs";

// Plan/suite validation checks extracted into an importable module (T006).
//
// Pure functions over parsed text so the behavioral test suite (T007) can
// import and exercise them directly without spawning check-suite (which
// requires the full structural repo). Also the shared home for the fenceMap /
// splitLines helpers formerly duplicated in check-suite.mjs (F-054).

// ---------------------------------------------------------------------------
// Shared markdown helpers (unified here, F-054)
// ---------------------------------------------------------------------------

export const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

export function splitLines(content) {
  return content.split(/\r?\n/);
}

// Boolean mask over lines marking those inside a fenced code block. Handles
// `` ``` ``, `~~~~`, and the longer grill template fence (```` ````).
export function fenceMap(lines) {
  const inFence = Array.from({ length: lines.length }).fill(false);
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(FENCE_OPEN_RE);
    if (open) {
      inFence[i] = true;
      if (m && m[1][0] === open.char && m[1].length >= open.len && m[2].trim() === "") open = null;
    } else if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
      open = { char: m[1][0], len: m[1].length };
      inFence[i] = true;
    }
  }
  return inFence;
}

// ---------------------------------------------------------------------------
// Machine enums and documented control values
// ---------------------------------------------------------------------------

// Planning state machine (csm-plan) and execution state machine (csm-build)
// chains plus the documented pre-execution/terminal markers. Journal rows and
// Control fields may legally reference tokens from either machine.
export const PLAN_MACHINE = [
  "INTAKE",
  "DISCOVER",
  "RESEARCH",
  "DRAFT",
  "CRITIQUE",
  "REMEDIATE",
  "VERIFY",
  "SAVED",
  "STOP",
];
export const BUILD_MACHINE = [
  "NOT_STARTED",
  "RECOVER",
  "VALIDATE",
  "SELECT",
  "DISPATCH",
  "INTEGRATE",
  "VERIFY",
  "REVIEW",
  "REPAIR",
  "CHECKPOINT",
  "COMPLETE",
  "BLOCKED",
  "PAUSED",
];
export const MACHINE_ENUM = [...new Set([...PLAN_MACHINE, ...BUILD_MACHINE])];

// Valid Control `Status:` values.
export const CONTROL_STATUSES = ["ready", "in_progress", "paused", "blocked", "complete"];

// Non-chain stop values allowed for `Current CSM state:` (build machine).
export const CONTROL_STOP_VALUES = ["NOT_STARTED", "COMPLETE", "PAUSED"];

// Terminal/superseded `Next transition:` sentinels that encode history and
// therefore exempt a plan from strict transition validation.
export const TERMINAL_SENTINELS = ["none (terminal)", "none; closed as superseded"];

// Documented prefix convention for plans saved but not yet dispatched:
// "On a future explicit csm-build invocation, <A> -> <B>"
export const NEXT_TRANSITION_PREFIX = "On a future explicit csm-build invocation, ";

// Journal Next-state values that are not machine tokens but are documented
// terminal markers in the corpus.
export const JOURNAL_TERMINALS = ["closed", "completion gate"];

// Interface-content artifact patterns that must appear in the corresponding
// SKILL.md `## Interface` section (spike default (b), C10). Full-sentence
// substring matching of INTERFACES handoff wording is infeasible — the prose
// differs from the matrix (e.g. csm-build/SKILL.md:99) — so we assert the
// artifact-path shapes instead (regex sources). Skills whose Interface prose
// carries a full path shape (csm-plan/csm-grill/csm-review) are matched at
// shape level; the rest are smoke-checked at directory/name level.
export const ARTIFACT_PATTERNS = {
  "csm-plan": [/\.agents\/plans\/<date>-<goal-slug>-csm\.json/, /NORMS\.md/],
  "csm-build": [/\.agents\/plans\//, /NORMS\.md/],
  "csm-bdd-tdd": [/NORMS\.md/, /\*-bdd-csm\.json/],
  "csm-grill": [/\.agents\/approaches\/<yyyy-mm-dd>-<idea-slug>-approach\.md/],
  "csm-review": [/NORMS\.md/, /\.agents\/reviews\/<yyyy-mm-dd>-<repo-slug>-review\.md/],
  "csm-scan": [/NORMS\.md/],
  "csm-make-tests": [
    /\.agents\/tests\/<yyyy-mm-dd>-<repo-slug>-tests-ledger\.md/,
    /\.agents\/tests\/<yyyy-mm-dd>-<repo-slug>-verification\.md/,
  ],
  "csm-browse": [],
  "csm-deep-research": [/\.agents\/research\/<yyyy-mm-dd>-<slug>-research\.md/],
  "csm-review-python": [/\.agents\/doctrine\/<yyyy-mm-dd>-<repo-slug>-python-doctrine-review\.md/],
  "csm-ddd": [
    /\.agents\/ddd\/<yyyy-mm-dd>-<repo-slug>-ddd-report\.md/,
    /\.agents\/ddd\/<yyyy-mm-dd>-<repo-slug>-ddd-graph\.json/,
  ],
};

// ---------------------------------------------------------------------------
// Small parsers shared by the checks below
// ---------------------------------------------------------------------------

// Leading uppercase token of a value, ignoring parenthetical/semicolon
// annotations, e.g. "SELECT (T003)" -> "SELECT", "NOT_STARTED; future ..." ->
// "NOT_STARTED". Non-token values are returned lower-cased as-is.
function baseToken(value) {
  const v = String(value).trim();
  const m = v.match(/^([A-Z][A-Z_]+)(?:\s*[;(].*)?$/);
  return m ? m[1] : v.toLowerCase();
}

// Exact (non-fenced) `## Title` heading range [start, end) or null.
function sectionRange(lines, inFence, title) {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!inFence[i] && lines[i].trim() === `## ${title}`) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!inFence[i] && /^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [start, end];
}

// Body lines of the first fenced block that opens after startIdx, or null.
function fencedBlockAfter(lines, inFence, startIdx) {
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (!inFence[i]) continue;
    const m = lines[i].match(FENCE_OPEN_RE);
    if (!m) continue;
    const char = m[1][0];
    const len = m[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const cm = lines[j].match(FENCE_OPEN_RE);
      if (cm && cm[1][0] === char && cm[1].length >= len && cm[2].trim() === "") return body;
      body.push(lines[j]);
    }
    return body;
  }
  return null;
}

// Parses a plan's `## Control` bullet block. Returns
// { status, currentState, nextTransition, line } or null when the section (or
// any required field) is absent. Values are the raw trimmed strings.
export function parsePlanControl(content) {
  const lines = splitLines(content);
  const inFence = fenceMap(lines);
  const range = sectionRange(lines, inFence, "Control");
  if (!range) return null;
  const control = { status: null, currentState: null, nextTransition: null, line: range[0] };
  for (let i = range[0]; i < range[1]; i += 1) {
    const m = lines[i].match(/^-\s*(Status|Current CSM state|Next transition):\s*(.*)$/);
    if (!m) continue;
    if (m[1] === "Status") control.status = m[2].trim();
    else if (m[1] === "Current CSM state") control.currentState = m[2].trim();
    else if (m[1] === "Next transition") control.nextTransition = m[2].trim();
  }
  return control;
}

// Parses a plan's `## Progress Journal` table. Returns
// { header, rows } where header is the header line (or null) and rows is the
// array of { line, cells } records (cells = the six table cells). Only table
// rows whose first cell looks like a timestamp are treated as journal rows;
// wrapped/continuation lines are ignored.
export function parseJournal(content) {
  const lines = splitLines(content);
  const inFence = fenceMap(lines);
  const range = sectionRange(lines, inFence, "Progress Journal");
  if (!range) return { header: null, rows: [] };
  let header = null;
  for (let i = range[0]; i < range[1]; i += 1) {
    if (/^\|\s*Timestamp\s*\|/.test(lines[i])) {
      header = lines[i];
      break;
    }
  }
  const rows = [];
  if (header !== null) {
    const start = lines.findIndex((l, idx) => idx > range[0] && /^\|\s*\d{4}-\d{2}-\d{2}/.test(l));
    if (start >= 0) {
      for (let i = start; i < range[1]; i += 1) {
        if (!/^\|\s*\d{4}-\d{2}-\d{2}/.test(lines[i])) continue;
        const unescaped = lines[i].replace(/\\\|/g, "\u0000");
        const parts = unescaped.split("|");
        // Some evidence cells contain raw `||` (e.g. "T001 || T003"), which
        // splits into extra empty cells; the Next-state is always the last
        // cell before the trailing pipe.
        const next =
          parts.length >= 2 ? parts[parts.length - 2].trim().replace(/\u0000/g, "|") : "";
        const cells = parts.slice(1, -1).map((c) => c.trim().replace(/\u0000/g, "|"));
        rows.push({ line: i + 1, cells, next });
      }
    }
  }
  return { header, rows };
}

// ---------------------------------------------------------------------------
// The five checks (each returns an array of failure message strings; empty =
// pass)
// ---------------------------------------------------------------------------

// (1) Control validation for `*-csm.md` plans only. Reviews and approaches use
// different grammars and are explicitly exempt. Plans whose Status is complete
// or whose Next transition is a terminal/superseded sentinel are exempt from
// the strict transition check (they encode history).
export function validatePlanControl(content) {
  const failures = [];
  const control = parsePlanControl(content);
  if (control === null) {
    failures.push('missing "## Control" section');
    return failures;
  }
  const { status, currentState, nextTransition } = control;

  if (status === null) {
    failures.push('Control lacks a "Status:" bullet');
  } else if (!CONTROL_STATUSES.includes(status)) {
    failures.push(`Control Status "${status}" not one of ${CONTROL_STATUSES.join("|")}`);
  }

  if (nextTransition === null) {
    failures.push('Control lacks a "Next transition:" bullet');
    return failures;
  }

  const raw = nextTransition.trim();
  const isTerminal =
    baseToken(raw) === "COMPLETE" || TERMINAL_SENTINELS.some((s) => raw.startsWith(s));
  const encodesHistory = status === "complete" || isTerminal;

  if (currentState === null) {
    failures.push('Control lacks a "Current CSM state:" bullet');
  } else if (!encodesHistory) {
    const tok = baseToken(currentState);
    if (!MACHINE_ENUM.includes(tok)) {
      failures.push(
        `Control Current CSM state "${currentState}" is not a machine token or documented stop value (${CONTROL_STOP_VALUES.join("/")})`,
      );
    }
  }

  if (encodesHistory) return failures; // complete/superseded plans encode history (C5)

  if (raw.startsWith(NEXT_TRANSITION_PREFIX)) {
    const pair = raw.slice(NEXT_TRANSITION_PREFIX.length).trim();
    const m = pair.match(/^([A-Z][A-Z_]+)\s*->\s*([A-Z][A-Z_]+)$/);
    const ok = m !== null && MACHINE_ENUM.includes(m[1]) && MACHINE_ENUM.includes(m[2]);
    if (!ok)
      failures.push(
        `Control Next transition prefix form has invalid pair "${pair}" (want "<A> -> <B>")`,
      );
    return failures;
  }

  const m = raw.match(/^([A-Z][A-Z_]+)\s*->\s*([A-Z][A-Z_]+)$/);
  if (m === null) {
    failures.push(
      `Control Next transition "${raw}" is not a TOKEN -> TOKEN pair, a terminal sentinel, or the documented prefix form`,
    );
  } else if (!MACHINE_ENUM.includes(m[1]) || !MACHINE_ENUM.includes(m[2])) {
    failures.push(`Control Next transition "${raw}" references a state outside the machine enum`);
  }
  return failures;
}

// (2) Journal validation: required columns present; each data row's Next-state
// value is a machine token (parenthetical/semicolon annotations allowed) or a
// documented terminal marker.
export function validatePlanJournal(content) {
  const failures = [];
  const { header, rows } = parseJournal(content);
  if (header === null) {
    failures.push(
      'missing "## Progress Journal" table header (want columns Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state)',
    );
    return failures;
  }
  const requiredColumns = [
    "Timestamp",
    "Cycle",
    "Transition",
    "Tasks",
    "Evidence/result",
    "Next state",
  ];
  const headerClean = header.replace(/\\\|/g, "");
  for (const col of requiredColumns) {
    if (
      !new RegExp(`\\|\\s*${col.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|`).test(headerClean)
    ) {
      failures.push(`journal header lacks column "${col}"`);
      return failures;
    }
  }
  if (rows.length === 0) {
    failures.push("Progress Journal has a header but no timestamped rows");
    return failures;
  }
  for (const row of rows) {
    const next = row.next;
    if (row.cells.length < 6) {
      failures.push(`journal row ${row.line} has ${row.cells.length} columns (want 6)`);
      continue;
    }
    if (next === "") {
      failures.push(`journal row ${row.line} has an empty Next state cell`);
      continue;
    }
    const tok = baseToken(next);
    if (!MACHINE_ENUM.includes(tok) && !JOURNAL_TERMINALS.includes(tok)) {
      failures.push(`journal row ${row.line} Next state "${next}" is not within the machine enum`);
    }
  }
  return failures;
}

// (3) Ordinal sequencing inside `### N. STATE` sections: ordered-list ordinals
// are strictly sequential 1..k without duplicates (catches the csm-build
// RECOVER duplicate-2 defect). Prose-only sections are skipped.
export function validateOrdinalSequencing(content) {
  const failures = [];
  const lines = splitLines(content);
  const inFence = fenceMap(lines);
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    const h = lines[i].match(/^###\s+(\d+)\.\s+(.*)$/);
    if (!h) continue;
    const ordinals = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (inFence[j]) continue;
      if (/^#{2,3}\s/.test(lines[j])) break;
      const om = lines[j].match(/^(\d+)\.\s/);
      if (om) ordinals.push(Number(om[1]));
    }
    if (ordinals.length === 0) continue;
    if (ordinals.some((n, idx) => n !== idx + 1)) {
      const dupes = ordinals.filter((n, idx) => ordinals.indexOf(n) !== idx);
      const label = `### ${h[1]}. ${h[2].trim()}`;
      if (dupes.length > 0) {
        failures.push(
          `${label} ordered list has duplicate ordinals (${dupes.join(", ")}) and is not strictly sequential: ${ordinals.join(", ")}`,
        );
      } else {
        failures.push(
          `${label} ordered list is not strictly sequential 1..${ordinals.length}: ${ordinals.join(", ")}`,
        );
      }
    }
  }
  return failures;
}

// (4) Template format-marker validation: the first non-empty line inside the
// producer template fence (`## <sectionTitle>` in the given SKILL.md content)
// must match `format: <skill>/<n>` (F-050). csm-plan -> Required Plan Document,
// csm-grill -> Required Approach Document, csm-review -> Report Format.
export function validateTemplateFormatMarkers(content, skill, sectionTitle) {
  const failures = [];
  const lines = splitLines(content);
  const inFence = fenceMap(lines);
  const range = sectionRange(lines, inFence, sectionTitle);
  if (!range) {
    failures.push(`missing "## ${sectionTitle}" section for the fenced template`);
    return failures;
  }
  const body = fencedBlockAfter(lines, inFence, range[0]);
  if (body === null) {
    failures.push(`no fenced block found under "## ${sectionTitle}"`);
    return failures;
  }
  const first = body.find((l) => l.trim() !== "");
  if (first === undefined) {
    failures.push(`template fence under "## ${sectionTitle}" is empty`);
    return failures;
  }
  const m = first.match(/^format:\s*([A-Za-z][A-Za-z0-9-]*)\/(\d+)\s*$/);
  if (!m) {
    failures.push(
      `first line inside the "## ${sectionTitle}" template fence is "${first.trim().slice(0, 60)}" — expected "format: ${skill}/<n>"`,
    );
  } else if (m[1] !== skill) {
    failures.push(`template "## ${sectionTitle}" format marker kind "${m[1]}" != "${skill}"`);
  }
  return failures;
}

// (5) Interface-content truth-source drift (option b): every artifact-path
// shape for the skill must match in its `## Interface` section text.
export function validateInterfaceArtifactPatterns(skill, interfaceText) {
  const patterns = ARTIFACT_PATTERNS[skill] || [];
  const failures = [];
  for (const re of patterns) {
    if (!re.test(interfaceText)) {
      failures.push(
        `Interface section lacks artifact pattern /${re.source}/ (INTERFACES truth-source contract)`,
      );
    }
  }
  return failures;
}

// (6) Journal/Control cross-consistency (T007 action 3). Naive equality
// (Control Current state == journal last Next-state) false-fails the corpus:
// complete/terminal plans end their journals at STOP/SAVED/CHECKPOINT/closed,
// and mid-cycle active plans legitimately move Control ahead of the journal
// before the next row is written. Enforced invariants instead:
//   - paused plans: Control `Current CSM state` == PAUSED AND the last journal
//     row Next-state == PAUSED (the F-063 resume contract);
//   - active plans (ready/in_progress/blocked): the last journal row
//     Next-state must NOT be PAUSED (a paused stop requires Status paused);
//   - complete/terminal plans: exempt (they encode history).
export function validateJournalControlConsistency(content) {
  const failures = [];
  const control = parsePlanControl(content);
  const journal = parseJournal(content);
  if (control === null || control.nextTransition === null) return failures;
  const rawNext = control.nextTransition.trim();
  const isTerminal =
    baseToken(rawNext) === "COMPLETE" || TERMINAL_SENTINELS.some((s) => rawNext.startsWith(s));
  const last = journal.rows.length > 0 ? journal.rows[journal.rows.length - 1] : null;
  if (control.status === "paused") {
    if (baseToken(control.currentState) !== "PAUSED") {
      failures.push(
        `Control Status paused but Current CSM state is "${control.currentState}" (want PAUSED)`,
      );
    }
    if (last === null || !last.next.includes("PAUSED")) {
      failures.push(
        `Control Status paused but the last journal row Next-state is ${last ? `"${last.next}"` : "absent"} (want PAUSED)`,
      );
    }
  } else if (control.status !== "complete" && !isTerminal) {
    if (last !== null && last.next.includes("PAUSED")) {
      failures.push(
        `Active plan (Status ${control.status}) but the last journal row Next-state is "${last.next}" (PAUSED requires Status paused)`,
      );
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Applicability contract (T001)
// ---------------------------------------------------------------------------

export const APPLICABILITY_SIGNALS = [
  "boundary_change",
  "public_contract",
  "ownership_or_persistence",
  "invariant_or_consistency",
  "external_side_effect",
  "migration_or_rollback",
  "cross_boundary_coordination",
  "architecture_or_refactor",
  "security_or_authority",
];

export const APPLICABILITY_DECISIONS = ["lightweight", "warranted", "mixed"];
export const APPLICABILITY_MODES = ["risk-first", "explicit-opt-in", "lightweight-bypass"];
export const OBLIGATION_STATUSES = [
  "required",
  "satisfied",
  "missing",
  "not_applicable",
  "unverified",
];
export const OBLIGATION_IDS = [
  "boundary",
  "ownership",
  "contract",
  "invariant",
  "observable_behavior",
  "seam",
  "parity",
  "rollback_recovery",
  "unresolved_risks",
];

const APPLICABILITY_KEYS = [
  "format",
  "decision",
  "mode",
  "matchedSignals",
  "evidence",
  "obligations",
  "taskApplicability",
  "dddArtifacts",
  "unresolvedRisks",
  "bypass",
  "reclassificationHistory",
];

const SIGNAL_OBLIGATIONS = {
  boundary_change: ["boundary", "observable_behavior", "seam"],
  public_contract: ["contract", "parity", "observable_behavior"],
  ownership_or_persistence: ["ownership", "invariant", "rollback_recovery"],
  invariant_or_consistency: ["invariant", "observable_behavior"],
  external_side_effect: ["boundary", "observable_behavior", "rollback_recovery"],
  migration_or_rollback: ["parity", "rollback_recovery", "unresolved_risks"],
  cross_boundary_coordination: ["boundary", "ownership", "seam"],
  architecture_or_refactor: ["boundary", "ownership", "seam", "unresolved_risks"],
  security_or_authority: ["boundary", "contract", "unresolved_risks"],
};

function applicabilitySubsection(content) {
  const lines = splitLines(content);
  const inFence = fenceMap(lines);
  const current = sectionRange(lines, inFence, "Current-State Evidence");
  if (!current) return null;
  const starts = [];
  for (let i = current[0] + 1; i < current[1]; i += 1) {
    if (!inFence[i] && lines[i].trim() === "### Applicability") {
      starts.push(i);
    }
  }
  if (starts.length === 0) return null;
  const start = starts[0];
  let end = current[1];
  for (let i = start + 1; i < current[1]; i += 1) {
    if (!inFence[i] && /^###\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { lines, inFence, start, end, duplicateHeadings: starts.length - 1 };
}

function applicabilityFences(lines, inFence, start, end) {
  const blocks = [];
  for (let i = start + 1; i < end; i += 1) {
    if (!inFence[i]) continue;
    const open = lines[i].match(FENCE_OPEN_RE);
    if (!open) continue;
    const body = [];
    let closed = false;
    for (let j = i + 1; j < end; j += 1) {
      const close = lines[j].match(FENCE_OPEN_RE);
      if (
        close &&
        close[1][0] === open[1][0] &&
        close[1].length >= open[1].length &&
        close[2].trim() === ""
      ) {
        blocks.push({ opener: open[2].trim(), body, line: i + 1, closed: true });
        closed = true;
        i = j;
        break;
      }
      body.push(lines[j]);
    }
    if (!closed) blocks.push({ opener: open[2].trim(), body, line: i + 1, closed: false });
  }
  return blocks;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function safeRelativePath(value) {
  if (!nonEmptyString(value) || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value))
    return false;
  const parts = value.replaceAll("\\", "/").split("/");
  return parts.length > 0 && !parts.some((part) => part === ".." || part === "");
}

function reportFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/);
    if (field) fields[field[1]] = field[2];
  }
  return fields;
}

function validateDddArtifact(ref, root, index) {
  const failures = [];
  if (!isObject(ref)) return [`Applicability dddArtifacts[${index}] must be a report/graph object`];
  const keys = Object.keys(ref);
  const allowed = ["report", "graph", "runId", "reportRunId", "graphRunId"];
  if (keys.some((key) => !allowed.includes(key))) {
    failures.push(`Applicability dddArtifacts[${index}] has unknown metadata`);
    return failures;
  }
  if (
    !safeRelativePath(ref.report) ||
    !safeRelativePath(ref.graph) ||
    ![ref.runId, ref.reportRunId, ref.graphRunId].every(nonEmptyString)
  ) {
    failures.push(
      `Applicability dddArtifacts[${index}] requires relative report/graph paths and run IDs`,
    );
    return failures;
  }
  if (ref.runId !== ref.reportRunId || ref.runId !== ref.graphRunId)
    failures.push(`Applicability dddArtifacts[${index}] run IDs must match`);
  const reportPath = path.resolve(root, ref.report);
  const graphPath = path.resolve(root, ref.graph);
  let report;
  let graph;
  try {
    report = fs.readFileSync(reportPath, "utf8");
  } catch {
    failures.push(`Applicability DDD report is missing: ${ref.report}`);
  }
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  } catch {
    failures.push(`Applicability DDD graph is missing or malformed: ${ref.graph}`);
  }
  if (!report || !isObject(graph)) return failures;
  const frontmatter = reportFrontmatter(report);
  if (!frontmatter)
    failures.push(`Applicability DDD report has missing or malformed metadata: ${ref.report}`);
  else {
    if (frontmatter.format !== "csm-ddd-report/1")
      failures.push("Applicability DDD report format must be csm-ddd-report/1");
    if (
      !nonEmptyString(frontmatter.runId) ||
      !nonEmptyString(frontmatter.graphRunId) ||
      !nonEmptyString(frontmatter.generatedAt)
    )
      failures.push(
        "Applicability DDD report metadata requires runId, graphRunId, and generatedAt",
      );
    if (frontmatter.runId !== frontmatter.graphRunId)
      failures.push("Applicability DDD report runId and graphRunId must match");
    if (!/coverage|unverified|not_detected|capped/i.test(report))
      failures.push("Applicability DDD report must disclose coverage metadata");
  }
  if (
    graph.format !== "csm-ddd-graph/1" ||
    !nonEmptyString(graph.runId) ||
    !nonEmptyString(graph.generatedAt)
  )
    failures.push("Applicability DDD graph metadata requires format, runId, and generatedAt");
  if (nonEmptyString(ref.runId) && frontmatter?.runId && ref.runId !== frontmatter.runId)
    failures.push("Applicability reference runId must match the report runId");
  if (nonEmptyString(ref.runId) && graph.runId && ref.runId !== graph.runId)
    failures.push("Applicability reference runId must match the graph runId");
  try {
    const schema = JSON.parse(
      fs.readFileSync(path.resolve(root, "csm-ddd/schemas/ddd-graph.schema.json"), "utf8"),
    );
    const schemaResult = validateSchema(graph, schema);
    if (!schemaResult.ok)
      failures.push(
        `Applicability DDD graph schema invalid: ${schemaResult.errors.slice(0, 3).join("; ")}`,
      );
  } catch (error) {
    failures.push(`Applicability DDD graph schema unavailable: ${error.message}`);
  }
  if (frontmatter?.graphRunId && graph.runId && frontmatter.graphRunId !== graph.runId)
    failures.push("Applicability DDD report and graph run IDs must match");
  for (const [claimIndex, claim] of (Array.isArray(graph.claims) ? graph.claims : []).entries()) {
    if (
      !isObject(claim) ||
      !nonEmptyString(claim.status) ||
      !nonEmptyString(claim.basis) ||
      !nonEmptyString(claim.confidence)
    ) {
      failures.push(
        `Applicability DDD graph claim[${claimIndex}] lacks status, basis, or confidence metadata`,
      );
    } else if (
      ![
        "observed",
        "inferred",
        "not_detected",
        "unsupported",
        "unverified",
        "not_applicable",
      ].includes(claim.status) ||
      !["static_analysis", "git_history", "norms_md", "user_provided"].includes(claim.basis) ||
      !["low", "medium", "high"].includes(claim.confidence)
    ) {
      failures.push(
        `Applicability DDD graph claim[${claimIndex}] has malformed status, basis, or confidence metadata`,
      );
    }
  }
  if (
    !["nodes", "edges", "claims", "evidence", "questions", "answers"].every((key) =>
      Array.isArray(graph[key]),
    )
  ) {
    failures.push("Applicability DDD graph is missing array coverage metadata");
  }
  return failures;
}

function requiredObligationIds(signals) {
  return [...new Set(signals.flatMap((signal) => SIGNAL_OBLIGATIONS[signal] || []))];
}

/** Parse the optional applicability block. `present: false` is legacy behavior. */
export function parsePlanApplicability(content) {
  const subsection = applicabilitySubsection(content);
  if (!subsection) return { present: false, value: null, failures: [] };
  const blocks = applicabilityFences(
    subsection.lines,
    subsection.inFence,
    subsection.start,
    subsection.end,
  );
  const failures = [];
  if (subsection.duplicateHeadings > 0) {
    failures.push(
      `Applicability heading must be unique (found ${subsection.duplicateHeadings + 1})`,
    );
  }
  if (blocks.length !== 1) {
    failures.push(
      `Applicability must contain exactly one fenced JSON block (found ${blocks.length})`,
    );
    return { present: true, value: null, failures };
  }
  const block = blocks[0];
  if (
    !/^json(?:\s+csm-applicability\/1)?$/.test(block.opener) &&
    block.opener !== "csm-applicability/1"
  ) {
    failures.push(`Applicability fence ${block.line} must be a JSON csm-applicability/1 fence`);
  }
  if (!block.closed) failures.push(`Applicability fence ${block.line} is not closed`);
  let value = null;
  try {
    value = JSON.parse(block.body.join("\n"));
  } catch (error) {
    failures.push(`Applicability JSON is malformed: ${error.message}`);
  }
  return { present: true, value, failures };
}

/** Validate the optional block, returning failure strings like the existing checks. */
export function validatePlanApplicability(content, root = process.cwd()) {
  const parsed = parsePlanApplicability(content);
  if (!parsed.present) return [];
  const failures = [...parsed.failures];
  const value = parsed.value;
  if (!isObject(value)) return [...failures, "Applicability JSON must be an object"];

  for (const key of Object.keys(value)) {
    if (!APPLICABILITY_KEYS.includes(key)) failures.push(`Applicability has unknown key "${key}"`);
  }
  for (const key of APPLICABILITY_KEYS.slice(0, 10)) {
    if (!(key in value)) failures.push(`Applicability lacks required key "${key}"`);
  }
  if (value.format !== "csm-applicability/1")
    failures.push('Applicability format must be "csm-applicability/1"');
  if (!APPLICABILITY_DECISIONS.includes(value.decision))
    failures.push(`Applicability decision "${value.decision}" is invalid`);
  if (!APPLICABILITY_MODES.includes(value.mode))
    failures.push(`Applicability mode "${value.mode}" is invalid`);
  if (!Array.isArray(value.matchedSignals))
    failures.push("Applicability matchedSignals must be an array");
  else {
    const seen = new Set();
    for (const signal of value.matchedSignals) {
      if (!APPLICABILITY_SIGNALS.includes(signal))
        failures.push(`Applicability signal "${signal}" is invalid`);
      if (seen.has(signal)) failures.push(`Applicability signal "${signal}" is duplicated`);
      seen.add(signal);
    }
  }
  if (!Array.isArray(value.evidence)) failures.push("Applicability evidence must be an array");
  else
    for (const [index, item] of value.evidence.entries()) {
      if (
        !isObject(item) ||
        Object.keys(item).some((key) => !["source", "locator", "observation"].includes(key))
      ) {
        failures.push(`Applicability evidence[${index}] has an invalid shape`);
      } else if (
        !["brief", "plan", "repository", "ddd"].includes(item.source) ||
        !nonEmptyString(item.locator) ||
        !nonEmptyString(item.observation)
      ) {
        failures.push(
          `Applicability evidence[${index}] has an invalid source, locator, or observation`,
        );
      }
    }
  if (!Array.isArray(value.obligations))
    failures.push("Applicability obligations must be an array");
  else {
    const seen = new Set();
    for (const [index, item] of value.obligations.entries()) {
      if (!isObject(item) || Object.keys(item).some((key) => !["id", "status"].includes(key))) {
        failures.push(`Applicability obligation[${index}] has an invalid shape`);
        continue;
      }
      if (!OBLIGATION_IDS.includes(item.id))
        failures.push(`Applicability obligation ID "${item.id}" is unknown`);
      if (seen.has(item.id))
        failures.push(`Applicability obligation ID "${item.id}" is duplicated`);
      seen.add(item.id);
      if (!OBLIGATION_STATUSES.includes(item.status))
        failures.push(`Applicability obligation status "${item.status}" is invalid`);
    }
  }
  if (
    !isObject(value.taskApplicability) ||
    Object.keys(value.taskApplicability).some((key) => !["warranted", "lightweight"].includes(key))
  ) {
    failures.push(
      "Applicability taskApplicability must contain only warranted and lightweight arrays",
    );
  } else if (
    !Array.isArray(value.taskApplicability.warranted) ||
    !Array.isArray(value.taskApplicability.lightweight) ||
    [...value.taskApplicability.warranted, ...value.taskApplicability.lightweight].some(
      (task) => !nonEmptyString(task),
    )
  ) {
    failures.push("Applicability taskApplicability values must be arrays of non-empty task IDs");
  } else {
    const warranted = value.taskApplicability.warranted;
    const lightweight = value.taskApplicability.lightweight;
    const seen = new Set();
    for (const task of [...warranted, ...lightweight]) {
      if (seen.has(task))
        failures.push(`Applicability task ID "${task}" is duplicated or overlaps scopes`);
      seen.add(task);
    }
  }
  if (!Array.isArray(value.dddArtifacts))
    failures.push("Applicability dddArtifacts must be an array");
  else
    value.dddArtifacts.forEach((ref, index) =>
      failures.push(...validateDddArtifact(ref, root, index)),
    );
  if (
    !Array.isArray(value.unresolvedRisks) ||
    value.unresolvedRisks.some((risk) => !nonEmptyString(risk))
  )
    failures.push("Applicability unresolvedRisks must be an array of non-empty strings");
  if (
    !isObject(value.bypass) ||
    Object.keys(value.bypass).some((key) => !["requested", "rationale"].includes(key)) ||
    typeof value.bypass.requested !== "boolean" ||
    (value.bypass.rationale !== null && !nonEmptyString(value.bypass.rationale))
  ) {
    failures.push("Applicability bypass has an invalid shape");
  }
  if (
    value.reclassificationHistory !== undefined &&
    (!Array.isArray(value.reclassificationHistory) ||
      value.reclassificationHistory.some(
        (entry) =>
          !isObject(entry) ||
          Object.keys(entry).some((key) => !["from", "to", "reason"].includes(key)) ||
          !APPLICABILITY_DECISIONS.includes(entry.from) ||
          !APPLICABILITY_DECISIONS.includes(entry.to) ||
          !nonEmptyString(entry.reason),
      ))
  ) {
    failures.push("Applicability reclassificationHistory has an invalid shape");
  }

  if (Array.isArray(value.matchedSignals) && isObject(value.bypass) && value.bypass.requested) {
    if (value.matchedSignals.length > 0)
      failures.push("lightweight bypass is not allowed with a matched high-consequence signal");
    if (!nonEmptyString(value.bypass.rationale))
      failures.push("lightweight bypass requires a rationale");
    if (value.mode !== "lightweight-bypass" || value.decision !== "lightweight")
      failures.push("lightweight bypass must use lightweight-bypass/lightweight");
  }
  if (isObject(value.bypass) && !value.bypass.requested && value.bypass.rationale !== null)
    failures.push("a non-requested bypass must have a null rationale");
  if (value.mode === "explicit-opt-in" && value.decision !== "warranted")
    failures.push("explicit-opt-in mode must produce a warranted decision");
  if (value.mode === "lightweight-bypass" && value.decision !== "lightweight")
    failures.push("lightweight-bypass mode must produce a lightweight decision");
  if (
    value.mode === "lightweight-bypass" &&
    (!value.bypass?.requested || !nonEmptyString(value.bypass?.rationale))
  )
    failures.push("lightweight-bypass mode requires a requested bypass and rationale");
  if (value.decision === "mixed" && value.mode !== "risk-first")
    failures.push("mixed applicability must use risk-first mode");
  const hasSignals = Array.isArray(value.matchedSignals) && value.matchedSignals.length > 0;
  const hasWarrantedTasks =
    isObject(value.taskApplicability) &&
    Array.isArray(value.taskApplicability.warranted) &&
    value.taskApplicability.warranted.length > 0;
  const hasLightweightTasks =
    isObject(value.taskApplicability) &&
    Array.isArray(value.taskApplicability.lightweight) &&
    value.taskApplicability.lightweight.length > 0;
  const hasMixedTasks = hasWarrantedTasks && hasLightweightTasks;
  if (hasMixedTasks && value.decision !== "mixed")
    failures.push("mixed task applicability must use a mixed decision");
  if (hasSignals && value.decision === "lightweight")
    failures.push("matched signals cannot produce a lightweight decision");
  if (hasWarrantedTasks && value.decision === "lightweight")
    failures.push("warranted tasks cannot produce a lightweight decision");
  if (
    value.decision === "warranted" &&
    !hasSignals &&
    !hasWarrantedTasks &&
    value.mode !== "explicit-opt-in"
  )
    failures.push("warranted applicability requires a signal, warranted task, or explicit opt-in");
  if (value.mode === "explicit-opt-in" && hasSignals)
    failures.push("explicit-opt-in cannot include matched signals");
  if (value.mode === "explicit-opt-in" && hasMixedTasks)
    failures.push("explicit-opt-in cannot contain mixed task applicability");
  if (value.mode === "lightweight-bypass" && (hasWarrantedTasks || hasSignals))
    failures.push("lightweight-bypass cannot contain warranted scope");
  if (
    !hasMixedTasks &&
    hasWarrantedTasks &&
    hasLightweightTasks === false &&
    value.decision !== "warranted"
  )
    failures.push("warranted task scope requires a warranted decision");
  if (
    !hasMixedTasks &&
    hasLightweightTasks &&
    !hasWarrantedTasks &&
    (hasSignals || value.mode === "explicit-opt-in") &&
    value.decision !== "mixed"
  )
    failures.push("lightweight task scope contradicts warranted signals or opt-in");
  if (
    Array.isArray(value.obligations) &&
    Array.isArray(value.matchedSignals) &&
    ["warranted", "mixed"].includes(value.decision)
  ) {
    const present = new Map(value.obligations.map((item) => [item.id, item.status]));
    if (value.obligations.length === 0)
      failures.push(`Applicability is ${value.decision} but has no obligations`);
    for (const id of requiredObligationIds(value.matchedSignals)) {
      if (!present.has(id) || present.get(id) === "missing")
        failures.push(
          `Applicability is ${value.decision} but required obligation "${id}" is missing`,
        );
    }
  }
  if (["warranted", "mixed"].includes(value.decision)) {
    const warranted = value.taskApplicability?.warranted;
    const lightweight = value.taskApplicability?.lightweight;
    if (!Array.isArray(warranted) || warranted.length === 0)
      failures.push(`Applicability is ${value.decision} but has no warranted task slices`);
    if (value.decision === "mixed" && (!Array.isArray(lightweight) || lightweight.length === 0))
      failures.push("Applicability mixed scope has no lightweight task slices");
  }
  if (
    value.decision === "mixed" &&
    isObject(value.taskApplicability) &&
    (!value.taskApplicability.warranted?.length || !value.taskApplicability.lightweight?.length)
  )
    failures.push("mixed applicability requires both warranted and lightweight tasks");
  if (isObject(value.taskApplicability)) {
    const taskIds = new Set();
    const lines = splitLines(content);
    const inFence = fenceMap(lines);
    const range = sectionRange(lines, inFence, "Numbered Plan");
    if (range) {
      for (let i = range[0] + 1; i < range[1]; i += 1) {
        if (!inFence[i]) {
          const match = lines[i].match(/^\s*-\s*Task ID:\s*(T\d{3})\s*$/);
          if (match) taskIds.add(match[1]);
        }
      }
    }
    for (const task of [
      ...(value.taskApplicability.warranted ?? []),
      ...(value.taskApplicability.lightweight ?? []),
    ]) {
      if (!/^T\d{3}$/.test(task) || (taskIds.size > 0 && !taskIds.has(task)))
        failures.push(`Applicability task ID "${task}" does not resolve to a numbered task`);
    }
  }
  return failures;
}

/** Deterministically classify supplied signal/task evidence without scoring. */
export function classifyApplicability({
  matchedSignals = [],
  explicitOptIn = false,
  bypassRequested = false,
  bypassRationale = "",
  taskApplicability = null,
} = {}) {
  const signals = [
    ...new Set(matchedSignals.filter((signal) => APPLICABILITY_SIGNALS.includes(signal))),
  ];
  if (
    taskApplicability &&
    taskApplicability.warranted?.length &&
    taskApplicability.lightweight?.length
  )
    return { decision: "mixed", mode: "risk-first", matchedSignals: signals };
  if (taskApplicability?.warranted?.length)
    return {
      decision: "warranted",
      mode: explicitOptIn && signals.length === 0 ? "explicit-opt-in" : "risk-first",
      matchedSignals: signals,
    };
  if (taskApplicability?.lightweight?.length && signals.length === 0 && !explicitOptIn)
    return { decision: "lightweight", mode: "risk-first", matchedSignals: signals };
  if (signals.length > 0 || explicitOptIn)
    return {
      decision: "warranted",
      mode: explicitOptIn && signals.length === 0 ? "explicit-opt-in" : "risk-first",
      matchedSignals: signals,
    };
  if (bypassRequested && nonEmptyString(bypassRationale))
    return { decision: "lightweight", mode: "lightweight-bypass", matchedSignals: signals };
  return { decision: "lightweight", mode: "risk-first", matchedSignals: signals };
}

/** New plans must give every numbered task a stable identity and executable acceptance signal. */
export function validatePlanTaskCompleteness(content) {
  if (!parsePlanApplicability(content).present) return [];
  const lines = splitLines(content);
  const inFence = fenceMap(lines);
  const range = sectionRange(lines, inFence, "Numbered Plan");
  if (!range) return ['new plan lacks "## Numbered Plan" section'];
  const starts = [];
  for (let i = range[0] + 1; i < range[1]; i += 1)
    if (!inFence[i] && /^\d+\.\s+/.test(lines[i])) starts.push(i);
  if (starts.length === 0) return ["new plan has no numbered tasks"];
  const failures = [];
  const ids = new Set();
  for (const [index, start] of starts.entries()) {
    const end = starts[index + 1] ?? range[1];
    const body = lines.slice(start, end).join("\n");
    const taskIds = [...body.matchAll(/^\s*-\s*Task ID:\s*(\S+)\s*$/gm)].map((match) => match[1]);
    if (taskIds.length !== 1)
      failures.push(`numbered task ${index + 1} must contain exactly one Task ID`);
    else if (!/^T\d{3}$/.test(taskIds[0]))
      failures.push(`task ${taskIds[0]} has invalid identity (want T###)`);
    else if (ids.has(taskIds[0])) failures.push(`task ID ${taskIds[0]} is duplicated`);
    else ids.add(taskIds[0]);
    if (!/^\s*-\s*Acceptance signal:\s*\S.+$/m.test(body))
      failures.push(`numbered task ${index + 1} lacks a non-empty Acceptance signal`);
  }
  return failures;
}
