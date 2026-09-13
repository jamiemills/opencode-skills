"use strict";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import matrix from "../schemas/compatibility-matrix.json" with { type: "json" };
import { createCompatibilityRuntime } from "../lib/compatibility-runtime/index.mjs";
import { loadSchemaRegistry, parseJson } from "../lib/schema-runtime/index.mjs";
import { ORCHESTRATE_COMPATIBILITY_ADAPTERS } from "../csm-orchestrate/lib/compatibility.mjs";

const registry = await loadSchemaRegistry();
const compatibility = createCompatibilityRuntime({
  schemaRegistry: registry,
  matrix,
  adapters: ORCHESTRATE_COMPATIBILITY_ADAPTERS,
});
const v2 = parseJson(
  await readFile(
    new URL("../csm-orchestrate/policies/docker-worker-policy.json", import.meta.url),
    "utf8",
  ),
);

// T005 aligned the checked-in instance to /2; derive the frozen /1 form from it.
const v1 = {
  ...v2,
  schema: "csm-orchestrate-docker-worker-policy/1",
  schemaRevision: 1,
};
delete v1.dropCapture;

test("T008: the additive /2 policy accepts an optional dropCapture block", () => {
  assert.equal(registry.validate("csm-orchestrate-docker-worker-policy/1", v1).valid, true);
  assert.equal(registry.validate("csm-orchestrate-docker-worker-policy/2", v2).valid, true);
  const withoutDropCapture = structuredClone(v2);
  delete withoutDropCapture.dropCapture;
  assert.equal(
    registry.validate("csm-orchestrate-docker-worker-policy/2", withoutDropCapture).valid,
    true,
  );
  const required = structuredClone(v2);
  required.dropCapture.required = true;
  assert.equal(registry.validate("csm-orchestrate-docker-worker-policy/2", required).valid, true);
});

test("T008: /2 rejects unknown top-level and unknown dropCapture fields", () => {
  const unknownTopLevel = structuredClone(v2);
  unknownTopLevel.unexpected = true;
  assert.equal(
    registry.validate("csm-orchestrate-docker-worker-policy/2", unknownTopLevel).valid,
    false,
  );
  const unknownNested = structuredClone(v2);
  unknownNested.dropCapture.unexpected = true;
  assert.equal(
    registry.validate("csm-orchestrate-docker-worker-policy/2", unknownNested).valid,
    false,
  );
  const wrongType = structuredClone(v2);
  wrongType.dropCapture.required = "yes";
  assert.equal(registry.validate("csm-orchestrate-docker-worker-policy/2", wrongType).valid, false);
});

test("T008: frozen /1 stays registered and rejects the additive field", () => {
  assert.equal(registry.resolve("csm-orchestrate-docker-worker-policy", 1).id.endsWith("/1"), true);
  assert.equal(registry.resolve("csm-orchestrate-docker-worker-policy", 2).id.endsWith("/2"), true);
  const v1WithDropCapture = { ...v1, dropCapture: { required: false } };
  assert.equal(
    registry.validate("csm-orchestrate-docker-worker-policy/1", v1WithDropCapture).valid,
    false,
  );
});

test("T008: the additive pair 1->2 negotiates directly and 1->1 is unchanged", () => {
  const pair = compatibility.negotiate("csm-orchestrate-docker-worker-policy", 1, 2);
  assert.equal(pair.mode, "direct");
  assert.equal(pair.status, "compatible");
  assert.equal(pair.adapter, null);
  assert.equal(
    compatibility.negotiate("csm-orchestrate-docker-worker-policy", 1, 1).mode,
    "direct",
  );
});
