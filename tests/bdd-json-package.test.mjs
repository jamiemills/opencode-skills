import assert from "node:assert/strict";
import test from "node:test";
import {
  createBddPackage,
  packageDigest,
  resumeBddPackage,
  validateBddPackage,
} from "../csm-bdd-tdd/lib/package.mjs";

test("BDD package preserves scenario and test-design traceability", () => {
  const value = createBddPackage();
  assert.deepEqual(validateBddPackage(value), { valid: true, errors: [] });
  assert.equal(value.traceability[0].scenarioId, value.scenarios[0].scenarioId);
  assert.deepEqual(value.traceability[0].testIds, [value.testDesigns[0].testId]);
});

test("BDD package rejects malformed links, duplicate IDs, and mismatched journal runs", () => {
  const value = createBddPackage({
    scenarios: [createBddPackage().scenarios[0], createBddPackage().scenarios[0]],
  });
  value.journal[0].runId = "run-other";
  const result = validateBddPackage(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("duplicate")));
  assert.ok(result.errors.some((error) => error.includes("contiguous")));
});

test("BDD package rejects orphan scenario links and projections are not package inputs", () => {
  const value = createBddPackage({
    traceability: [{ ...createBddPackage().traceability[0], scenarioId: "missing-001" }],
  });
  assert.ok(validateBddPackage(value).errors.some((error) => error.includes("orphan")));
  assert.equal(validateBddPackage({ schema: "csm-projection/1" }).valid, false);
});

test("paused BDD package recovers from its durable cursor", () => {
  const paused = createBddPackage({
    status: "paused",
    control: {
      ...createBddPackage().control,
      state: "PAUSED",
      nextTransition: "PAUSED -> RECOVER",
    },
  });
  paused.journal = [
    {
      ...paused.journal.at(-1),
      state: "PAUSED",
      transition: "SAVED -> PAUSED",
    },
  ];
  paused.digest = packageDigest(paused);
  const resumed = resumeBddPackage(paused, { timestamp: "2026-08-25T00:01:00Z" });
  assert.equal(resumed.control.state, "RECOVER");
  assert.equal(resumed.journal.at(-1).transition, "PAUSED -> RECOVER");
});
