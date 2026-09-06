"use strict";

// T002 verification: lib/intake.mjs dispatches parsed-JSON and file-path inputs
// on their schema marker into {kind, artifact, path} with light field checks
// only (never full JSON-schema validation of plan/1 envelopes, M7).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { intakeArtifact } from "../csm-orchestrate/lib/intake.mjs";

const PARALLELISM_PLAN_URL = new URL(
  "../.agents/plans/2026-09-06-parallelism-conflict-free-change-set-csm.json",
  import.meta.url,
);

const APPROACH_FIXTURE = {
  schema: "csm-approach/1",
  schemaRevision: 1,
  runId: "run-intake-approach-1",
  phases: [],
};

const REQUEST_FIXTURE = {
  schema: "csm-orchestrate-request/1",
  schemaRevision: 1,
  requestId: "request-intake-sample",
  runId: "run-20260906t230626z-4f3a9b2c1d8e",
  kind: "research",
  prompt: "Research how to generalize request intake in csm-orchestrate.",
  goalSlug: "orchestrate-request-intake-router",
  artifactRef: null,
  repo: null,
};

async function parallelismEnvelope() {
  return JSON.parse(await readFile(PARALLELISM_PLAN_URL, "utf8"));
}

test("a csm-approach/1 artifact intakes as kind approach", async () => {
  const input = structuredClone(APPROACH_FIXTURE);
  const intake = await intakeArtifact(input);
  assert.equal(intake.kind, "approach");
  assert.equal(intake.artifact, input);
  assert.equal(intake.path, null);
});

test("a real-shape csm-plan/1 envelope intakes as kind plan", async () => {
  const envelope = await parallelismEnvelope();
  assert.equal(envelope.schema, "csm-plan/1");
  const fixture = {
    schema: envelope.schema,
    schemaRevision: envelope.schemaRevision,
    planId: envelope.planId,
    runId: envelope.runId,
    status: envelope.status,
  };
  const intake = await intakeArtifact(fixture);
  assert.equal(intake.kind, "plan");
  assert.deepEqual(intake.artifact, fixture);
  assert.match(intake.artifact.planId, /^[a-z0-9][a-z0-9-]*$/);
});

test("a csm-orchestrate-request/1 artifact intakes as kind request", async () => {
  const intake = await intakeArtifact(structuredClone(REQUEST_FIXTURE));
  assert.equal(intake.kind, "request");
  assert.deepEqual(intake.artifact, REQUEST_FIXTURE);
  assert.equal(intake.path, null);
});

test("an unknown schema marker rejects with a router hint naming the entry envelope", async () => {
  await assert.rejects(intakeArtifact({ schema: "csm-unknown/1" }), (error) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /router/);
    assert.match(error.message, /csm-orchestrate-request\/1/);
    assert.match(error.message, /csm-unknown\/1/);
    return true;
  });
});

test("an absent schema marker rejects with a router hint", async () => {
  await assert.rejects(intakeArtifact({ runId: "run-intake-approach-1", phases: [] }), (error) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /router/);
    assert.match(error.message, /csm-orchestrate-request\/1/);
    return true;
  });
});

test("a file-path input is read and intakes on its schema marker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orchestrate-intake-"));
  try {
    const path = join(dir, "request.json");
    await writeFile(path, `${JSON.stringify(REQUEST_FIXTURE, null, 2)}\n`);
    const intake = await intakeArtifact(path);
    assert.equal(intake.kind, "request");
    assert.deepEqual(intake.artifact, REQUEST_FIXTURE);
    assert.equal(intake.path, path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a corpus csm-plan/1 envelope intakes with marker plus light checks only", async () => {
  const corpusEnvelope = await parallelismEnvelope();
  const full = await intakeArtifact(corpusEnvelope);
  assert.equal(full.kind, "plan");
  assert.equal(full.artifact, corpusEnvelope);
  assert.equal(full.path, null);

  const stripped = {
    schema: corpusEnvelope.schema,
    planId: corpusEnvelope.planId,
    runId: corpusEnvelope.runId,
  };
  const minimal = await intakeArtifact(stripped);
  assert.equal(minimal.kind, "plan");
  assert.deepEqual(minimal.artifact, stripped);
});

test("light checks reject non-canonical runIds and missing identity fields", async () => {
  await assert.rejects(
    intakeArtifact({ ...structuredClone(APPROACH_FIXTURE), runId: "approach-1" }),
    /intake: runId "approach-1" must match \^run-/,
  );
  await assert.rejects(
    intakeArtifact({ schema: "csm-plan/1", runId: "run-intake-plan-1" }),
    /intake: planId must be a non-empty string/,
  );
  await assert.rejects(
    intakeArtifact({
      schema: "csm-orchestrate-request/1",
      requestId: "request-intake-sample",
      runId: "run-20260906t230626z-4f3a9b2c1d8e",
      kind: "research",
    }),
    /intake: prompt must be a non-empty string/,
  );
});
