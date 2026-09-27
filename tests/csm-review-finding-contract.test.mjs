import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateFindingsPayload } from "../csm-review/lib/findings-validator.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const base = JSON.parse(
  readFileSync(resolve(ROOT, "tests/fixtures/review-json/review-valid.json"), "utf8"),
);

const build = (overrides) => {
  const payload = structuredClone(base);
  Object.assign(payload.findings[0], overrides);
  return payload;
};
const confidenceErrors = (payload) =>
  validateFindingsPayload(payload).errors.filter((error) =>
    String(error.message ?? error).includes("confidence exceeds the evidence class"),
  );

// E3 requires a non-empty anchorRef; sortKey = severityRank:confidenceRank:evidenceRank:id.
const e3 = (corroborated) =>
  build({
    evidenceClass: "E3",
    confidence: "high",
    corroborators: corroborated ? ["agent-other-finder"] : [],
    anchorRef: "CWE-20",
    severity: "medium",
    sortKey: "2:2:1:F-001",
  });

const e4 = (corroborated) =>
  build({
    evidenceClass: "E4",
    confidence: "medium",
    corroborators: corroborated ? ["agent-other-finder"] : [],
    anchorRef: null,
    severity: "medium",
    sortKey: "2:1:0:F-001",
  });

test("a corroborated E3+high finding is schema-valid (the ADJUDICATE bump)", () => {
  const result = validateFindingsPayload(e3(true));
  assert.equal(result.valid, true, JSON.stringify(result.errors.slice(0, 3)));
});

test("E3+high without a corroborator is rejected", () => {
  assert.equal(confidenceErrors(e3(false)).length, 1);
});

test("a corroborated E4+medium finding is schema-valid", () => {
  const result = validateFindingsPayload(e4(true));
  assert.equal(result.valid, true, JSON.stringify(result.errors.slice(0, 3)));
});

test("E4+medium without a corroborator is rejected", () => {
  assert.equal(confidenceErrors(e4(false)).length, 1);
});

test("the SKILL documents the mandatory E1 verification.redacted field", () => {
  const skill = readFileSync(resolve(ROOT, "csm-review/SKILL.md"), "utf8");
  assert.match(skill, /redacted:true/);
});
