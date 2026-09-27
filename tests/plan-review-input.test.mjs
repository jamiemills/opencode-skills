import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { INPUTS, resolvePlanInput } from "../csm-plan/lib/input-resolver.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const reviewV1 = JSON.parse(
  readFileSync(resolve(ROOT, "tests/fixtures/review-json/review-valid.json"), "utf8"),
);

// Recompute the record's self-digest so resolvePlanInput's verifyDigests passes.
const seal = (record) => {
  const sealed = structuredClone(record);
  if (sealed.artifact && "digest" in sealed.artifact) {
    const candidate = structuredClone(sealed);
    delete candidate.artifact.digest;
    sealed.artifact.digest = digest(candidate);
  }
  return sealed;
};

const closure = {
  format: "csm-review-closure/1",
  disposition: "remediated",
  status: "closed",
  action: "applied the fix",
  evidence: "test evidence",
};

test("the plan review input accepts both csm-review-findings revisions", () => {
  assert.deepEqual(INPUTS.review.schemas, ["csm-review-findings/1", "csm-review-findings/2"]);
});

test("a sealed /1 review finding resolves", async () => {
  const result = await resolvePlanInput("review", { value: seal(reviewV1) }, { root: ROOT });
  assert.equal(result.status, "resolved", JSON.stringify(result.errors ?? result));
  assert.equal(result.schema, "csm-review-findings/1");
});

test("a sealed /2 review finding resolves (T015)", async () => {
  const v2 = {
    ...structuredClone(reviewV1),
    schema: "csm-review-findings/2",
    schemaRevision: 2,
    findings: reviewV1.findings.map((finding) => ({ ...finding, closure })),
  };
  const result = await resolvePlanInput("review", { value: seal(v2) }, { root: ROOT });
  assert.equal(result.status, "resolved", JSON.stringify(result.errors ?? result));
  assert.equal(result.schema, "csm-review-findings/2");
});

test("an unknown review revision fails closed", async () => {
  const v3 = { ...structuredClone(reviewV1), schema: "csm-review-findings/3", schemaRevision: 3 };
  const result = await resolvePlanInput("review", { value: v3 }, { root: ROOT });
  assert.equal(result.code, "unknown-or-mismatched-schema");
});
