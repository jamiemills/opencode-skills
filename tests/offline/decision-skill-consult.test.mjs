"use strict";

// T007: the host-mediated skill consult seam. Advisory-only, redacted before
// send, fail-open, and gated on the existing CSM_DECISION_CLI=1 env gate.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSULT_CLI_GATE_ENV,
  createConsultCli,
  createConsultSeam,
} from "../../csm-orchestrate/lib/decision-adapter/consult.mjs";

function fakeAdapter(advice) {
  const calls = [];
  return {
    calls,
    async decideBatch(pointIds, state) {
      calls.push({ pointIds, state });
      return Object.fromEntries((pointIds ?? []).map((id) => [id, advice?.[id] ?? null]));
    },
  };
}

test("consultPoints returns advisory summaries and marks every advice advisory", async () => {
  const adapter = fakeAdapter({
    "review-challenger-verdict": { answer: "downgrade", confidence: 0.4, providerId: "fake" },
  });
  const seam = createConsultSeam({ adapter, redact: (v) => v });
  const advice = await seam.consultPoints(["review-challenger-verdict"], { claim: "x" });
  assert.equal(advice["review-challenger-verdict"].answer, "downgrade");
  assert.equal(advice["review-challenger-verdict"].advisory, true);
  assert.equal(advice["review-challenger-verdict"].applied, false);
});

test("consultPoints redacts state before it reaches the adapter", async () => {
  const adapter = fakeAdapter({});
  let seen = null;
  const redact = (value) => {
    seen = value;
    return { ...value, token: "[REDACTED]" };
  };
  const seam = createConsultSeam({ adapter, redact });
  await seam.consultPoints(["review-challenger-verdict"], { token: "secret-value", claim: "x" });
  assert.equal(seen.token, "secret-value", "the redactor saw the raw value");
  assert.equal(adapter.calls[0].state.token, "[REDACTED]", "only the redacted value is sent");
  assert.ok(!JSON.stringify(adapter.calls[0].state).includes("secret-value"));
});

test("consultPoints fail-opens to an advice map when the adapter returns nulls", async () => {
  const seam = createConsultSeam({ adapter: fakeAdapter({}), redact: (v) => v });
  const advice = await seam.consultPoints(["a", "b"], {});
  assert.deepEqual(Object.keys(advice).toSorted(), ["a", "b"]);
  assert.equal(advice.a, null);
  assert.equal(advice.b, null);
});

test("the CLI is disabled unless the existing CSM_DECISION_CLI gate is set", async () => {
  const lines = [];
  const cli = createConsultCli({ env: {}, write: (line) => lines.push(line) });
  const record = await cli.run(["review-challenger-verdict"]);
  assert.equal(record.ok, false);
  assert.match(record.reason, /disabled/);
  assert.equal(lines.length, 1);
});

test("the CLI reports missing key without a key and never prints one", async () => {
  const lines = [];
  const cli = createConsultCli({
    env: { [CONSULT_CLI_GATE_ENV]: "1", CSM_DECISION_PROVIDER: "openrouter" },
    repoRoot: "/tmp/does-not-exist-key-resolution",
    write: (line) => lines.push(line),
  });
  const record = await cli.run(["review-challenger-verdict"]);
  assert.equal(record.ok, false);
  assert.equal(record.reason, "provider key not resolvable");
  assert.ok(!lines.join("").includes("OPENROUTER_ROUTER_KEY="));
});
