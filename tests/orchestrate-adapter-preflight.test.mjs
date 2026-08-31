import assert from "node:assert/strict";
import test from "node:test";
import { preflightSkillRoutes } from "../csm-orchestrate/lib/skill-executor-preflight.mjs";
import {
  createSkillExecutorRegistry,
  skillExecutorContractDigest,
} from "../csm-orchestrate/lib/skill-executor-registry.mjs";

const d = (letter) => `sha256:${letter.repeat(64)}`;
const make = (skill, handler = "b") => {
  const value = {
    schema: "csm-orchestrate-skill-executor/1",
    version: 1,
    skill,
    handlerDigest: d(handler),
    inputSchemaDigest: d("c"),
    outputSchemaDigest: d("d"),
    receiptSchemaDigest: d("e"),
    evidenceSchemaDigest: d("f"),
    effectiveConfigDigest: d("0"),
    permissions: ["read"],
    effects: ["read-only"],
    cancellation: "cooperative",
    idempotency: "natural",
    handler: async () => ({}),
  };
  return { ...value, contractDigest: skillExecutorContractDigest(value) };
};

test("preflight resolves the entire route before any route is admitted", async () => {
  const first = make("csm-scan");
  const second = make("csm-ddd", "a");
  const registry = await createSkillExecutorRegistry({ descriptors: [first, second] });
  const result = preflightSkillRoutes(
    [
      { nodeId: "node-scan", skill: first.skill, capabilityDigest: d("1") },
      { nodeId: "node-ddd", skill: second.skill },
    ],
    registry,
    { [first.skill]: first, [second.skill]: second },
    { requireBindings: true, capabilities: [{ skill: first.skill, digest: d("2") }] },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failure.failure.code, "capability-mismatch");
});

test("stale schema identity fails closed without invoking a handler or mutation hook", async () => {
  const entry = make("csm-scan");
  const registry = await createSkillExecutorRegistry({ descriptors: [entry] });
  const events = [];
  const result = preflightSkillRoutes(
    [{ nodeId: "node-scan", skill: entry.skill }],
    registry,
    { [entry.skill]: { ...entry, outputSchemaDigest: d("a") } },
    { requireBindings: true },
  );
  events.push(result.ok);
  assert.equal(result.ok, false);
  assert.equal(result.failure.failure.code, "stale-handler");
  assert.deepEqual(events, [false]);
});

test("a pinned capability digest cannot pass without a manifest entry", async () => {
  const entry = make("csm-scan");
  const registry = await createSkillExecutorRegistry({ descriptors: [entry] });
  const result = preflightSkillRoutes(
    [{ nodeId: "node-scan", skill: entry.skill, capabilityDigest: d("a") }],
    registry,
    { [entry.skill]: entry },
    { requireBindings: true, capabilities: [] },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failure.failure.code, "capability-missing");
});
