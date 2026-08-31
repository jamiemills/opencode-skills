import assert from "node:assert/strict";
import test from "node:test";
import {
  createSkillExecutorRegistry,
  skillExecutorContractDigest,
} from "../csm-orchestrate/lib/skill-executor-registry.mjs";

const digest = (letter) => `sha256:${letter.repeat(64)}`;
function descriptor(overrides = {}) {
  const base = {
    schema: "csm-orchestrate-skill-executor/1",
    version: 1,
    skill: "csm-scan",
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
  const result = { ...base, ...overrides };
  return { ...result, contractDigest: skillExecutorContractDigest(result) };
}

test("registry resolves only the complete exact executable identity", async () => {
  const entry = descriptor();
  const registry = await createSkillExecutorRegistry({ descriptors: [entry] });
  assert.deepEqual(registry.resolveExact(entry), entry);
  assert.throws(
    () => registry.resolveExact({ ...entry, handlerDigest: digest("a") }),
    /exact skill executor is not registered/,
  );
  assert.throws(
    () => registry.resolveExact({ ...entry, contractDigest: digest("a") }),
    /exact skill executor is not registered/,
  );
});

test("registry rejects duplicate, malformed, and stale descriptors", async () => {
  const entry = descriptor();
  await assert.rejects(
    createSkillExecutorRegistry({ descriptors: [entry, entry] }),
    /duplicate skill executor/,
  );
  await assert.rejects(
    createSkillExecutorRegistry({ descriptors: [{ ...entry, handler: undefined }] }),
    /skill executor handler is required/,
  );
  await assert.rejects(
    createSkillExecutorRegistry({ descriptors: [{ ...entry, contractDigest: digest("a") }] }),
    /contract digest mismatch/,
  );
});
