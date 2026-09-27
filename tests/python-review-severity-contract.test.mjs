import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateFindingsPayload } from "../csm-review-python/lib/findings-validator.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");
const schema = JSON.parse(read("csm-review-python/schemas/csm-doctrine-findings.schema.json"));
const base = JSON.parse(read("tests/fixtures/review-json/doctrine-valid.json"));

const withSeverity = (severity) => {
  const payload = structuredClone(base);
  payload.findings = [
    {
      id: "F-001",
      title: "sample",
      dimension: "idiom",
      category: "style",
      severity,
      confidence: "low",
      evidenceClass: "E4",
      locations: [{ path: "a.py", line: 1 }],
      quotedSnippets: ["x"],
      commitSha: "abcdef1",
      explanation: "e",
      impact: "i",
      remediationSketch: "r",
      fixActions: [],
      challenges: [],
      dissents: [],
      status: "upheld",
      statusNote: "n",
      sortKey: "2:0:0:F-001",
    },
  ];
  return payload;
};

test("the csm-doctrine-findings severity enum is exactly the documented scale", () => {
  assert.deepEqual(schema.$defs.finding.properties.severity.enum, [
    "critical",
    "high",
    "medium",
    "low",
    "info",
  ]);
});

test("a record using an enum severity validates; a foreign-scale record is rejected", () => {
  assert.equal(validateFindingsPayload(withSeverity("medium")).valid, true);
  const foreign = validateFindingsPayload(withSeverity("C"));
  assert.equal(foreign.valid, false);
  assert.ok(
    foreign.errors.some((error) => String(error.instancePath ?? "").endsWith("/severity")),
    "the rejection must be the severity enum",
  );
});

test("csm-review-python documents the schema enum, not a foreign scale", () => {
  const skill = read("csm-review-python/SKILL.md");
  assert.ok(
    !skill.includes("C/R/W/E/F/Nit"),
    "the SKILL must not mandate a severity scale outside the schema enum",
  );
  assert.match(skill, /csm-doctrine-findings\/1/);
  assert.match(skill, /critical/);
});
