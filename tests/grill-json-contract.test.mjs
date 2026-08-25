import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  APPROACH_PRODUCER_DESCRIPTOR,
  APPROACH_SCHEMA,
  createApproachArtifact,
  createApproachEnvelope,
  resumeApproachArtifact,
  validateApproachArtifact,
} from "../csm-grill/lib/approach.mjs";
import { resolveShare } from "../lib/publication/index.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const input = {
  runId: "run-grill-contract-1",
  ideaSlug: "typed-approach",
  ideaStatement: "Persist an agreed typed approach.",
  decisions: [
    {
      decisionId: "D1",
      question: "What is authoritative?",
      answer: "JSON",
      rationale: "Machine inputs need a typed source.",
      traceability: ["research:ref-schema", "review:F-001"],
    },
  ],
  researchSynthesis: "Typed JSON is validated at the boundary.",
  phases: [
    {
      phaseId: "P1",
      title: "Contract",
      goal: "Define the boundary.",
      deliverables: ["Schema"],
      scope: ["Producer"],
      outOfScope: ["Plan persistence"],
      constraints: ["JSON only"],
      acceptanceHints: ["Replay fixture"],
      dependencies: [],
      context: ["schemas/csm-envelope.schema.json"],
    },
  ],
};

test("grill emits a validated JSON approach with traceable decisions and phase briefs", () => {
  const approach = createApproachArtifact(input);
  assert.equal(approach.schema, APPROACH_SCHEMA);
  assert.equal(validateApproachArtifact(approach).valid, true);
  assert.doesNotThrow(() => validateApproachArtifact({ ...approach, decisions: {} }));
  assert.doesNotThrow(() => validateApproachArtifact({ ...approach, phases: {} }));
  assert.deepEqual(approach.decisions[0].traceability, ["research:ref-schema", "review:F-001"]);
  assert.equal(createApproachEnvelope(approach).payloadSchema.id, APPROACH_SCHEMA);
});

test("malformed, duplicate, unknown, and legacy approach records fail closed", async () => {
  const approach = createApproachArtifact(input);
  assert.equal(validateApproachArtifact({ ...approach, schema: "csm-approach/2" }).valid, false);
  assert.equal(
    validateApproachArtifact({
      ...approach,
      decisions: [approach.decisions[0], approach.decisions[0]],
    }).valid,
    false,
  );
  assert.equal(
    validateApproachArtifact({
      ...approach,
      phases: [approach.phases[0], { ...approach.phases[0], phaseId: "P1" }],
    }).valid,
    false,
  );
  assert.equal(
    validateApproachArtifact({
      ...approach,
      phases: [{ ...approach.phases[0], dependencies: ["P2"] }],
    }).valid,
    false,
  );
  assert.throws(() => resumeApproachArtifact(approach), /non-resumable|terminal/);
  const descriptor = JSON.parse(
    await readFile(join(root, "csm-grill/approach-producer.json"), "utf8"),
  );
  assert.equal(descriptor.schema, APPROACH_PRODUCER_DESCRIPTOR.schema);
  assert.equal(descriptor.authority, "json");
  assert.equal(descriptor.legacyStatus, "history-only");
  assert.equal(resolveShare({ interactionMode: "interactive" }), "markdown");
  assert.equal(resolveShare({ interactionMode: "unknown" }), "none");
});
