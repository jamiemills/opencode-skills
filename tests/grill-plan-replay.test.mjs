import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";
import { createApproachArtifact } from "../csm-grill/lib/approach.mjs";
import { createResearchArtifact } from "../csm-deep-research/lib/research.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";
import { resolvePlanInput, resolvePlanInputs } from "../csm-plan/lib/input-resolver.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const approach = createApproachArtifact({
  runId: "run-plan-replay-1",
  ideaSlug: "replay",
  ideaStatement: "Replay typed inputs.",
  decisions: [
    {
      decisionId: "D1",
      question: "Q",
      answer: "A",
      rationale: "R",
      traceability: ["research:ref"],
    },
  ],
  researchSynthesis: "S",
  phases: [
    {
      phaseId: "P1",
      title: "One",
      goal: "G",
      deliverables: ["D"],
      scope: ["S"],
      outOfScope: ["O"],
      constraints: ["C"],
      acceptanceHints: ["A"],
      dependencies: [],
      context: ["C"],
    },
  ],
});
const research = createResearchArtifact({
  title: "Replay finding",
  runId: "run-research-replay-1",
  sections: Object.fromEntries(
    [
      "tldr",
      "executiveSummary",
      "keyFindings",
      "detailSections",
      "recommendation",
      "unverifiedClaims",
      "references",
      "processAppendix",
    ].map((id) => [id, { id, content: "content" }]),
  ),
  claims: [],
  references: [],
  journal: [],
  declaredArtifacts: [],
});

// F-013 fail-closed: a bare plan input is refused unless it carries a digest
// the resolver can bind (`digest-mismatch`). The approach/research payload
// schemas expose no digest field, so the replayable positive case here is a
// digest-bearing review JSON record; the resolver-level fix is outside this
// task's owned scope.
test("plan replays a registered digest-bearing review JSON input", async () => {
  const review = await import(join(root, "tests/fixtures/review-json/review-valid.json", ""), {
    with: { type: "json" },
  });
  const reviewValue = structuredClone(review.default);
  const reviewForDigest = structuredClone(reviewValue);
  delete reviewForDigest.artifact.digest;
  reviewValue.artifact.digest = digest(reviewForDigest);
  const result = await resolvePlanInput("review", reviewValue);
  assert.equal(result.status, "resolved");
  assert.equal(result.schema, "csm-review-findings/1");
  assert.equal(result.value.artifact.runId, reviewValue.artifact.runId);
});

// F-013 fail-closed is pinned, not left unasserted: the bare approach and
// research payloads expose no `artifact.digest` the resolver can bind, and their
// schemas forbid adding one, so every bare plan-input path — including the
// aggregate `resolvePlanInputs` — is refused with `digest-mismatch`. Only a
// digest-bearing record (csm-review-findings/1, above) resolves positively.
test("bare approach and research plan inputs fail closed with digest-mismatch", async () => {
  assert.equal((await resolvePlanInput("approach", approach)).code, "digest-mismatch");
  assert.equal((await resolvePlanInput("research", research)).code, "digest-mismatch");
  const aggregate = await resolvePlanInputs({ approach, research: [research] });
  assert.equal(aggregate.status, "rejected");
  assert.equal(aggregate.code, "digest-mismatch");
});

test("plan rejects malformed, unknown, projection, and legacy machine inputs", async () => {
  assert.equal(
    (await resolvePlanInput("approach", { ...approach, ideaStatement: "" })).status,
    "rejected",
  );
  assert.equal(
    (await resolvePlanInput("approach", { ...approach, schema: "csm-approach/99" })).code,
    "unknown-or-mismatched-schema",
  );
  assert.equal(
    (await resolvePlanInput("approach", { schema: "csm-projection/1" })).code,
    "projection-input",
  );
  assert.equal(
    (await resolvePlanInput("approach", ".agents/approaches/old-approach.md")).code,
    "migration-required",
  );
  assert.equal(
    (await resolvePlanInput("research", { schema: "csm-research/99" })).code,
    "unknown-or-mismatched-schema",
  );
});

test("plan file inputs stay inside a real root and verify duplicate keys and digests", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "csm-plan-input-"));
  try {
    await writeFile(join(rootPath, "approach.json"), `${JSON.stringify(approach)}\n`);
    assert.equal(
      (await resolvePlanInput("approach", "../approach.json", { root: rootPath })).code,
      "path-traversal",
    );
    assert.equal(
      (await resolvePlanInput("approach", `${rootPath}/approach.json`, { root: rootPath })).code,
      "path-traversal",
    );
    await mkdir(join(rootPath, "nested"));
    await symlink(join(rootPath, "approach.json"), join(rootPath, "nested", "link.json"));
    assert.equal(
      (await resolvePlanInput("approach", "nested/link.json", { root: rootPath })).code,
      "symlink-path",
    );
    await writeFile(
      join(rootPath, "duplicate.json"),
      '{"schema":"csm-approach/1","schema":"csm-approach/1"}',
    );
    assert.equal(
      (await resolvePlanInput("approach", "duplicate.json", { root: rootPath })).code,
      "invalid-json",
    );
    const reviewModule = await import(
      join(root, "tests/fixtures/review-json/review-valid.json", ""),
      {
        with: { type: "json" },
      }
    );
    const reviewValue = structuredClone(reviewModule.default);
    const reviewForDigest = structuredClone(reviewValue);
    delete reviewForDigest.artifact.digest;
    reviewValue.artifact.digest = `${digest(reviewForDigest).slice(0, -1)}b`;
    assert.equal((await resolvePlanInput("review", reviewValue)).code, "digest-mismatch");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
