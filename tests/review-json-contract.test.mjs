import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createSchemaValidator } from "../lib/schema-runtime/index.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = (path) => readFile(join(root, path), "utf8").then(JSON.parse);
const reviewSchema = await readJson("csm-review/schemas/csm-review-findings.schema.json");
const doctrineSchema = await readJson(
  "csm-review-python/schemas/csm-doctrine-findings.schema.json",
);
const validator = createSchemaValidator({ schemas: [reviewSchema, doctrineSchema] });

test("review and doctrine fixtures validate", async () => {
  assert.match(reviewSchema.$id, /^csm-[a-z0-9-]+\/1$/);
  assert.match(doctrineSchema.$id, /^csm-[a-z0-9-]+\/1$/);
  assert.equal(reviewSchema.$id, "csm-review-findings/1");
  assert.equal(doctrineSchema.$id, "csm-doctrine-findings/1");
  assert.equal(
    validator.validate(
      "csm-review-findings/1",
      await readJson("tests/fixtures/review-json/review-valid.json"),
    ).valid,
    true,
  );
  assert.equal(
    validator.validate(
      "csm-doctrine-findings/1",
      await readJson("tests/fixtures/review-json/doctrine-valid.json"),
    ).valid,
    true,
  );
});

function payload() {
  return {
    schema: "csm-review-findings/1",
    schemaRevision: 1,
    artifact: {
      artifactId: "art-review-test-1",
      owner: "csm-review",
      runId: "run-review-1",
      digest: `sha256:${"a".repeat(64)}`,
      createdAt: "2026-08-25T12:00:00Z",
      terminal: true,
    },
    source: { commitSha: "abcdef1234567" },
    findings: [],
    verificationStatus: { format: "csm-verification-status/1", status: "VERIFIED", unresolved: [] },
    redaction: { status: "passed", rules: ["secrets"], redactedFields: 0 },
    sortOrder: { algorithm: "severity:confidence:evidenceClass:id", stable: true },
    ownership: {
      owner: "csm-review",
      runId: "run-review-1",
      collisionPolicy: "reject-owner-mismatch-or-terminal",
      terminalPolicy: "immutable",
    },
    projection: { authority: "json", formats: ["markdown"] },
  };
}

test("malformed finding, challenge, verification, and redaction records fail closed", () => {
  const cases = [
    (p) => {
      p.findings = [{ id: "bad" }];
    },
    (p) => {
      p.findings = [{ challenges: [{ verdict: "agree" }] }];
    },
    (p) => {
      p.verificationStatus.status = "UNKNOWN";
    },
    (p) => {
      p.redaction.status = "not-run";
    },
  ];
  for (const mutate of cases) {
    const candidate = payload();
    mutate(candidate);
    assert.equal(validator.validate("csm-review-findings/1", candidate).valid, false);
  }
});

test("descriptors make JSON authoritative and bundled research Markdown non-machine input", async () => {
  const review = await readJson("csm-review/producer.json");
  const doctrine = await readJson("csm-review-python/producer.json");
  const doctrineSkill = await readFile(join(root, "csm-review-python/SKILL.md"), "utf8");
  assert.equal(review.authority, "json");
  assert.equal(doctrine.researchInput, "registered-json-only");
  assert.equal(review.schema, "csm-review-findings/1");
  assert.equal(doctrine.schema, "csm-doctrine-findings/1");
  assert.equal(review.legacyStatus, "history-only");
  assert.equal(doctrine.legacyStatus, "history-only");
  assert.match(doctrineSkill, /registered JSON research\/reference artifact/);
  assert.match(doctrineSkill, /historical Markdown research file is not an input/);
});

test("sort order and terminal ownership semantics are explicit", () => {
  const records = [
    { id: "F-002", sortKey: "2:1:1:F-002" },
    { id: "F-001", sortKey: "3:2:2:F-001" },
  ];
  assert.deepEqual(
    records.toSorted((a, b) => b.sortKey.localeCompare(a.sortKey)).map(({ id }) => id),
    ["F-001", "F-002"],
  );
  const candidate = payload();
  assert.equal(candidate.artifact.terminal, true);
  assert.equal(candidate.ownership.terminalPolicy, "immutable");
  assert.equal(candidate.ownership.collisionPolicy, "reject-owner-mismatch-or-terminal");
});

test("terminal and owner-mismatch collisions are rejected", () => {
  assert.throws(
    () => assertArtifactWritable({ owner: "csm-review", terminal: true }, "csm-review"),
    /terminal/,
  );
  assert.throws(
    () => assertArtifactWritable({ owner: "csm-review", terminal: false }, "csm-review-python"),
    /owner mismatch/,
  );
});

function assertArtifactWritable(existing, owner) {
  if (existing.terminal) throw new Error("terminal artifact is immutable");
  if (existing.owner !== owner) throw new Error("owner mismatch");
}

test("semantic gates reject duplicate IDs and unsorted findings", () => {
  const candidate = payload();
  candidate.findings = [
    { id: "F-002", sortKey: "2:1:1:F-002" },
    { id: "F-001", sortKey: "3:2:2:F-001" },
  ];
  assert.throws(() => assertFindingSemantics(candidate), /sort/);
  candidate.findings[1].id = "F-002";
  assert.throws(() => assertFindingSemantics(candidate), /unique/);
});

test("evidence gates require verification, challenges, and static anchors", () => {
  const cases = [
    (finding) => {
      finding.evidenceClass = "E1";
      finding.verification = null;
    },
    (finding) => {
      finding.evidenceClass = "E2";
      finding.challenges = [];
    },
    (finding) => {
      finding.evidenceClass = "E3";
      finding.anchorRef = null;
    },
  ];
  for (const mutate of cases) {
    const candidate = payload();
    candidate.findings = [validFinding()];
    mutate(candidate.findings[0]);
    assert.equal(validator.validate("csm-review-findings/1", candidate).valid, false);
  }
});

function validFinding() {
  return {
    id: "F-001",
    title: "Typed",
    dimension: "tests",
    category: "correctness",
    anchorRef: "CWE-20",
    severity: "medium",
    confidence: "medium",
    evidenceClass: "E3",
    locations: [{ path: "src/a.py", line: 1 }],
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
    sortKey: "2:1:1:F-001",
  };
}

function assertFindingSemantics(candidate) {
  const ids = candidate.findings.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "finding IDs must be unique");
  const sorted = candidate.findings.toSorted((a, b) => b.sortKey.localeCompare(a.sortKey));
  assert.deepEqual(candidate.findings, sorted, "findings must use the declared stable sort order");
  for (const finding of candidate.findings) {
    assert.match(finding.sortKey, new RegExp(`${finding.id}$`));
  }
}

test("E1 verification and typed doctrine actions are representable", () => {
  const candidate = payload();
  candidate.findings = [
    {
      id: "F-001",
      title: "Typed",
      dimension: "tests",
      category: "correctness",
      severity: "medium",
      confidence: "verified",
      evidenceClass: "E1",
      locations: [{ path: "src/a.py", line: 1 }],
      quotedSnippets: [],
      commitSha: "abcdef1234567",
      explanation: "x",
      impact: "x",
      remediationSketch: "x",
      fixActions: [
        {
          actionId: "fix-one",
          order: 0,
          action: "Apply the correction.",
          verification: "Run the focused test.",
        },
      ],
      verification: { method: "test", command: "node --test", result: "passed", redacted: true },
      challenges: [],
      dissents: [],
      status: "upheld",
      statusNote: "x",
      sortKey: "2:3:3:F-001",
    },
  ];
  assert.equal(validator.validate("csm-review-findings/1", candidate).valid, true);
});
