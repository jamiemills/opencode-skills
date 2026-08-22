"use strict";

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
  "csm-plan": [/\.agents\/plans\/<yyyy-mm-dd>-<goal-slug>-csm\.md/, /NORMS\.md/],
  "csm-build": [/\.agents\/plans\//, /NORMS\.md/],
  "csm-bdd-tdd": [/NORMS\.md/, /\*-bdd-csm\.md/],
  "csm-grill": [/\.agents\/approaches\/<yyyy-mm-dd>-<idea-slug>-approach\.md/],
  "csm-review": [/NORMS\.md/, /\.agents\/reviews\/<yyyy-mm-dd>-<repo-slug>-review\.md/],
  "csm-scan": [/NORMS\.md/],
  "csm-make-tests": [
    /\.agents\/tests\/<yyyy-mm-dd>-<repo-slug>-tests-ledger\.md/,
    /\.agents\/tests\/<yyyy-mm-dd>-<repo-slug>-verification\.md/,
  ],
  "csm-browse": [],
  "csm-deep-research": [/\.agents\/research\/<yyyy-mm-dd>-<slug>-research\.md/],
  "csm-review-python": [
    /\.agents\/doctrine\/<yyyy-mm-dd>-<repo-slug>-python-doctrine-review\.md/,
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
