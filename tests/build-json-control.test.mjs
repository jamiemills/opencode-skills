import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILD_SCHEMA,
  completeBuild,
  createArtifactDescriptor,
  createBuildState,
  dispatchBuild,
  recoverBuildState,
  transitionBuildState,
  validateBuildState,
} from "../csm-build/lib/state.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";

const sourcePlan = { artifactId: "art-plan", digest: `sha256:${"a".repeat(64)}` };
const state = () =>
  createBuildState({ runId: "run-build-json", artifactId: "art-build-json", sourcePlan });

test("build control records the canonical lifecycle and keeps the journal append-only", () => {
  let value = state();
  for (const target of ["VALIDATE", "SELECT", "CHECKPOINT", "COMPLETE"]) {
    value =
      target === "COMPLETE"
        ? completeBuild(value)
        : transitionBuildState(value, target, { evidence: `reached ${target}` });
  }
  assert.equal(value.schema, BUILD_SCHEMA);
  assert.equal(value.control.currentState, "COMPLETE");
  assert.equal(value.status, "complete");
  assert.equal(value.journal.length, 5);
  assert.equal(validateBuildState(value).valid, true);
  assert.throws(() => transitionBuildState(value, "RECOVER"), { code: "terminal-immutable" });
});

test("paused build recovery resumes through RECOVER and rejects illegal transitions", () => {
  let value = transitionBuildState(transitionBuildState(state(), "VALIDATE"), "REPAIR");
  value = transitionBuildState(value, "VALIDATE");
  value = transitionBuildState(value, "SELECT");
  value = {
    ...value,
    control: { ...value.control, currentState: "PAUSED", nextTransition: "PAUSED -> RECOVER" },
    status: "paused",
  };
  value.journal.push({
    sequence: value.journal.length,
    timestamp: new Date().toISOString(),
    from: "SELECT",
    to: "PAUSED",
    evidence: "checkpoint interrupted",
  });
  value = recoverBuildState(value);
  assert.equal(value.control.currentState, "RECOVER");
  assert.equal(value.status, "in_progress");
  assert.throws(() => transitionBuildState(value, "COMPLETE"), { code: "invalid-transition" });
});

test("dispatch refuses before validated inputs and completion descriptors retain source identity", () => {
  let value = transitionBuildState(transitionBuildState(state(), "VALIDATE"), "SELECT");
  assert.equal(dispatchBuild(value, { status: "rejected" }).code, "refusal-before-dispatch");
  const artifact = createArtifactDescriptor({
    artifactId: "art-evidence",
    kind: "verification",
    runId: value.runId,
    digest: digest({ verified: true }),
    path: ".agents/build/evidence.json",
    sourceArtifactIds: [sourcePlan.artifactId],
    rollbackArtifactId: "art-checkpoint",
  });
  const { descriptorDigest, ...descriptorBody } = artifact;
  assert.equal(descriptorDigest, digest(descriptorBody));
  value = transitionBuildState(value, "CHECKPOINT", { evidence: "verified checkpoint" });
  assert.equal(
    completeBuild(value, { evidence: [artifact] }).completion.evidence[0].sourceArtifactIds[0],
    sourcePlan.artifactId,
  );
});
