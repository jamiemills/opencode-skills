import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  FIXED_SECTION_ORDER,
  RESEARCH_PRODUCER_DESCRIPTOR,
  createResearchArtifact,
  createResearchEnvelope,
  resumeResearchArtifact,
  validateResearchArtifact,
  writeResearchArtifact,
} from "../csm-deep-research/lib/research.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = JSON.parse(
  await readFile(join(root, "tests/fixtures/research/valid-finding.json"), "utf8"),
);

test("research producer emits typed fixed sections without Markdown authority", async () => {
  const artifact = createResearchArtifact(fixture);
  assert.equal(validateResearchArtifact(artifact).valid, true);
  assert.deepEqual(Object.keys(artifact.sections), FIXED_SECTION_ORDER);
  assert.deepEqual(artifact.projection.sectionOrder, FIXED_SECTION_ORDER);
  assert.equal(artifact.projection.legacyMarkdownStatus, "history-only");
  assert.equal(artifact.claims[0].citations[0].referenceId, "ref-schema");
  assert.equal(artifact.references[0].retrievedAt, "2026-08-25");
  assert.ok(!Object.hasOwn(artifact, "markdown"));
  const envelope = await createResearchEnvelope(artifact);
  assert.equal(envelope.payloadSchema.id, "csm-research/1");
  assert.equal(envelope.payload.artifactId, envelope.artifact.artifactId);
  assert.equal(envelope.artifact.runId, envelope.run.runId);
});

test("research contract rejects malformed claim, reference, artifact, and version data", () => {
  const cases = [
    ["claim", (value) => (value.claims[0].citations[0].referenceId = "ref-missing")],
    ["reference", (value) => delete value.references[0].retrievedAt],
    ["artifact", (value) => (value.declaredArtifacts[0].path = "/tmp/evidence.json")],
    ["version", (value) => (value.schemaRevision = 2)],
  ];
  for (const [name, mutate] of cases) {
    const value = structuredClone(fixture);
    mutate(value);
    assert.throws(
      () => createResearchArtifact(value),
      new RegExp(name === "version" ? "schema/version" : name),
    );
  }
});

test("resume accepts an interrupted run and refuses terminal or mismatched runs", () => {
  const artifact = createResearchArtifact(fixture);
  const resumed = resumeResearchArtifact(artifact);
  assert.deepEqual(resumed, artifact);
  assert.throws(
    () =>
      resumeResearchArtifact({
        ...artifact,
        journal: [
          ...artifact.journal,
          { sequence: 1, state: "SAVED", event: "done", occurredAt: "2026-08-25T00:00:00.000Z" },
        ],
      }),
    /terminal/,
  );
  assert.throws(() => resumeResearchArtifact(artifact, { expectedRunId: "run-other" }), /mismatch/);
});

test("empty journals get a legal started transition", async () => {
  const artifact = createResearchArtifact({ ...fixture, journal: [] });
  const envelope = await createResearchEnvelope(artifact);
  assert.equal(envelope.journal[0].eventType, "run.started");
  assert.equal(envelope.journal[0].lifecycleStatus, "active");
  assert.equal(envelope.lifecycleStatus, "active");
  assert.equal(envelope.verificationStatus, "unverified");
  assert.equal(envelope.journal.length, 1);
});

test("payload schema runtime rejects invalid claim, section, and reference data", async () => {
  for (const mutate of [
    (value) => (value.claims[0].statement = ""),
    (value) => (value.sections.tldr.content = ""),
    (value) => (value.references[0].url = "not-a-url"),
  ]) {
    const artifact = createResearchArtifact(fixture);
    mutate(artifact);
    await assert.rejects(() => createResearchEnvelope(artifact), /invalid research payload/);
  }
});

test("terminal envelopes cannot resume and payload identity is checked", async () => {
  const envelope = await createResearchEnvelope(
    createResearchArtifact({
      ...fixture,
      journal: [
        ...fixture.journal,
        {
          sequence: 1,
          state: "SAVED",
          event: "finding saved after verification",
          occurredAt: "2026-08-25T00:02:00.000Z",
        },
      ],
    }),
  );
  assert.throws(() => resumeResearchArtifact(envelope), /terminal/);
  assert.throws(
    () =>
      resumeResearchArtifact(
        { ...envelope, lifecycleStatus: "active" },
        { expectedRunId: "run-other" },
      ),
    /mismatch/,
  );
  assert.throws(
    () =>
      resumeResearchArtifact({
        ...envelope,
        lifecycleStatus: "active",
        payload: { ...envelope.payload, runId: "run-other" },
      }),
    /mismatch/,
  );
});

test("blocked journal terminal state remains blocked and incomplete", async () => {
  const artifact = createResearchArtifact({
    ...fixture,
    journal: [
      {
        sequence: 0,
        state: "INTAKE",
        event: "run started",
        occurredAt: "2026-08-25T00:00:00.000Z",
      },
      {
        sequence: 1,
        state: "BLOCKED",
        event: "run blocked",
        occurredAt: "2026-08-25T00:01:00.000Z",
      },
    ],
  });
  const envelope = await createResearchEnvelope(artifact);
  assert.deepEqual(
    envelope.journal.map(({ eventType, lifecycleStatus, data }) => [
      eventType,
      lifecycleStatus,
      data.state,
    ]),
    [
      ["run.started", "active", "INTAKE"],
      ["run.failed", "blocked", "BLOCKED"],
    ],
  );
  assert.equal(envelope.lifecycleStatus, "blocked");
  assert.equal(envelope.verificationStatus, "incomplete");
  assert.equal(envelope.journal.at(-1).data.state, "BLOCKED");
  assert.throws(() => resumeResearchArtifact(artifact), /terminal/);
  assert.throws(() => resumeResearchArtifact(envelope), /terminal/);
});

test("SAVED journal terminal state is the evidence for completed verification", async () => {
  const artifact = createResearchArtifact({
    ...fixture,
    journal: [
      ...fixture.journal,
      {
        sequence: 1,
        state: "SAVED",
        event: "finding saved after verification",
        occurredAt: "2026-08-25T00:02:00.000Z",
      },
    ],
  });
  const envelope = await createResearchEnvelope(artifact);
  assert.equal(envelope.lifecycleStatus, "completed");
  assert.equal(envelope.verificationStatus, "verified");
  assert.equal(envelope.journal.at(-1).eventType, "run.completed");
  assert.equal(envelope.journal.at(-1).lifecycleStatus, "completed");
});

test("producer descriptor fixes the JSON contract and legacy projection policy", async () => {
  const descriptor = JSON.parse(
    await readFile(join(root, "csm-deep-research/research-producer.json"), "utf8"),
  );
  assert.deepEqual(descriptor.fixedSections, FIXED_SECTION_ORDER);
  assert.equal(descriptor.legacyStatus, "history-only");
  assert.equal(descriptor.schema, RESEARCH_PRODUCER_DESCRIPTOR.schema);
  assert.equal(descriptor.schema, "csm-research/1");
});

test("writer persists JSON only and refuses Markdown targets", async () => {
  const artifact = createResearchArtifact(fixture);
  await assert.rejects(
    () => writeResearchArtifact(join(root, "tests/fixtures/research/should-not.md"), artifact),
    /JSON/,
  );
});
