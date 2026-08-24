import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  FENCE_OPEN_RE,
  splitLines,
  fenceMap,
  validatePlanControl,
  validatePlanJournal,
  validateJournalControlConsistency,
  validateOrdinalSequencing,
  validatePlanApplicability,
  validatePlanTaskCompleteness,
  parsePlanControl,
  parseJournal,
  MACHINE_ENUM,
  CONTROL_STATUSES,
} from "../scripts/lib/plan-validation.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function extractRequiredPlanDocument(skillContent) {
  const lines = splitLines(skillContent);
  const inFence = fenceMap(lines);
  const headingIdx = lines.findIndex(
    (l, i) => !inFence[i] && l.trim() === "## Required Plan Document",
  );
  assert.ok(headingIdx >= 0, 'csm-plan/SKILL.md lacks "## Required Plan Document"');
  const body = [];
  let openChar = null;
  let openLen = 0;
  for (let i = headingIdx + 1; i < lines.length; i += 1) {
    const m = lines[i].match(FENCE_OPEN_RE);
    if (openChar === null && inFence[i] && m) {
      openChar = m[1][0];
      openLen = m[1].length;
      continue;
    }
    if (
      openChar !== null &&
      m &&
      m[1][0] === openChar &&
      m[1].length >= openLen &&
      m[2].trim() === ""
    )
      break;
    if (openChar !== null) body.push(lines[i]);
  }
  assert.ok(openChar !== null, 'no fenced template block under "## Required Plan Document"');
  return body;
}

function controlBlockLines(templateLines) {
  const start = templateLines.findIndex((l) => l.trim() === "## Control");
  assert.ok(start >= 0, 'template lacks "## Control" heading');
  const end = templateLines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return templateLines.slice(start + 1, end < 0 ? undefined : end);
}

test("template-contract round-trip: fenced Required Plan Document keeps the resume contract", async () => {
  const skill = await readFile(join(root, "csm-plan", "SKILL.md"), "utf8");
  const template = extractRequiredPlanDocument(skill);
  const first = template.find((l) => l.trim() !== "");
  assert.equal(first, "format: csm-plan/1");

  const control = controlBlockLines(template).join("\n");
  assert.match(control, /Status:.*paused/);
  assert.match(control, /Last model\/run:/);
  assert.match(control, /Next transition/);
  assert.match(control, /^\s*- Resume:/m);

  const templateText = template.join("\n");
  assert.ok(!/^##\s+Resume\b/m.test(templateText), 'template must not contain a "## Resume" H2');
  const skillLines = splitLines(skill);
  const inFence = fenceMap(skillLines);
  assert.ok(
    !skillLines.some((l, i) => !inFence[i] && /^##\s+Resume\b/.test(l)),
    'csm-plan/SKILL.md must not contain a "## Resume" H2 outside fences',
  );

  const actual = template.filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, "").trim());
  assert.deepEqual(actual, [
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
  ]);
});

test("PAUSED -> RECOVER golden fixture passes the imported plan-validation checks", async () => {
  const golden = await readFile(join(root, "tests", "fixtures", "resume", "golden-csm.md"), "utf8");
  assert.deepEqual(validatePlanControl(golden), []);
  assert.deepEqual(validatePlanJournal(golden), []);

  const control = parsePlanControl(golden);
  assert.ok(control !== null);
  assert.equal(control.status, "paused");
  assert.equal(control.currentState, "PAUSED");
  assert.equal(control.nextTransition, "PAUSED -> RECOVER");
  assert.ok(CONTROL_STATUSES.includes(control.status));
  assert.ok(MACHINE_ENUM.includes(control.currentState));

  const journal = parseJournal(golden);
  assert.ok(journal.header !== null);
  assert.ok(journal.rows.length >= 1);
  assert.equal(journal.rows[0].next, "PAUSED");
  assert.ok(MACHINE_ENUM.includes(journal.rows[0].next));
});

test("PAUSED -> RECOVER negatives: bad transition and bad journal Next state both fail", async () => {
  const badTransition = await readFile(
    join(root, "tests", "fixtures", "resume", "bad-transition-csm.md"),
    "utf8",
  );
  const transitionFailures = validatePlanControl(badTransition);
  assert.ok(transitionFailures.length >= 1, "FROBULATE transition must fail control validation");
  assert.match(transitionFailures.join(" "), /FROBULATE/);

  const badJournal = await readFile(
    join(root, "tests", "fixtures", "resume", "bad-journal-csm.md"),
    "utf8",
  );
  assert.deepEqual(validatePlanControl(badJournal), []);
  const journalFailures = validatePlanJournal(badJournal);
  assert.ok(
    journalFailures.length >= 1,
    "FROBULATE journal Next state must fail journal validation",
  );
  assert.match(journalFailures.join(" "), /FROBULATE/);
});

test("journal and control consistency over the plan corpus", async () => {
  const plansDir = join(root, ".agents", "plans");
  const files = (await readdir(plansDir)).filter((f) => f.endsWith("-csm.md")).toSorted();
  assert.ok(files.length >= 20, `corpus must hold at least 20 plans, found ${files.length}`);
  for (const f of files) {
    const content = await readFile(join(plansDir, f), "utf8");
    const label = `.agents/plans/${f}`;
    const journalFailures = validatePlanJournal(content);
    assert.deepEqual(journalFailures, [], `${label}: ${journalFailures.join("; ")}`);
    const controlFailures = validatePlanControl(content);
    assert.deepEqual(controlFailures, [], `${label}: ${controlFailures.join("; ")}`);
    const consistencyFailures = validateJournalControlConsistency(content);
    assert.deepEqual(consistencyFailures, [], `${label}: ${consistencyFailures.join("; ")}`);
    const ordinalFailures = validateOrdinalSequencing(content);
    assert.deepEqual(ordinalFailures, [], `${label}: ${ordinalFailures.join("; ")}`);
    const control = parsePlanControl(content);
    assert.ok(control !== null, `${label}: Control must parse`);
    assert.ok(
      control.status !== null && control.currentState !== null && control.nextTransition !== null,
      `${label}: Control fields must be present`,
    );
  }
});

test("resume validation keeps malformed applicability blocked and legacy plans compatible", async () => {
  const golden = await readFile(join(root, "tests", "fixtures", "resume", "golden-csm.md"), "utf8");
  assert.deepEqual(validatePlanApplicability(golden), []);
  const malformed = `${golden}\n\n## Current-State Evidence\n\n### Applicability\n\n\`\`\`json csm-applicability/1\nnot-json\n\`\`\`\n`;
  assert.ok(validatePlanApplicability(malformed).some((failure) => failure.includes("malformed")));
  assert.deepEqual(
    validatePlanApplicability("# Legacy\n\n## Current-State Evidence\n- prior plan\n"),
    [],
  );
  assert.deepEqual(
    validatePlanTaskCompleteness("# Legacy\n\n## Numbered Plan\n\n1. Historical task\n"),
    [],
  );
});

test('csm-build "## Pause On Quota" documents the full quota-signal set and the resume marker', async () => {
  const build = await readFile(join(root, "csm-build", "SKILL.md"), "utf8");
  const lines = splitLines(build);
  const inFence = fenceMap(lines);
  const start = lines.findIndex((l, i) => !inFence[i] && l.trim() === "## Pause On Quota");
  assert.ok(start >= 0, 'csm-build/SKILL.md lacks "## Pause On Quota"');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!inFence[i] && /^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start, end).join("\n");
  const enumLine = lines.find((l) => l.trim().startsWith("Quota signal set:"));
  assert.ok(
    enumLine !== undefined,
    'Pause On Quota must have a "Quota signal set:" enumeration line',
  );
  for (const signal of [
    "HTTP 429",
    "rate-limit",
    "quota-exceeded",
    "out-of-credits",
    "billing",
    "context-length-exceeded",
  ]) {
    assert.ok(enumLine.includes(signal), `Quota signal set must enumerate "${signal}"`);
  }
  assert.ok(
    section.includes("PAUSED -> RECOVER"),
    "Pause On Quota must contain the PAUSED -> RECOVER marker",
  );
});

test("build applicability routing preserves legacy, repair, blocked, and dispatch paths", async () => {
  const build = await readFile(join(root, "csm-build", "SKILL.md"), "utf8");
  assert.match(build, /Legacy plan with no applicability block[\s\S]*Existing flow/);
  assert.match(build, /Valid `lightweight` plan[\s\S]*Existing lightweight flow/);
  assert.match(build, /Valid `warranted` or `mixed` plan[\s\S]*VALIDATE -> SELECT -> DISPATCH/);
  assert.match(build, /missing required obligation[\s\S]*VALIDATE -> REPAIR/);
  assert.match(build, /Invalid explicitly referenced DDD graph\/report pair[\s\S]*BLOCKED/);
  assert.match(build, /No task may be dispatched before `VALIDATE` passes/);
});

test("DDD consumer fixtures preserve envelope IDs, hypothesis metadata, and bounded gaps", async () => {
  const report = await readFile(
    join(root, "tests", "fixtures", "ddd-consumer", "matching-report.md"),
    "utf8",
  );
  const graph = JSON.parse(
    await readFile(join(root, "tests", "fixtures", "ddd-consumer", "matching-graph.json"), "utf8"),
  );
  const frontmatter = report.match(/^---\n([\s\S]*?)\n---/m)?.[1] ?? "";
  assert.match(frontmatter, /^format: csm-ddd-report\/1$/m);
  assert.match(frontmatter, /^runId: run-consumer-fixed$/m);
  assert.match(frontmatter, /^graphRunId: run-consumer-fixed$/m);
  assert.equal(graph.format, "csm-ddd-graph/1");
  assert.equal(graph.runId, "run-consumer-fixed");
  assert.equal(graph.claims[0].claimKind, "context_hypothesis");
  assert.equal(graph.claims[0].status, "unverified");
  assert.equal(graph.claims[0].basis, "static_analysis");
  assert.equal(graph.claims[0].confidence, "low");
  assert.match(report, /capped|unverified/i);
  assert.match(report, /No seams identified/);
  assert.doesNotMatch(report, /rollback option|rollback criteria/i);
});

test("DDD run mismatch and checkpoint drift are not silently accepted", async () => {
  const report = await readFile(
    join(root, "tests", "fixtures", "ddd-consumer", "mismatched-report.md"),
    "utf8",
  );
  const graph = JSON.parse(
    await readFile(join(root, "tests", "fixtures", "ddd-consumer", "matching-graph.json"), "utf8"),
  );
  const graphRunId = report.match(/^graphRunId:\s*(\S+)/m)?.[1];
  assert.notEqual(graphRunId, graph.runId);

  const build = await readFile(join(root, "csm-build", "SKILL.md"), "utf8");
  assert.match(build, /Preserve the prior decision and evidence/);
  assert.match(build, /required obligation became missing or unverified/);
  assert.match(build, /do not checkpoint it as complete/);
  assert.match(build, /never a scope redesign/);
});

test("empty DDD output does not create synthetic seams or rollback evidence", async () => {
  const graph = JSON.parse(
    await readFile(join(root, "tests", "fixtures", "ddd-consumer", "empty-graph.json"), "utf8"),
  );
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
  assert.deepEqual(graph.claims, []);
  const build = await readFile(join(root, "csm-build", "SKILL.md"), "utf8");
  assert.match(build, /never prove absence/);
  assert.match(build, /justify inventing a seam, invariant, or rollback option/);
});
