import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createFindingsRenderModel, validateLineage } from "../lib/findings-render.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readFixture = async () =>
  JSON.parse(await readFile(join(root, "../tests/fixtures/review-json/review-valid.json"), "utf8"));

async function validFixture() {
  return readFixture();
}

test("maps a validated findings payload into the fixed render model", async () => {
  const payload = await validFixture();
  const result = await createFindingsRenderModel(payload);
  assert.equal(result.model.schema, "csm-render-model/1");
  assert.equal(result.sourceDescriptor.artifactId, payload.artifact.artifactId);
  assert.equal(result.sourceDescriptor.digest, payload.artifact.digest);
  const row = result.model.sections.find((section) => section.id === "findings").items[0].value[0];
  assert.equal(row.id, "F-001");
  assert.equal(row.explanation, payload.findings[0].explanation);
  assert.equal(row.challengeVerdict, "challenge-one: agree");
  assert.equal(row.challengeRationale, "[REDACTED]");
  assert.equal(row.verificationCommand, "none");
  assert.ok(!result.bytes.includes("The citation reproduces the issue."));
});

test("preserves redacted verification and dissent fields as markers only", async () => {
  const payload = await validFixture();
  payload.findings[0].verification = {
    method: "targeted test",
    command: "private command",
    result: "private result",
    redacted: true,
  };
  payload.findings[0].dissents = [
    {
      dissentId: "dissent-one",
      author: "agent-reviewer",
      rationale: "private dissent",
      redacted: true,
    },
  ];
  payload.findings[0].evidenceClass = "E1";
  payload.findings[0].confidence = "verified";
  payload.findings[0].sortKey = "3:3:3:F-001";
  const result = await createFindingsRenderModel(payload);
  const row = result.model.sections.find((section) => section.id === "findings").items[0].value[0];
  assert.equal(row.verificationCommand, "[REDACTED]");
  assert.equal(row.verificationResult, "[REDACTED]");
  assert.equal(row.dissentPresence, "1 present (dissent-one)");
  assert.equal(row.dissentRationale, "[REDACTED]");
  assert.ok(!result.bytes.includes("private command"));
  assert.ok(!result.bytes.includes("private dissent"));
});

test("does not expose fix-action verification text", async () => {
  const payload = await validFixture();
  payload.findings[0].fixActions = [
    { actionId: "fix-one", order: 0, action: "Add validation.", verification: "safe check" },
  ];
  payload.findings[0].fixActions[0].verification = "run /private/secret-check --token=value";
  const result = await createFindingsRenderModel(payload);
  const row = result.model.sections.find((section) => section.id === "findings").items[0].value[0];
  assert.equal(row.fixActions, "fix-one: Add validation. (verify: [REDACTED])");
  assert.ok(!result.sourceBytes.includes("/private/secret-check"));
});

test("rejects lineage mismatches before mapping", async () => {
  const payload = await validFixture();
  payload.ownership.runId = "run-other";
  assert.throws(() => validateLineage(payload), /ownership run/);
  payload.ownership.runId = payload.artifact.runId;
  payload.findings[0].commitSha = "0123456789abcdef";
  assert.throws(() => validateLineage(payload), /finding commit/);
});

test("accepts the producer-owned digest without guessing its scope", async () => {
  const payload = await validFixture();
  payload.artifact.digest = `sha256:${"f".repeat(64)}`;
  assert.doesNotThrow(() => validateLineage(payload));
});

test("rejects artifacts from another producer", async () => {
  const payload = await validFixture();
  payload.artifact.artifactId = "art-doctrine-review";
  assert.throws(() => validateLineage(payload), /csm-review artifact/);
});

test("rejects missing or malformed producer digests through schema validation", async () => {
  const missing = await validFixture();
  delete missing.artifact.digest;
  assert.throws(() => validateLineage(missing), /digest/);

  const malformed = await validFixture();
  malformed.artifact.digest = "producer-digest";
  assert.throws(() => validateLineage(malformed), /sha256:\[a-f0-9\]\{64\}/);
});

test("reordered finding object keys produce identical model bytes", async () => {
  const payload = await validFixture();
  const reordered = structuredClone(payload);
  reordered.findings[0] = Object.fromEntries(Object.entries(reordered.findings[0]).toReversed());
  assert.equal(
    (await createFindingsRenderModel(payload)).bytes,
    (await createFindingsRenderModel(reordered)).bytes,
  );
});

test("empty validated findings retain the explicit summary shape", async () => {
  const payload = await validFixture();
  payload.findings = [];
  payload.verificationStatus = {
    format: "csm-verification-status/1",
    status: "VERIFIED",
    unresolved: [],
  };
  const result = await createFindingsRenderModel(payload);
  assert.equal(result.model.sections[0].items[1].value, "VERIFIED");
  assert.deepEqual(result.model.sections[1].items[0].value, []);
});
