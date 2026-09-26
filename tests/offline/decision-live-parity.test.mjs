import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { createDecisionTransport } from "../../csm-orchestrate/lib/decision-adapter/transport.mjs";
import openrouter from "../../csm-orchestrate/lib/decision-adapter/providers/openrouter.mjs";
import { resolveApiKey } from "../../csm-orchestrate/lib/decision-adapter/key-resolution.mjs";
import { buildQuestions } from "../../csm-orchestrate/lib/decision-adapter/question-protocol.mjs";
import { listDecisionPoints } from "../../csm-orchestrate/lib/decision-adapter/points.mjs";

// A live PARITY probe: build the FULL shipped question record, send it through
// the real provider descriptor, and assert the live API accepts the shape and
// answers every question. Off by default; opt in with CSM_DECISION_LIVE_PARITY=1
// AND a resolvable key. A 4xx contract error fails hard; a retryable 429/5xx
// outage is inconclusive and skips after bounded retries.
const OPT_IN = process.env.CSM_DECISION_LIVE_PARITY === "1";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const resolved = OPT_IN
  ? await resolveApiKey({ apiKeyEnv: openrouter.apiKeyEnv, repoRoot: REPO_ROOT })
  : { key: null, source: "missing" };

async function sendWithRetry(transport, input, attempts = 3) {
  let last;
  for (let index = 0; index < attempts; index += 1) {
    last = await transport.send(input);
    if (last.ok || !last.failure?.retryable) return last;
    await new Promise((resolve) => setTimeout(resolve, 250 * (index + 1)));
  }
  return last;
}

const runLive = (t, transport, input) => {
  assert.ok(t);
  return sendWithRetry(transport, input);
};

test(
  "the full shipped question record is accepted by the live API (parity)",
  { skip: !OPT_IN },
  async (t) => {
    assert.ok(
      resolved.key,
      `CSM_DECISION_LIVE_PARITY=1 but no ${openrouter.apiKeyEnv} key resolved`,
    );
    const env = { ...process.env, [openrouter.apiKeyEnv]: resolved.key };
    const transport = createDecisionTransport({ provider: openrouter, env });
    const points = listDecisionPoints();
    const questions = buildQuestions(points);
    assert.equal(Array.isArray(questions), false, "questions must be a record");

    const result = await runLive(t, transport, { questions, state: "live parity probe" });
    if (!result.ok && result.failure?.retryable) {
      t.skip(`live provider unavailable (${result.failure.class}); inconclusive`);
      return;
    }
    assert.equal(
      result.ok,
      true,
      `live provider rejected the shipped record: ${JSON.stringify(result.failure ?? {})}`,
    );
    const answers = result.decision?.answers ?? {};
    for (const point of points) {
      assert.ok(Object.hasOwn(answers, point.id), `live API returned no answer for ${point.id}`);
    }
  },
);

test("a null state is substituted and accepted by the live API", { skip: !OPT_IN }, async (t) => {
  assert.ok(resolved.key, `CSM_DECISION_LIVE_PARITY=1 but no ${openrouter.apiKeyEnv} key resolved`);
  const env = { ...process.env, [openrouter.apiKeyEnv]: resolved.key };
  const transport = createDecisionTransport({ provider: openrouter, env });
  const questions = buildQuestions([
    listDecisionPoints().find((point) => point.id === "review-challenger-verdict"),
  ]);
  const result = await runLive(t, transport, { questions, state: null });
  if (!result.ok && result.failure?.retryable) {
    t.skip(`live provider unavailable (${result.failure.class}); inconclusive`);
    return;
  }
  assert.equal(
    result.ok,
    true,
    `a null state must be substituted, not rejected: ${JSON.stringify(result.failure ?? {})}`,
  );
});
