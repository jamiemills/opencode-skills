import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createSchemaValidator } from "../lib/schema-runtime/index.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = join(root, "tests", "fixtures", "json-migration");

async function load(name) {
  return JSON.parse(await readFile(join(fixtureRoot, name), "utf8"));
}

const skills = [
  "csm-scan",
  "csm-grill",
  "csm-plan",
  "csm-deep-research",
  "csm-review",
  "csm-review-python",
  "csm-ddd",
  "csm-bdd-tdd",
  "csm-make-tests",
  "csm-build",
  "csm-browse",
  "csm-upload",
  "csm-autoresearch",
];

const envelopeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "csm-migration-fixture-envelope/1",
  type: "object",
  required: ["format", "artifactId"],
  properties: {
    format: { const: "csm-envelope/1" },
    artifactId: { type: "string", minLength: 1 },
    schemaRevision: { type: "string", minLength: 1 },
    errorCode: { type: "string", pattern: "^E_[A-Z_]+$" },
    instancePath: { type: "string", pattern: "^/" },
    runId: { type: "string", minLength: 1 },
    cursor: {
      type: "object",
      required: ["sequence", "state"],
      properties: { sequence: { type: "integer", minimum: 0 }, state: { const: "PAUSED" } },
      additionalProperties: false,
    },
    owner: { type: "string", minLength: 1 },
    terminal: { type: "boolean" },
    sourceDigest: { type: "string", pattern: "^sha256:[a-z]+$" },
  },
  additionalProperties: false,
};

function replayCase(item) {
  const runtime = createSchemaValidator({ schemas: [envelopeSchema] });
  const validation = runtime.validate(envelopeSchema.$id, item.payload);
  if (item.kind === "error" || item.kind === "collision") return { accepted: false, validation };
  if (!validation.valid) return { accepted: false, validation };
  if (item.consumerInput.sourceArtifactId !== item.payload.artifactId && item.kind !== "resume")
    return { accepted: false, validation: { valid: false, errors: [{ keyword: "artifactId" }] } };
  if (item.provenance.sourceDigest !== item.consumerInput.sourceDigest)
    return { accepted: false, validation: { valid: false, errors: [{ keyword: "digest" }] } };
  return { accepted: true, validation };
}

test("manifest covers the declared migration topology and immutable checkpoints", async () => {
  const manifest = await load("manifest.json");
  assert.equal(manifest.format, "csm-json-migration-characterization/1");
  assert.equal(manifest.synthetic, true);
  assert.equal(manifest.redacted, true);
  assert.deepEqual(manifest.requiredCaseKinds, [
    "valid",
    "error",
    "resume",
    "collision",
    "terminal",
  ]);
  assert.equal(new Set(manifest.declaredProducerConsumerEdges.map((edge) => edge.id)).size, 17);
  for (const edge of manifest.declaredProducerConsumerEdges) {
    assert.match(edge.id, /^csm-[a-z-]+->(?:csm-[a-z-]+)$/);
    assert.ok(skills.includes(edge.producer), `${edge.id}: unknown producer`);
    assert.ok(skills.includes(edge.consumer), `${edge.id}: unknown consumer`);
    assert.ok(edge.artifact);
  }
  assert.deepEqual(Object.keys(manifest.rollbackCheckpoints), [
    "before-write",
    "after-validation-before-cutover",
    "after-consumer-replay",
    "terminal-collision",
  ]);
  assert.ok(manifest.terminalHandoffs.includes("csm-autoresearch->human-approval"));
  assert.deepEqual(
    manifest.baselineCommands.map(({ status }) => status),
    ["passed", "passed", "passed"],
  );
});

test("synthetic fixture set supplies objective valid, error, resume, collision, and terminal baselines", async () => {
  const manifest = await load("manifest.json");
  const fixtures = await load("fixtures.json");
  assert.equal(fixtures.format, "csm-json-migration-fixtures/1");
  assert.equal(fixtures.synthetic, true);
  assert.equal(fixtures.redacted, true);
  const byKind = new Map(fixtures.cases.map((item) => [item.kind, item]));
  for (const kind of manifest.requiredCaseKinds) {
    const item = byKind.get(kind);
    assert.ok(item, `missing ${kind} fixture`);
    assert.ok(
      item.id &&
        item.observable &&
        item.rollback &&
        item.payload &&
        item.consumerInput &&
        item.ownership &&
        item.provenance &&
        item.rollbackAction,
    );
    assert.equal(item.payload.format, "csm-envelope/1");
    assert.match(item.consumerInput.sourceDigest, /^sha256:/);
    assert.match(item.provenance.sourceDigest, /^sha256:/);
    assert.equal(item.provenance.producerRevision, "producer/1");
    assert.equal(item.provenance.consumerRevision, "consumer/1");
    if (kind === "error" || kind === "collision") assert.equal(item.status, "rejected");
    if (kind === "resume") assert.equal(item.status, "paused");
    if (kind === "terminal") assert.equal(item.status, "complete");
  }
  assert.equal(fixtures.cases.length, manifest.requiredCaseKinds.length);
  assert.deepEqual(Object.keys(fixtures.contracts).toSorted(), skills.toSorted());
  assert.deepEqual(Object.keys(manifest.skillBaselines).toSorted(), skills.toSorted());
  for (const skill of skills) {
    assert.deepEqual(
      manifest.skillBaselines[skill],
      fixtures.cases.map((item) => item.id),
      `${skill}: incomplete baseline coverage`,
    );
  }
  for (const contract of Object.values(fixtures.contracts)) {
    assert.match(contract.jsonRevision, /^[a-z-]+\/1$/);
    assert.ok(contract.legacyMarkdown);
    assert.ok(contract.stateModel);
    assert.equal(contract.inputPolicy, "json-only");
  }
});

test("every producer/consumer edge has the approved fixture set and no fixture contains sensitive paths", async () => {
  const manifest = await load("manifest.json");
  const fixtures = await load("fixtures.json");
  const kinds = new Set(fixtures.cases.map((item) => item.kind));
  const serialized = JSON.stringify({ manifest, fixtures });
  assert.doesNotMatch(
    serialized,
    /\/home\/|\/Users\/|BEGIN (RSA|OPENSSH) PRIVATE KEY|ghp_[A-Za-z0-9]+/,
  );
  for (const edge of manifest.declaredProducerConsumerEdges) {
    assert.deepEqual(
      [...kinds].toSorted(),
      manifest.requiredCaseKinds.toSorted(),
      `${edge.id}: incomplete fixture coverage`,
    );
    assert.ok(edge.producer !== edge.consumer, `${edge.id}: self edge is not a migration boundary`);
  }
});

test("terminal, collision, and rollback observations preserve current behavior", async () => {
  const fixtures = await load("fixtures.json");
  const terminal = fixtures.cases.find((item) => item.kind === "terminal");
  const collision = fixtures.cases.find((item) => item.kind === "collision");
  assert.match(terminal.observable, /cannot be replaced/);
  assert.match(collision.observable, /immutable/);
  assert.ok(
    fixtures.cases.every(
      (item) =>
        item.rollback.includes("prior") ||
        item.rollback.includes("existing") ||
        item.rollback.includes("checkpoint") ||
        item.rollback.includes("failed"),
    ),
  );
});

test("synthetic replay exercises validation, provenance, ownership, and rollback behavior", async () => {
  const fixtures = await load("fixtures.json");
  const results = fixtures.cases.map(replayCase);
  assert.deepEqual(
    results.map(({ accepted }) => accepted),
    [true, false, true, false, true],
  );
  const resume = fixtures.cases.find((item) => item.kind === "resume");
  assert.equal(resume.payload.cursor.sequence, 3);
  assert.equal(resume.payload.cursor.state, "PAUSED");
  const collision = fixtures.cases.find((item) => item.kind === "collision");
  assert.equal(collision.ownership.terminal, true);
  assert.match(collision.rollbackAction, /authoritative/);
  const terminal = fixtures.cases.find((item) => item.kind === "terminal");
  assert.equal(terminal.payload.terminal, true);
  assert.match(terminal.rollbackAction, /resolver|projection/);
});
