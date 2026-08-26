import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { digest, loadSchemaRegistry } from "../../../lib/schema-runtime/index.mjs";
import { createApproachArtifact } from "../../../csm-grill/lib/approach.mjs";
import { createBddPackage } from "../../../csm-bdd-tdd/lib/package.mjs";
import { createPlanArtifact } from "../../../csm-plan/lib/plan.mjs";
import {
  createResearchArtifact,
  createResearchEnvelope,
} from "../../../csm-deep-research/lib/research.mjs";

const at = "2026-08-26T00:00:00.000Z";
const sourceRun = "run-replay-source";
const sha = (value) => digest(value);

export function normsFixture() {
  const dimensions = Array.from({ length: 17 }, (_, order) => ({
    order,
    id: `DIM-replay-${order}-v1`,
    dimension: `replay-${order}`,
    signal: "observed",
    confidence: "high",
    coverage: 100,
    findings: { taskId: "T003" },
  }));
  const value = {
    schema: "csm-norms/1",
    schemaRevision: 1,
    artifactDigest: null,
    provenance: { producer: "csm-scan", producerRevision: "csm-scan/1", generated: "2026-08-26" },
    source: { repositoryCount: 1 },
    repositories: [
      {
        source: { order: 0, name: "replay", rootIdentity: `root-${"a".repeat(24)}`, commit: null },
        dimensions,
      },
    ],
    plugins: [],
    privacy: { status: "passed", outcomes: [] },
    crossObservations: [],
    global: null,
  };
  const withoutDigest = { ...value };
  delete withoutDigest.artifactDigest;
  value.artifactDigest = sha(withoutDigest);
  return value;
}

function envelope(payload, owner, kind, runId = sourceRun) {
  return {
    schema: "csm-envelope/1",
    schemaRevision: 1,
    contentType: "application/json",
    artifact: {
      artifactId: `art-replay-${kind}`,
      kind,
      owner,
      runId,
      digest: payload.schema === "csm-norms/1" ? payload.artifactDigest : sha(payload),
      createdAt: at,
      revision: 1,
    },
    run: { runId, startedAt: at, endedAt: at },
    lifecycleStatus: "completed",
    verificationStatus: "verified",
    payloadSchema: { id: payload.schema, revision: 1 },
    payload,
    provenance: { producer: owner, producerVersion: `${owner}/1`, producedAt: at },
  };
}

export function researchFixture() {
  return createResearchArtifact({
    title: "Replay finding",
    runId: sourceRun,
    provenance: { producedAt: at },
    claims: [],
    references: [],
    journal: [
      { sequence: 0, state: "INTAKE", event: "run started", occurredAt: at },
      { sequence: 1, state: "SAVED", event: "finding verified", occurredAt: at },
    ],
  });
}

export function approachFixture() {
  return createApproachArtifact({
    ideaSlug: "replay",
    runId: sourceRun,
    ideaStatement: "Replay handoffs",
    decisions: [
      {
        decisionId: "D1",
        question: "Use JSON?",
        answer: "Yes",
        rationale: "Stable handoff",
        traceability: ["T003"],
      },
    ],
    researchSynthesis: "typed",
    phases: [
      {
        phaseId: "P1",
        title: "Replay",
        goal: "Verify handoffs",
        deliverables: ["evidence"],
        scope: ["fixtures"],
        outOfScope: [],
        constraints: [],
        acceptanceHints: ["all edges"],
        dependencies: [],
        context: ["isolated"],
      },
    ],
  });
}

export function planFixture() {
  return createPlanArtifact({ planId: "replay-plan", runId: sourceRun });
}

export function bddFixture(plan = planFixture()) {
  return createBddPackage({
    runId: sourceRun,
    sourcePlan: {
      artifactId: plan.artifactId,
      runId: plan.runId,
      schema: "csm-plan/1",
      path: "plan.json",
      digest: sha(plan),
    },
  });
}

export function testPackageFixture(plan = planFixture(), verification) {
  return {
    schema: "csm-test-package/1",
    packageId: "replay-tests",
    owner: "csm-make-tests",
    runId: sourceRun,
    sourcePlan: {
      planId: plan.planId,
      taskId: "T003",
      planPath: "plan.json",
      planDigest: sha(plan),
    },
    ledger: { path: "ledger.jsonl", digest: `sha256:${"b".repeat(64)}`, terminal: false },
    verification: {
      path: ".agents/tests/verification.json",
      digest: sha(verification),
      status: "VERIFIED",
    },
    replay: [
      {
        id: "replay",
        path: "tests/replay.test.mjs",
        digest: `sha256:${"d".repeat(64)}`,
        command: "node --test",
      },
    ],
    mutation: { status: "verified", score: 1 },
    performance: { status: "verified", baselineId: "replay" },
    terminal: false,
  };
}

export async function reviewFixture() {
  const value = JSON.parse(
    await readFile(join(import.meta.dirname, "../review-json/review-valid.json"), "utf8"),
  );
  value.artifact.runId = sourceRun;
  value.ownership.runId = sourceRun;
  const payload = structuredClone(value);
  delete payload.artifact.digest;
  value.artifact.digest = sha(payload);
  return value;
}

export function browseFixture() {
  const value = {
    schema: "csm-browse-evidence/1",
    evidenceId: "evidence-replay",
    runId: sourceRun,
    owner: "csm-browse",
    kind: "dom",
    path: "evidence.txt",
    digest: `sha256:${"a".repeat(64)}`,
    bytes: 1,
    contentType: "text/plain",
    capturedAt: at,
    metadata: {},
    binaryAcknowledged: false,
    descriptorDigest: null,
  };
  value.descriptorDigest = sha(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== "descriptorDigest")),
  );
  return value;
}

export function dddGraphFixture() {
  return {
    format: "csm-ddd-graph/1",
    runId: sourceRun,
    generatedAt: at,
    nodes: [],
    edges: [],
    claims: [],
    evidence: [],
    questions: [],
    answers: [],
  };
}

export function publicationFixture() {
  const value = {
    schema: "csm-upload-publication/1",
    artifactId: "art-replay-upload",
    runId: sourceRun,
    owner: "csm-upload",
    sourceRunId: sourceRun,
    status: "validated",
    inputs: [],
    destination: { github: "replay", pagesRepo: "replay-pages", path: "replay" },
    snapshot: { maxFiles: 1, maxBytes: 1024 },
    confirmation: { required: true, confirmed: false },
    binaryAcknowledgment: { required: false, acknowledged: false },
    deployment: { status: "not-started", url: null },
    cleanup: { status: "not-needed", path: null },
  };
  value.descriptorDigest = sha(value);
  return value;
}

export async function writeBuildFixtures(root, payloads, verification) {
  await mkdir(join(root, ".agents/tests"), { recursive: true });
  await writeFile(join(root, "plan.json"), JSON.stringify(payloads.plan));
  await writeFile(join(root, ".agents/tests/verification.json"), JSON.stringify(verification));
}

export async function replayFixtures() {
  const norms = normsFixture();
  const research = researchFixture();
  const review = await reviewFixture();
  const plan = planFixture();
  const verification = {
    schema: "csm-make-tests-verification/1",
    artifactId: "verification-replay",
    owner: "csm-make-tests",
    runId: sourceRun,
    sourcePlan: { planId: plan.planId, taskId: "T003", planDigest: sha(plan) },
    status: "VERIFIED",
    verificationStatus: { format: "csm-verification-status/1", status: "VERIFIED", unresolved: [] },
    evidence: [
      {
        status: "verified",
        references: [
          {
            id: "evidence-replay",
            path: "replay-fixture.json",
            digest: `sha256:${"e".repeat(64)}`,
          },
        ],
      },
    ],
    replay: [],
    unresolved: [],
  };
  const payloads = {
    norms,
    research,
    review,
    approach: approachFixture(),
    plan,
    bdd: bddFixture(plan),
    tests: testPackageFixture(plan, verification),
    ddd: dddGraphFixture(),
    browse: browseFixture(),
    publication: publicationFixture(),
  };
  const researchEnvelope = await createResearchEnvelope(research);
  researchEnvelope.lifecycleStatus = "completed";
  researchEnvelope.verificationStatus = "verified";
  const envelopes = {
    norms: envelope(norms, "csm-scan", "norms"),
    research: researchEnvelope,
    review: envelope(review, "csm-review", "review"),
    approach: envelope(payloads.approach, "csm-grill", "approach"),
  };
  const registry = await loadSchemaRegistry();
  return { payloads, envelopes, registry, verification };
}
