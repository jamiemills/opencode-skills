"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../../lib/schema-runtime/index.mjs";
import {
  REDACTED_VALUE,
  createTelemetryEmitter,
  redactSecretValues,
} from "../../csm-orchestrate/lib/telemetry.mjs";

const RUN_ID = "run-worker-redaction-1";
const CONFIG_DIGEST = digest({ config: "redaction" });

test("redactSecretValues masks secret-shaped substrings but keeps host identity", () => {
  const result = redactSecretValues({
    command: "curl -H 'Authorization: Bearer sk-abcdefghijklmnop1234' https://registry.npmjs.org",
    targetHost: "registry.npmjs.org",
    targetOrigin: "https://registry.npmjs.org",
    note: "api_key=super-secret-value",
  });
  assert.equal(result.command.includes("sk-abcdefghijklmnop1234"), false);
  assert.equal(result.command.includes("Bearer"), false);
  assert.equal(result.note.includes("super-secret-value"), false);
  assert.equal(result.targetHost, "registry.npmjs.org");
  assert.equal(result.targetOrigin, "https://registry.npmjs.org");
});

test("v2 worker event payloads are value-scrubbed while egress targets survive", () => {
  const source = createTelemetryEmitter({ runId: RUN_ID, effectiveConfigDigest: CONFIG_DIGEST });
  const event = source.emit({
    eventType: "egress.decision",
    workerId: "worker-build-1",
    payload: {
      decision: "allowed",
      targetHost: "registry.npmjs.org",
      credentialRef: "credref-npm-token",
      command: "AUTHORIZATION: Bearer abc123def456ghi789",
    },
  });
  assert.equal(event.payload.targetHost, "registry.npmjs.org");
  assert.equal(event.payload.credentialRef, "credref-npm-token");
  assert.equal(event.payload.command.includes("abc123def456ghi789"), false);
  assert.equal(event.payload.command.includes("Bearer"), false);
});

test("loss-marker messages are scrubbed of secret-shaped values", async () => {
  const writes = [];
  const transport = {
    write(event) {
      if (event.eventType === "dispatch") {
        return Promise.reject(
          Object.assign(new Error("write failed: Authorization: Bearer leakme123456"), {
            code: "telemetry-write-failed",
          }),
        );
      }
      writes.push(event);
      return undefined;
    },
    list() {
      return writes.slice();
    },
  };
  const source = createTelemetryEmitter({
    runId: RUN_ID,
    effectiveConfigDigest: CONFIG_DIGEST,
    transport,
  });
  source.emit({ eventType: "dispatch", childRunId: "run-child-1" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const marker = writes.find((event) => event.eventType === "telemetry_loss");
  assert.ok(marker, "a loss marker should be written");
  assert.equal(marker.payload.message.includes("leakme123456"), false);
  assert.equal(marker.payload.message.includes("Bearer"), false);
  const [record] = source.getLossRecords();
  assert.equal(record.message.includes("leakme123456"), false);
  assert.ok(marker.payload.message.length <= 300);
  void REDACTED_VALUE;
});
