import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApproachArtifact, writeApproachArtifact } from "../lib/approach.mjs";

const input = {
  runId: "run-grill-writer-1",
  ideaSlug: "typed-approach",
  ideaStatement: "Persist an agreed typed approach.",
  decisions: [
    {
      decisionId: "D1",
      question: "What is authoritative?",
      answer: "JSON",
      rationale: "Machine inputs need a typed source.",
      traceability: ["research:ref-schema"],
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

test("writeApproachArtifact creates its parent directory on a fresh tree", async () => {
  const dir = mkdtempSync(join(tmpdir(), "csm-grill-writer-"));
  const target = join(dir, "nested", "approach.json");
  assert.equal(existsSync(join(dir, "nested")), false);
  await writeApproachArtifact(target, createApproachArtifact(input));
  assert.ok(existsSync(target), "the writer must create its parent directory and write the file");
});
