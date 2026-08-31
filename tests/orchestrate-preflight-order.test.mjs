import assert from "node:assert/strict";
import test from "node:test";
import { preflightSkillRoutes } from "../csm-orchestrate/lib/skill-executor-preflight.mjs";
import {
  createSkillExecutorRegistry,
  skillExecutorContractDigest,
} from "../csm-orchestrate/lib/skill-executor-registry.mjs";

const digest = (letter) => `sha256:${letter.repeat(64)}`;
function setup() {
  const descriptor = {
    schema: "csm-orchestrate-skill-executor/1",
    version: 1,
    skill: "csm-ddd",
    handlerDigest: digest("b"),
    inputSchemaDigest: digest("c"),
    outputSchemaDigest: digest("d"),
    receiptSchemaDigest: digest("e"),
    evidenceSchemaDigest: digest("f"),
    effectiveConfigDigest: digest("0"),
    permissions: ["read"],
    effects: ["read-only"],
    cancellation: "cooperative",
    idempotency: "natural",
    handler: async () => ({ status: "completed" }),
  };
  descriptor.contractDigest = skillExecutorContractDigest(descriptor);
  return { descriptor, node: { nodeId: "node-ddd", skill: descriptor.skill } };
}

test("missing or stale route handlers block without invoking mutation hooks", async () => {
  const { descriptor, node } = setup();
  const registry = await createSkillExecutorRegistry({ descriptors: [descriptor] });
  const events = [];
  const blocked = preflightSkillRoutes([node], registry, {
    [node.skill]: { ...descriptor, handlerDigest: digest("a") },
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.failure.status, "blocked");
  assert.equal(blocked.failure.failure.code, "stale-handler");
  assert.deepEqual(events, []);
});

test("preflight resolves every route node before returning success", async () => {
  const { descriptor, node } = setup();
  const second = { ...descriptor, skill: "csm-scan" };
  second.contractDigest = skillExecutorContractDigest(second);
  const registry = await createSkillExecutorRegistry({ descriptors: [descriptor, second] });
  const result = preflightSkillRoutes(
    [node, { nodeId: "node-scan", skill: second.skill }],
    registry,
    { [node.skill]: descriptor, [second.skill]: second },
  );
  assert.equal(result.ok, true);
  assert.equal(result.resolved.length, 2);
});

test("strict in-process preflight rejects route nodes without explicit bindings", async () => {
  const { descriptor, node } = setup();
  const registry = await createSkillExecutorRegistry({ descriptors: [descriptor] });
  const result = preflightSkillRoutes([node], registry, {}, { requireBindings: true });
  assert.equal(result.ok, false);
  assert.equal(result.failure.failure.code, "stale-handler");
});
