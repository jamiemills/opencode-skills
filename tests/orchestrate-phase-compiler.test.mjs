import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSchemaValidator, parseJson } from "../lib/schema-runtime/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { compileApproach, selectRoutes } from "../csm-orchestrate/lib/phase-compiler.mjs";

const capabilityManifest = await loadCapabilities();
const capabilities = capabilityManifest.skills;
const phaseSchema = parseJson(
  await readFile(new URL("../csm-orchestrate/schemas/phase.schema.json", import.meta.url), "utf8"),
);
const validator = createSchemaValidator({ schemas: [phaseSchema] });
const approach = (phases) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  runId: "run-compiler-test",
  ideaSlug: "compiler-test",
  status: "agreed",
  ideaStatement: "compile a bounded delivery",
  decisions: [
    {
      decisionId: "D1",
      question: "scope",
      answer: "bounded",
      rationale: "safety",
      traceability: [],
    },
  ],
  researchSynthesis: "synthetic",
  phases,
  projection: { profile: "csm-grill-human/1", legacyMarkdownStatus: "history-only" },
  provenance: { producer: "csm-grill", producerVersion: "1", producedAt: "2026-08-27T00:00:00Z" },
});
const phase = (phaseId, dependencies = [], goal = "implementation") => ({
  phaseId,
  title: phaseId,
  goal,
  deliverables: ["increment"],
  scope: ["bounded scope"],
  outOfScope: ["unrelated work"],
  constraints: [],
  acceptanceHints: ["deterministic acceptance"],
  dependencies,
  context: [],
});

test("canonical approach compilation is deterministic, immutable, and schema-valid", async () => {
  const input = approach([phase("P1", [], "implementation")]);
  const first = await compileApproach(input, {
    capabilities: capabilityManifest,
    signals: { capabilities: ["csm-build"], inputs: ["plan"] },
  });
  const second = await compileApproach(input, {
    capabilities: capabilityManifest,
    signals: { capabilities: ["csm-build"], inputs: ["plan"] },
  });
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first.phases[0]), true);
  assert.equal(validator.validate("csm-orchestrate-phase/1", first.phases[0]).valid, true);
  assert.equal(first.phases[0].routeNodes[0].skill, "csm-build");
  assert.deepEqual(first.phases[0].dependencies, []);
});

test("conditional routing selects only requested relevant capabilities and groups read-only nodes", () => {
  const selected = selectRoutes(
    phase("P1", [], "repository conventions and dependency uncertainty"),
    {
      capabilities,
      signals: { capabilities: ["csm-ddd", "csm-scan", "csm-review"] },
    },
  );
  assert.deepEqual(
    selected.map((node) => node.skill),
    ["csm-ddd", "csm-review", "csm-scan"],
  );
  assert.equal(
    selected.every((node) => node.parallelGroup === "read-only"),
    true,
  );
  assert.deepEqual(
    selected.map((node) => node.dependencies),
    [[], [], []],
  );
  assert.equal(
    selected.some((node) => node.skill === "csm-build"),
    false,
  );
});

test("missing inputs, duplicate IDs, cycles, contracts, and replayed effects fail closed", async () => {
  await assert.rejects(
    compileApproach(approach([phase("P1")]), {
      capabilities: { ...capabilityManifest, skills: capabilities.slice(0, 12) },
      signals: { capabilities: ["csm-build"] },
    }),
    /complete supported capability/,
  );
  await assert.rejects(
    compileApproach(approach([phase("P1", ["P2"]), phase("P2", ["P1"])]), {
      capabilities: capabilityManifest,
      signals: { capabilities: ["csm-build"] },
    }),
    /cycle/,
  );
  await assert.rejects(
    compileApproach(approach([phase("P1"), phase("P1")]), {
      capabilities: capabilityManifest,
      signals: { capabilities: ["csm-build"] },
    }),
    /duplicate/,
  );
  await assert.rejects(
    compileApproach(approach([phase("P1", [], "publication")]), {
      capabilities: capabilityManifest,
      signals: { capabilities: ["csm-upload"], inputs: ["publication descriptor"] },
      completedEffects: new Set(["publicationDigest"]),
    }),
    /repeats completed/,
  );
  const invalid = capabilities.map((capability) =>
    capability.skill === "csm-build" ? { ...capability, inputs: null } : capability,
  );
  assert.throws(
    () =>
      selectRoutes(phase("P1"), {
        capabilities: invalid,
        signals: { capabilities: ["csm-build"] },
      }),
    /missing capability contract/,
  );
});

test("dependent routes retain serial ordering while independent routes do not bypass dependencies", async () => {
  const result = await compileApproach(approach([phase("P1", [], "research and implementation")]), {
    capabilities: capabilityManifest,
    signals: {
      capabilities: ["csm-deep-research", "csm-build"],
      inputs: ["research question", "plan"],
    },
  });
  const nodes = result.phases[0].routeNodes;
  assert.deepEqual(
    nodes.map((node) => node.skill),
    ["csm-build", "csm-deep-research"],
  );
  assert.deepEqual(nodes[1].dependencies, []);
  assert.equal(nodes[0].ordering < nodes[1].ordering, true);
});
