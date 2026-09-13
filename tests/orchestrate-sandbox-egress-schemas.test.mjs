"use strict";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadSchemaRegistry, parseJson } from "../lib/schema-runtime/index.mjs";

const registry = await loadSchemaRegistry();
const policy = parseJson(
  await readFile(
    new URL("../csm-orchestrate/policies/docker-worker-policy.json", import.meta.url),
    "utf8",
  ),
);

test("T007: the checked-in build-shaped sandbox envelope validates", () => {
  const result = registry.validate("csm-orchestrate-docker-worker-policy/1", policy);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(policy.mounts.length, 0);
  assert.equal(policy.limits.memoryBytes >= 1073741824, true);
  assert.equal(policy.limits.pidsLimit >= 512, true);
  assert.equal(policy.session.reapingInit, true);
});

test("T007: the frozen 64MiB/32-pid envelope is rejected", () => {
  const frozen = structuredClone(policy);
  frozen.limits.memoryBytes = 67108864;
  frozen.limits.pidsLimit = 32;
  assert.equal(registry.validate("csm-orchestrate-docker-worker-policy/1", frozen).valid, false);
});

test("T008: an egress event requires a keyed, externally-anchored head", () => {
  const base = {
    schema: "csm-orchestrate-egress-event/1",
    schemaRevision: 1,
    sequence: 0,
    previousHash: `sha256:${"0".repeat(64)}`,
    recordHash: `sha256:${"1".repeat(64)}`,
    runId: "run-egress-1",
    decision: "allowed",
    targetHost: "registry.npmjs.org",
    targetPort: 443,
    timestamp: "2026-09-12T00:00:00.000Z",
  };
  assert.equal(registry.validate("csm-orchestrate-egress-event/1", base).valid, false);
  const anchored = {
    ...base,
    anchor: {
      algorithm: "hmac-sha256",
      keyId: "host-key-1",
      headDigest: `sha256:${"2".repeat(64)}`,
      signedAt: "2026-09-12T00:00:00.000Z",
      external: true,
    },
  };
  assert.equal(registry.validate("csm-orchestrate-egress-event/1", anchored).valid, true);
  const internal = structuredClone(anchored);
  internal.anchor.external = false;
  assert.equal(registry.validate("csm-orchestrate-egress-event/1", internal).valid, false);
});
