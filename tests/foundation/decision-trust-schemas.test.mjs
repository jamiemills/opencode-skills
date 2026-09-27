import { test } from "node:test";
import assert from "node:assert/strict";

import { loadSchemaRegistry } from "../../lib/schema-runtime/index.mjs";
import { guardProtectedInput } from "../../csm-orchestrate/lib/decision-adapter/boundary-guard.mjs";
import {
  TRUST_LEVELS,
  assertTrustPromotion,
  labelOf,
} from "../../csm-orchestrate/lib/decision-adapter/trust.mjs";

const TRUST_SCHEMAS = [
  ["csm-decision", 2],
  ["csm-decision-trust", 1],
  ["csm-decision-corpus", 1],
  ["csm-decision-calibration", 2],
];

test("the trust-ladder schemas are registered", async () => {
  const registry = await loadSchemaRegistry();
  for (const [base, revision] of TRUST_SCHEMAS) {
    assert.ok(registry.resolve(base, revision), `${base}/${revision} must be registered`);
  }
});

test("an unknown revision is rejected", async () => {
  const registry = await loadSchemaRegistry();
  assert.throws(() => registry.resolve("csm-decision", 99));
});

test("L5 and unknown trust levels are refused", () => {
  assert.deepEqual(TRUST_LEVELS, ["L0", "L1", "L2", "L3", "L4"]);
  assert.throws(() => assertTrustPromotion({ trustLevel: "L5" }), /refused trust level/);
  assert.throws(() => assertTrustPromotion({ trustLevel: "L9" }), /refused trust level/);
});

test("trust cannot exceed the point's safety ceiling", () => {
  assert.throws(
    () => assertTrustPromotion({ trustLevel: "L4", ceiling: "safety", reversible: true }),
    /exceeds the safety ceiling/,
  );
  assert.throws(
    () => assertTrustPromotion({ trustLevel: "L4", ceiling: "non-safety", reversible: false }),
    /reversible/,
  );
  assert.ok(assertTrustPromotion({ trustLevel: "L4", ceiling: "non-safety", reversible: true }));
});

test("the bare-label pipe exposes only the label", () => {
  assert.equal(
    labelOf({ answer: "retract", confidence: 0.9, providerId: "openrouter" }),
    "retract",
  );
  assert.equal(labelOf(null), null);
});

test("the never-Jev boundary still refuses advisory objects in protected inputs", () => {
  const advisory = { pointId: "p1", answer: "x", confidence: 0.5 };
  assert.equal(guardProtectedInput(advisory).ok, false);
  assert.equal(guardProtectedInput({ finding: "F-001" }).ok, true);
});
