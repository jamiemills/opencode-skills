// T009: csm-plan/SKILL.md must require, for large plans, a completion
// contract, a continuation policy, phase boundaries, and an up-front
// enumeration of user-decision blocked tasks. The requirement is a
// prose-tested checklist item; machine enforcement is deferred. This test
// guards the prose and the file's line budget.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { FENCE_OPEN_RE, fenceMap, splitLines } from "../scripts/lib/plan-validation.mjs";

const root = join(import.meta.dirname, "..");
const skillPath = join(root, "csm-plan", "SKILL.md");

// The machine-checked Required Plan Document H2 set as it stood before T009.
// scripts/check-suite.mjs treats every `## ` line inside the fenced template as
// a heading the whole plan corpus must contain in order, so the template must
// never grow a new required H2. The completion-contract elements are prose.
const ORIGINAL_REQUIRED_HEADINGS = [
  "How To Execute",
  "Control",
  "Goal",
  "Acceptance Criteria",
  "Current-State Evidence",
  "Assumptions And Decisions",
  "R&D Record",
  "Discovered Requirements",
  "Design",
  "Execution Graph",
  "Numbered Plan",
  "Verification Strategy",
  "Risks And Recovery",
  "Critique Resolution",
  "Progress Journal",
  "Completion Review",
];

async function skillText() {
  return readFile(skillPath, "utf8");
}

function region(text, start, end) {
  const from = text.indexOf(start);
  const to = end === undefined ? text.length : text.indexOf(end);
  assert.ok(from !== -1, `missing region start: ${start}`);
  assert.ok(to !== -1 && to > from, `missing region end: ${end}`);
  return text.slice(from, to);
}

const REQUIRED = [
  ["completion contract", /completion contract/i],
  ["definition of done", /definition of done/i],
  ["close-out sequence", /close-out sequence/i],
  ["continuation policy", /continuation policy/i],
  ["session unit", /session unit/i],
  ["checkpoint cadence", /checkpoint cadence/i],
  ["expected cycles", /expected cycles/i],
  ["guard command", /guard command/i],
  ["phase boundaries", /phase boundaries/i],
  ["blocked on a user decision", /blocked on a user decision/i],
];

test("csm-plan DRAFT rules require the four completion elements", async () => {
  const draft = region(await skillText(), "### 4. DRAFT", "### 5. CRITIQUE");
  for (const [label, pattern] of REQUIRED) {
    assert.match(draft, pattern, `DRAFT rules must require ${label}`);
  }
});

test("csm-plan VERIFY rules require the four completion elements", async () => {
  const verify = region(await skillText(), "### 7. VERIFY", "### 8. SAVED");
  for (const [label, pattern] of REQUIRED) {
    assert.match(verify, pattern, `VERIFY rules must check ${label}`);
  }
});

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

// Mirrors scripts/check-suite.mjs: read every `## ` heading inside the fenced
// block that follows the Required Plan Document section.
async function fencedTemplateHeadings() {
  const lines = splitLines(await skillText());
  const inFence = fenceMap(lines);
  const range = sectionRange(lines, inFence, "Required Plan Document");
  assert.ok(range, "missing Required Plan Document section");
  const body = fencedBlockAfter(lines, inFence, range[0]);
  assert.ok(body, "Required Plan Document must be followed by a fenced template");
  return body.filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, "").trim());
}

test("Required Plan Document template carries the completion elements as prose", async () => {
  const template = region(await skillText(), "## Required Plan Document", "Use stable task IDs");
  for (const [label, pattern] of REQUIRED) {
    assert.match(template, pattern, `template must include ${label}`);
  }
  for (const heading of [
    "Completion Contract",
    "Continuation Policy",
    "Phase Boundaries",
    "Blocked Decisions",
  ]) {
    assert.doesNotMatch(
      template,
      new RegExp(`^##\\s+${heading}\\s*$`, "m"),
      `${heading} must not be a new H2`,
    );
  }
});

test("fenced Required Plan Document template adds no new required H2 headings", async () => {
  const headings = await fencedTemplateHeadings();
  const unexpected = headings.filter((h) => !ORIGINAL_REQUIRED_HEADINGS.includes(h));
  assert.deepEqual(
    unexpected,
    [],
    `fenced template adds new required H2 headings: ${unexpected.join(", ")}`,
  );
  const missing = ORIGINAL_REQUIRED_HEADINGS.filter((h) => !headings.includes(h));
  assert.deepEqual(
    missing,
    [],
    `fenced template is missing original headings: ${missing.join(", ")}`,
  );
});

test("csm-plan declares the checklist requirement and deferred machine enforcement", async () => {
  const text = await skillText();
  assert.match(text, /checklist requirement/i);
  assert.match(text, /machine enforcement(?: of it)? is deferred/i);
});

test("csm-plan/SKILL.md stays under the 500-line limit", async () => {
  const text = await skillText();
  const lines = text.split(/\r?\n/).length;
  assert.ok(lines < 500, `csm-plan/SKILL.md is ${lines} lines (must be < 500)`);
});
