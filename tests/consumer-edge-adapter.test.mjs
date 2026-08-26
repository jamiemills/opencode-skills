import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveConsumerInput } from "../lib/consumer-adapters/index.mjs";
import { digest as canonicalDigest } from "../lib/schema-runtime/index.mjs";

const norms = {
  schema: "csm-norms/1",
  schemaRevision: 1,
  artifactDigest: null,
  provenance: { producer: "csm-scan" },
};
norms.artifactDigest = canonicalDigest(norms);
const inputs = {
  "scan->review": norms,
  "ddd->plan": {
    format: "csm-ddd-graph/1",
    runId: "run-ddd",
    nodes: [],
    edges: [],
    claims: [],
    evidence: [],
    questions: [],
    answers: [],
  },
  "research->grill": {
    schema: "csm-research/1",
    schemaRevision: 1,
    provenance: { producer: "csm-deep-research" },
  },
  "research->make-tests": {
    schema: "csm-research/1",
    schemaRevision: 1,
    provenance: { producer: "csm-deep-research" },
  },
  "review->grill": {
    schema: "csm-review-findings/1",
    schemaRevision: 1,
    artifact: { owner: "csm-review", runId: "run-review" },
  },
};

for (const edge of Object.keys(inputs)) {
  test(`${edge} rejects an untyped or incomplete projection`, async () => {
    const result = await resolveConsumerInput(edge, inputs[edge]);
    assert.equal(result.status, "rejected");
    assert.equal(result.code, edge === "ddd->plan" ? "schema-invalid" : "bare-payload");
  });
}

test("adapters reject wrong owner, unknown revision, stale digest, and projections", async () => {
  assert.equal(
    (
      await resolveConsumerInput("scan->review", {
        ...inputs["scan->review"],
        provenance: { producer: "other" },
      })
    ).code,
    "bare-payload",
  );
  assert.equal(
    (
      await resolveConsumerInput("research->grill", {
        ...inputs["research->grill"],
        schema: "csm-research/9",
      })
    ).code,
    "bare-payload",
  );
  assert.equal(
    (
      await resolveConsumerInput("scan->review", inputs["scan->review"], {
        expectedSourceDigest: `sha256:${"b".repeat(64)}`,
      })
    ).code,
    "bare-payload",
  );
  assert.equal(
    (await resolveConsumerInput("review->grill", { schema: "csm-projection/1" })).code,
    "projection-input",
  );
  assert.equal((await resolveConsumerInput("scan->review", "NORMS.md")).code, "migration-required");
});

test("adapters reject missing lineage and nonterminal artifacts", async () => {
  const base = {
    ...inputs["review->grill"],
    artifact: {
      ...inputs["review->grill"].artifact,
      terminal: false,
      digest: `sha256:${"a".repeat(64)}`,
    },
  };
  assert.equal((await resolveConsumerInput("review->grill", base)).code, "bare-payload");
  assert.equal(
    (await resolveConsumerInput("review->grill", { ...base, artifact: undefined })).code,
    "bare-payload",
  );
});
