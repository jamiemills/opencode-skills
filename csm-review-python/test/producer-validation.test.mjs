import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateFindingsPayload } from "../lib/findings-validator.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = JSON.parse(
  await readFile(join(root, "../tests/fixtures/review-json/doctrine-valid.json"), "utf8"),
);

test("doctrine producer uses runtime semantic validation", () => {
  const candidate = structuredClone(fixture);
  candidate.findings = [
    {
      id: "F-001",
      title: "Doctrine issue",
      dimension: "pep20",
      category: "correctness",
      anchorRef: "PEP 8",
      severity: "medium",
      confidence: "medium",
      evidenceClass: "E3",
      locations: [{ path: "src/app.py", line: 1 }],
      quotedSnippets: [],
      commitSha: "abcdef1234567",
      explanation: "x",
      impact: "x",
      remediationSketch: "x",
      fixActions: [],
      verification: null,
      challenges: [],
      dissents: [],
      status: "upheld",
      statusNote: "x",
      sortKey: "2:1:1:F-999",
    },
  ];
  assert.equal(validateFindingsPayload(candidate).valid, false);
});
