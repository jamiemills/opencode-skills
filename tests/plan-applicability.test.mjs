import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  classifyApplicability,
  parsePlanApplicability,
  validatePlanApplicability,
  validatePlanTaskCompleteness,
} from "../scripts/lib/plan-validation.mjs";

const base = {
  format: "csm-applicability/1",
  decision: "lightweight",
  mode: "risk-first",
  matchedSignals: [],
  evidence: [{ source: "brief", locator: "request", observation: "A small local change" }],
  obligations: [],
  taskApplicability: { warranted: [], lightweight: [] },
  dddArtifacts: [],
  unresolvedRisks: [],
  bypass: { requested: false, rationale: null },
};

function plan(value, { extraBlocks = [], heading = "### Applicability" } = {}) {
  const blocks = [value, ...extraBlocks]
    .map((item) => `\`\`\`json csm-applicability/1\n${JSON.stringify(item, null, 2)}\n\`\`\``)
    .join("\n\n");
  return `# Synthetic plan\n\n## Current-State Evidence\n\n${heading}\n\n${blocks}\n\n## Control\n`;
}

function meaningful(overrides = {}) {
  return {
    ...base,
    decision: "warranted",
    mode: "risk-first",
    matchedSignals: ["public_contract", "invariant_or_consistency"],
    obligations: [
      { id: "contract", status: "satisfied" },
      { id: "parity", status: "required" },
      { id: "observable_behavior", status: "satisfied" },
      { id: "invariant", status: "required" },
    ],
    ...overrides,
  };
}

test("applicability fixture matrix", async (t) => {
  const cases = [
    ["trivial", base, false],
    ["meaningful", meaningful(), false],
    [
      "explicit opt-in",
      {
        ...base,
        decision: "warranted",
        mode: "explicit-opt-in",
        evidence: [
          { source: "brief", locator: "request", observation: "User explicitly requests DDD" },
        ],
      },
      false,
    ],
    [
      "mixed",
      {
        ...base,
        decision: "mixed",
        taskApplicability: { warranted: ["T001"], lightweight: ["T002"] },
        matchedSignals: ["boundary_change"],
        obligations: [
          { id: "boundary", status: "required" },
          { id: "observable_behavior", status: "required" },
          { id: "seam", status: "required" },
        ],
      },
      false,
    ],
    ["malformed JSON", null, true],
    ["duplicate block", base, true, { extraBlocks: [base] }],
    ["unknown key", { ...base, noSuchKey: true }, true],
    [
      "missing obligation",
      { ...meaningful(), obligations: [{ id: "contract", status: "satisfied" }] },
      true,
    ],
  ];

  for (const [name, value, invalid, options] of cases) {
    await t.test(name, () => {
      const content =
        value === null
          ? plan(base).replace(JSON.stringify(base, null, 2), '{"format":')
          : plan(value, options);
      const failures = validatePlanApplicability(content);
      assert.equal(failures.length > 0, invalid, failures.join("; "));
    });
  }
});

test("legacy plans retain the lightweight fallback", () => {
  const content = "# Legacy\n\n## Current-State Evidence\n\n- Existing evidence only.\n";
  assert.deepEqual(parsePlanApplicability(content), { present: false, value: null, failures: [] });
  assert.deepEqual(validatePlanApplicability(content), []);
});

test("bypass is explicit and cannot hide a signal", () => {
  const bypass = {
    ...base,
    mode: "lightweight-bypass",
    bypass: { requested: true, rationale: "The apparent boundary is documentation-only" },
  };
  assert.deepEqual(validatePlanApplicability(plan(bypass)), []);
  const hidden = { ...bypass, matchedSignals: ["boundary_change"] };
  assert.ok(validatePlanApplicability(plan(hidden)).some((failure) => failure.includes("bypass")));
});

test("classification precedence is deterministic", () => {
  assert.deepEqual(classifyApplicability({}), {
    decision: "lightweight",
    mode: "risk-first",
    matchedSignals: [],
  });
  assert.equal(classifyApplicability({ explicitOptIn: true }).decision, "warranted");
  assert.equal(
    classifyApplicability({ matchedSignals: ["public_contract"] }).decision,
    "warranted",
  );
  assert.equal(
    classifyApplicability({ taskApplicability: { warranted: ["T1"], lightweight: ["T2"] } })
      .decision,
    "mixed",
  );
  assert.deepEqual(
    classifyApplicability({
      matchedSignals: ["boundary_change"],
      taskApplicability: { warranted: ["T1"], lightweight: ["T2"] },
    }),
    { decision: "mixed", mode: "risk-first", matchedSignals: ["boundary_change"] },
  );
  assert.equal(
    classifyApplicability({ bypassRequested: true, bypassRationale: "No runtime behavior changes" })
      .mode,
    "lightweight-bypass",
  );
});

test("applicability rejects contradictory scope records and overlapping task IDs", () => {
  const cases = [
    { ...base, matchedSignals: ["boundary_change"] },
    { ...base, taskApplicability: { warranted: ["T1"], lightweight: [] } },
    { ...base, decision: "warranted" },
    {
      ...base,
      decision: "warranted",
      taskApplicability: { warranted: ["T1"], lightweight: ["T2"] },
    },
    {
      ...base,
      decision: "warranted",
      mode: "explicit-opt-in",
      matchedSignals: ["public_contract"],
    },
    { ...base, taskApplicability: { warranted: ["T1", "T1"], lightweight: [] } },
    { ...base, taskApplicability: { warranted: ["T1"], lightweight: ["T1"] } },
  ];
  for (const value of cases)
    assert.ok(validatePlanApplicability(plan(value)).length > 0, JSON.stringify(value));
});

test("duplicate applicability headings are rejected while legacy absence remains valid", () => {
  const content = plan(base).replace("### Applicability", "### Applicability\n\n### Applicability");
  assert.ok(
    validatePlanApplicability(content).some((failure) =>
      failure.includes("heading must be unique"),
    ),
  );
  assert.deepEqual(validatePlanApplicability("# Legacy\n\n## Current-State Evidence\n"), []);
});

test("required obligations are derived from every matched signal", () => {
  const value = {
    ...base,
    decision: "warranted",
    matchedSignals: ["ownership_or_persistence", "migration_or_rollback"],
    obligations: [
      { id: "ownership", status: "satisfied" },
      { id: "invariant", status: "required" },
      { id: "rollback_recovery", status: "unverified" },
    ],
  };
  const failures = validatePlanApplicability(plan(value));
  assert.ok(failures.some((failure) => failure.includes('"parity"')));
  assert.equal(
    failures.some((failure) => failure.includes('required obligation "rollback_recovery"')),
    false,
    "unverified is preserved as a disclosed status rather than treated as missing",
  );
});

test("missing and invalid obligation states are distinct", () => {
  const missing = { ...meaningful(), obligations: [{ id: "contract", status: "missing" }] };
  const unverified = { ...meaningful(), obligations: [{ id: "contract", status: "unverified" }] };
  assert.ok(
    validatePlanApplicability(plan(missing)).some((failure) =>
      failure.includes('required obligation "parity"'),
    ),
  );
  assert.ok(
    !validatePlanApplicability(plan(unverified)).some((failure) =>
      failure.includes('required obligation "contract"'),
    ),
  );
});

test("reclassification history is validated and cannot silently change scope", () => {
  const value = {
    ...base,
    reclassificationHistory: [
      { from: "lightweight", to: "warranted", reason: "A public contract was discovered" },
    ],
  };
  assert.deepEqual(validatePlanApplicability(plan(value)), []);
  const malformed = {
    ...value,
    reclassificationHistory: [{ from: "lightweight", to: "warranted" }],
  };
  assert.ok(
    validatePlanApplicability(plan(malformed)).some((failure) =>
      failure.includes("reclassificationHistory"),
    ),
  );
});

test("new plans require unique task identities and acceptance signals while legacy plans remain valid", () => {
  const valid = `${plan(base)}\n## Numbered Plan\n\n1. Task\n   - Task ID: T001\n   - Acceptance signal: \`node --test\`\n`;
  assert.deepEqual(validatePlanTaskCompleteness(valid), []);
  assert.ok(
    validatePlanTaskCompleteness(valid.replace("T001", "T00x")).some((failure) =>
      failure.includes("invalid identity"),
    ),
  );
  assert.ok(
    validatePlanTaskCompleteness(valid.replace("- Acceptance signal: `node --test`", "")).some(
      (failure) => failure.includes("Acceptance signal"),
    ),
  );
  assert.deepEqual(
    validatePlanTaskCompleteness("# Legacy\n\n## Numbered Plan\n\n1. Historical task\n"),
    [],
  );
});

test("object DDD references validate files, envelopes, run pairing, and coverage disclosure", () => {
  const root = path.resolve(".");
  const reference = {
    report: "tests/fixtures/ddd-consumer/matching-report.md",
    graph: "tests/fixtures/ddd-consumer/matching-graph.json",
    runId: "run-consumer-fixed",
    reportRunId: "run-consumer-fixed",
    graphRunId: "run-consumer-fixed",
  };
  assert.deepEqual(
    validatePlanApplicability(plan({ ...base, dddArtifacts: [reference] }), root),
    [],
  );

  const missing = { ...reference, graph: "tests/fixtures/ddd-consumer/missing-graph.json" };
  assert.ok(
    validatePlanApplicability(plan({ ...base, dddArtifacts: [missing] }), root).some((failure) =>
      failure.includes("missing or malformed"),
    ),
  );

  const mismatched = { ...reference, report: "tests/fixtures/ddd-consumer/mismatched-report.md" };
  assert.ok(
    validatePlanApplicability(plan({ ...base, dddArtifacts: [mismatched] }), root).some((failure) =>
      failure.includes("report and graph run IDs"),
    ),
  );
  const wrongReferenceRun = {
    ...reference,
    runId: "run-other",
    reportRunId: "run-other",
    graphRunId: "run-other",
  };
  assert.ok(
    validatePlanApplicability(plan({ ...base, dddArtifacts: [wrongReferenceRun] }), root).some(
      (failure) => failure.includes("reference runId"),
    ),
  );
  assert.ok(
    validatePlanApplicability(
      plan({
        ...base,
        dddArtifacts: [
          {
            report: "../report.md",
            graph: reference.graph,
            runId: "run-consumer-fixed",
            reportRunId: "run-consumer-fixed",
            graphRunId: "run-consumer-fixed",
          },
        ],
      }),
      root,
    ).some((failure) => failure.includes("relative")),
  );
});
