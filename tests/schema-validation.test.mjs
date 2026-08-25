import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";

const validator = await loadSchemaRegistry();
const digest = `sha256:${"a".repeat(64)}`;
const timestamp = "2026-08-25T12:00:00Z";

const validEnvelope = {
  schema: "csm-envelope/1",
  schemaRevision: 1,
  artifact: {
    artifactId: "art-output-1",
    kind: "report",
    owner: "csm-plan",
    runId: "run-main-1",
    digest,
    createdAt: timestamp,
    revision: 1,
  },
  run: {
    runId: "run-main-1",
    parentRunId: "run-delegated-1",
    delegatedFromRunId: "run-delegated-1",
    delegationId: "del-child-1",
    startedAt: timestamp,
  },
  delegation: {
    delegationId: "del-child-1",
    fromRunId: "run-delegated-1",
    toRunId: "run-main-1",
  },
  lifecycleStatus: "completed",
  verificationStatus: "verified",
  payloadSchema: { id: "csm-artifact/1", revision: 1 },
  payload: {
    schema: "csm-artifact/1",
    artifact: {
      artifactId: "art-output-1",
      kind: "report",
      owner: "csm-plan",
      runId: "run-main-1",
      digest,
      createdAt: timestamp,
      revision: 1,
    },
    contentType: "application/json",
    location: "artifact.json",
    lifecycleStatus: "completed",
  },
  inputArtifacts: [
    {
      artifactId: "art-input-1",
      schema: { id: "csm-artifact/1", revision: 1 },
      digest,
      relation: "input",
    },
  ],
  provenance: { producer: "csm-plan", producedAt: timestamp, sourceDigests: [digest] },
  evidence: [
    {
      evidenceId: "ev-test-1",
      kind: "test",
      digest,
      retention: "embedded",
      summary: "focused contract test",
    },
  ],
  diagnostics: [
    {
      code: "INFO_REPLAY",
      severity: "info",
      message: "replayed",
      boundary: "payload",
      path: "/payload",
    },
  ],
  crossReferences: [
    {
      referenceId: "ref-parent-1",
      relation: "parent",
      target: {
        artifactId: "art-input-1",
        schema: { id: "csm-artifact/1", revision: 1 },
        digest,
        relation: "supports",
      },
    },
  ],
};

test("representative envelope validates with separate lifecycle and verification status", () => {
  const result = validator.validate("csm-envelope/1", validEnvelope);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("envelope dispatches registered payloads and enforces run identity", () => {
  const valid = structuredClone(validEnvelope);
  valid.payloadSchema = { id: "csm-artifact/1", revision: 1 };
  valid.payload = {
    schema: "csm-artifact/1",
    artifact: valid.artifact,
    contentType: "application/json",
    location: "artifact.json",
    lifecycleStatus: "completed",
  };
  assert.equal(validator.validateEnvelope(valid).valid, true);
  const artifactMismatch = structuredClone(validEnvelope);
  artifactMismatch.payload.artifact.artifactId = "art-other-1";
  artifactMismatch.payload.artifact.runId = "run-other-1";
  artifactMismatch.payload.artifact.digest = `sha256:${"b".repeat(64)}`;
  const artifactMismatchResult = validator.validateEnvelope(artifactMismatch);
  assert.equal(artifactMismatchResult.valid, false);
  assert.deepEqual(
    artifactMismatchResult.errors
      .filter((error) => error.keyword === "identity")
      .map((error) => error.instancePath),
    ["/payload/artifact/artifactId", "/payload/artifact/runId", "/payload/artifact/digest"],
  );
  const parentMismatch = structuredClone(validEnvelope);
  parentMismatch.run.parentRunId = "run-parent-1";
  const parentMismatchResult = validator.validateEnvelope(parentMismatch);
  assert.equal(parentMismatchResult.valid, false);
  assert.ok(
    parentMismatchResult.errors.some(
      (error) => error.keyword === "delegation" && error.instancePath === "/run/parentRunId",
    ),
  );
  valid.payload.location = "";
  assert.equal(validator.validateEnvelope(valid).valid, false);
  const mismatch = structuredClone(validEnvelope);
  mismatch.artifact.runId = "run-other-1";
  assert.equal(validator.validateEnvelope(mismatch).valid, false);
  mismatch.delegation = {
    delegationId: "del-01",
    fromRunId: "run-parent-1",
    toRunId: "run-main-1",
  };
  assert.equal(validator.validateEnvelope(mismatch).valid, false);
  mismatch.run.delegatedFromRunId = "run-parent-1";
  mismatch.run.delegationId = "del-01";
  assert.equal(validator.validateEnvelope(mismatch).valid, false);
});

test("registered artifact payloads match all envelope artifact identity fields", () => {
  for (const field of ["kind", "owner", "createdAt"]) {
    const invalid = structuredClone(validEnvelope);
    invalid.payload.artifact[field] =
      field === "createdAt" ? "2026-08-25T12:01:00Z" : `other-${field}`;
    const result = validator.validateEnvelope(invalid);
    assert.equal(result.valid, false, field);
    assert.ok(
      result.errors.some(
        (error) =>
          error.keyword === "identity" && error.instancePath === `/payload/artifact/${field}`,
      ),
    );
  }

  const withRevision = structuredClone(validEnvelope);
  withRevision.artifact.revision = 2;
  withRevision.payload.artifact.revision = 1;
  const revisionResult = validator.validateEnvelope(withRevision);
  assert.equal(revisionResult.valid, false);
  assert.ok(
    revisionResult.errors.some(
      (error) =>
        error.keyword === "identity" && error.instancePath === "/payload/artifact/revision",
    ),
  );
});

test("artifact payload cannot provide revision when envelope identity omits it", () => {
  const payloadOnlyRevision = structuredClone(validEnvelope);
  delete payloadOnlyRevision.artifact.revision;
  const result = validator.validateEnvelope(payloadOnlyRevision);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (error) => error.keyword === "required" && error.instancePath === "/artifact",
    ),
  );
});

test("envelope rejects orphan and incomplete delegation with structured errors", () => {
  const orphanRunFields = structuredClone(validEnvelope);
  delete orphanRunFields.delegation;
  const orphanRunFieldsResult = validator.validateEnvelope(orphanRunFields);
  assert.equal(orphanRunFieldsResult.valid, false);
  assert.ok(
    orphanRunFieldsResult.errors.some(
      (error) => error.keyword === "delegation" && error.instancePath === "/delegation",
    ),
  );

  const orphanObject = structuredClone(validEnvelope);
  delete orphanObject.run.delegatedFromRunId;
  delete orphanObject.run.delegationId;
  const orphanObjectResult = validator.validateEnvelope(orphanObject);
  assert.equal(orphanObjectResult.valid, false);
  assert.ok(
    orphanObjectResult.errors.some(
      (error) => error.keyword === "delegation" && error.instancePath === "/delegation",
    ),
  );

  const orphanParent = structuredClone(validEnvelope);
  delete orphanParent.delegation;
  delete orphanParent.run.delegatedFromRunId;
  delete orphanParent.run.delegationId;
  const orphanParentResult = validator.validateEnvelope(orphanParent);
  assert.equal(orphanParentResult.valid, false);
  assert.ok(
    orphanParentResult.errors.some(
      (error) => error.keyword === "delegation" && error.instancePath === "/delegation",
    ),
  );

  const orphanDelegation = structuredClone(validEnvelope);
  delete orphanDelegation.run.parentRunId;
  const orphanDelegationResult = validator.validateEnvelope(orphanDelegation);
  assert.equal(orphanDelegationResult.valid, false);
  assert.ok(
    orphanDelegationResult.errors.some(
      (error) => error.keyword === "delegation" && error.instancePath === "/run/parentRunId",
    ),
  );
});

test("envelope rejects unknown payload schema IDs and revisions with structured errors", () => {
  const unknownId = structuredClone(validEnvelope);
  unknownId.payloadSchema = { id: "csm-unknown/1", revision: 1 };
  const unknownIdResult = validator.validateEnvelope(unknownId);
  assert.equal(unknownIdResult.valid, false);
  assert.ok(unknownIdResult.errors.some((error) => error.keyword === "schemaReference"));

  const unknownRevision = structuredClone(validEnvelope);
  unknownRevision.payloadSchema = { id: "csm-artifact/1", revision: 2 };
  const unknownRevisionResult = validator.validateEnvelope(unknownRevision);
  assert.equal(unknownRevisionResult.valid, false);
  assert.ok(unknownRevisionResult.errors.some((error) => error.keyword === "schemaReference"));
});

test("envelope rejects fields owned by neither envelope nor payload boundary", () => {
  const invalid = structuredClone(validEnvelope);
  invalid.unknownEnvelopeField = true;
  const result = validator.validate("csm-envelope/1", invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === "additionalProperties"));
});

test("malformed identity, status, and revision produce structured diagnostics", () => {
  const invalid = structuredClone(validEnvelope);
  invalid.artifact.artifactId = "mutable-alias";
  invalid.lifecycleStatus = "VERIFIED";
  invalid.verificationStatus = "completed";
  invalid.schemaRevision = 2;
  const result = validator.validate("csm-envelope/1", invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 4);
  assert.ok(
    result.errors.every(
      (error) => typeof error.keyword === "string" && typeof error.instancePath === "string",
    ),
  );
});

test("journal, diagnostics, artifact, and projection contracts reject malformed records", () => {
  const cases = [
    [
      "csm-journal-event/1",
      {
        schema: "csm-journal-event/1",
        eventId: "evt-1",
        runId: "run-1",
        sequence: 0,
        eventType: "run.started",
        occurredAt: timestamp,
        lifecycleStatus: "active",
        extra: true,
      },
    ],
    [
      "csm-diagnostics/1",
      {
        schema: "csm-diagnostics/1",
        valid: false,
        boundary: "payload",
        diagnostics: [{ code: "bad code", severity: "error", message: "x", boundary: "payload" }],
      },
    ],
    [
      "csm-artifact/1",
      {
        schema: "csm-artifact/1",
        artifact: {
          artifactId: "art-1",
          kind: "report",
          owner: "owner",
          runId: "run-1",
          digest,
          createdAt: timestamp,
          revision: 1,
        },
        contentType: "text/plain",
        location: "x",
        lifecycleStatus: "completed",
      },
    ],
    [
      "csm-projection/1",
      {
        schema: "csm-projection/1",
        projectionId: "proj-1",
        source: { artifactId: "art-1", digest, schema: { id: "csm-artifact/1", revision: 1 } },
        mediaType: "text/html",
        renderer: { id: "csm-renderer/1", revision: 1 },
        generatedAt: timestamp,
        outputDigest: digest,
        status: "trusted",
      },
    ],
  ];
  for (const [schemaId, instance] of cases) {
    const result = validator.validate(schemaId, instance);
    assert.equal(result.valid, false, schemaId);
    assert.ok(result.errors.length > 0, schemaId);
  }
});

test("valid artifact, journal, diagnostics, and projection records validate", () => {
  const records = [
    [
      "csm-artifact/1",
      {
        schema: "csm-artifact/1",
        artifact: validEnvelope.artifact,
        contentType: "application/json",
        location: "x",
        lifecycleStatus: "completed",
      },
    ],
    [
      "csm-journal-event/1",
      {
        schema: "csm-journal-event/1",
        eventId: "evt-start-1",
        runId: "run-main-1",
        sequence: 0,
        eventType: "run.started",
        occurredAt: timestamp,
        lifecycleStatus: "active",
      },
    ],
    [
      "csm-diagnostics/1",
      {
        schema: "csm-diagnostics/1",
        valid: true,
        boundary: "payload",
        diagnostics: [{ code: "OK", severity: "info", message: "ok", boundary: "payload" }],
      },
    ],
    [
      "csm-projection/1",
      {
        schema: "csm-projection/1",
        projectionId: "proj-01",
        source: {
          artifactId: "art-output-1",
          digest,
          schema: { id: "csm-artifact/1", revision: 1 },
        },
        sourceRunId: "run-main-1",
        sourceOwner: "csm-plan",
        mediaType: "text/html",
        renderer: { id: "csm-renderer/1", revision: 1 },
        profile: { id: "csm-profile/1", revision: 1 },
        rendererDigest: digest,
        profileDigest: digest,
        generatedAt: timestamp,
        outputDigest: digest,
        status: "untrusted-presentation",
        approval: {
          binding: {
            source: {
              artifactId: "art-output-1",
              digest,
              schema: { id: "csm-artifact/1", revision: 1 },
            },
            sourceRunId: "run-main-1",
            sourceOwner: "csm-plan",
            renderer: { id: "csm-renderer/1", revision: 1 },
            rendererDigest: digest,
            profile: { id: "csm-profile/1", revision: 1 },
            profileDigest: digest,
            outputDigest: digest,
          },
          status: "pending",
        },
      },
    ],
  ];
  for (const [id, record] of records) {
    const result = validator.validate(id, record);
    assert.equal(result.valid, true, `${id}: ${JSON.stringify(result.errors)}`);
  }
});

test("journal semantic validator rejects gaps, duplicate IDs, bad parents, and terminal collisions", () => {
  const events = [
    {
      eventId: "evt-start-1",
      runId: "run-main-1",
      sequence: 0,
      eventType: "run.started",
      lifecycleStatus: "active",
    },
    {
      eventId: "evt-done-1",
      runId: "run-main-1",
      sequence: 2,
      eventType: "run.completed",
      lifecycleStatus: "completed",
      parentEventId: "evt-missing-1",
    },
    {
      eventId: "evt-done-1",
      runId: "run-main-1",
      sequence: 3,
      eventType: "run.failed",
      lifecycleStatus: "failed",
    },
  ];
  const result = validator.validateJournal(events, { runId: "run-main-1" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === "contiguousSequence"));
  assert.ok(result.errors.some((error) => error.keyword === "uniqueEventId"));
  assert.ok(result.errors.some((error) => error.keyword === "parentReference"));
  assert.ok(result.errors.some((error) => error.keyword === "lifecycleTransition"));
});

test("journal semantic validator rejects self-parent events", () => {
  const result = validator.validateJournal(
    [
      {
        eventId: "evt-self-1",
        runId: "run-main-1",
        sequence: 0,
        eventType: "run.started",
        lifecycleStatus: "active",
        parentEventId: "evt-self-1",
      },
    ],
    { runId: "run-main-1" },
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === "parentReference"));
});

test("journal validation never throws for malformed entries", () => {
  for (const malformed of [null, "not-an-array", [null], [{}], [{ eventType: 42 }]]) {
    const result = validator.validateJournal(malformed, { runId: "run-main-1" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  }
});

test("envelope validation structurally validates embedded journal events", () => {
  const envelope = structuredClone(validEnvelope);
  envelope.journal = [{ schema: "csm-journal-event/1", eventType: "run.started" }];
  const result = validator.validateEnvelope(envelope);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.instancePath.startsWith("/journal/0/")));
});

test("envelope journal terminal lifecycle must match envelope lifecycle", () => {
  const envelope = structuredClone(validEnvelope);
  envelope.journal = [
    {
      schema: "csm-journal-event/1",
      eventId: "evt-start-1",
      runId: "run-main-1",
      sequence: 0,
      eventType: "run.started",
      occurredAt: timestamp,
      lifecycleStatus: "active",
    },
  ];
  const result = validator.validateEnvelope(envelope);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (error) =>
        error.keyword === "lifecycleConsistency" && error.instancePath === "/lifecycleStatus",
    ),
  );
});

test("approved projection bindings are typed and must match projection metadata", () => {
  const projection = {
    schema: "csm-projection/1",
    projectionId: "proj-approved-1",
    source: { artifactId: "art-output-1", digest, schema: { id: "csm-artifact/1", revision: 1 } },
    sourceRunId: "run-main-1",
    sourceOwner: "csm-plan",
    mediaType: "text/html",
    renderer: { id: "csm-renderer/1", revision: 1 },
    profile: { id: "csm-profile/1", revision: 1 },
    rendererDigest: digest,
    profileDigest: digest,
    generatedAt: timestamp,
    outputDigest: digest,
    status: "untrusted-presentation",
    approval: {
      status: "approved",
      approvedBy: "owner",
      approvedAt: timestamp,
      binding: {
        source: {
          artifactId: "art-output-1",
          digest,
          schema: { id: "csm-artifact/1", revision: 1 },
        },
        sourceRunId: "run-main-1",
        sourceOwner: "csm-plan",
        renderer: { id: "csm-renderer/1", revision: 1 },
        rendererDigest: digest,
        profile: { id: "csm-profile/1", revision: 1 },
        profileDigest: digest,
        outputDigest: digest,
      },
    },
  };
  assert.equal(validator.validate("csm-projection/1", projection).valid, true);
  projection.approval.binding.outputDigest = `sha256:${"b".repeat(64)}`;
  assert.equal(validator.validate("csm-projection/1", projection).valid, false);
});

test("malformed approved projections return structured errors when metadata is missing", () => {
  const projection = {
    schema: "csm-projection/1",
    projectionId: "proj-approved-2",
    source: { artifactId: "art-output-1", digest, schema: { id: "csm-artifact/1", revision: 1 } },
    sourceRunId: "run-main-1",
    sourceOwner: "csm-plan",
    mediaType: "text/html",
    renderer: { id: "csm-renderer/1", revision: 1 },
    rendererDigest: digest,
    generatedAt: timestamp,
    outputDigest: digest,
    status: "untrusted-presentation",
    approval: { status: "approved", binding: {} },
  };
  assert.doesNotThrow(() => validator.validate("csm-projection/1", projection));
  const result = validator.validate("csm-projection/1", projection);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === "required"));
});
