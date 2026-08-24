"use strict";

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BudgetError,
  LiveModeRefusedError,
  createProposer,
  screenProposals,
} from "../lib/llm/index.mjs";
import { proposalRequest } from "./fixtures/llm-stub.mjs";

test("stub proposer is deterministic, bounded, diverse, redacted, and deduplicated", async () => {
  const proposer = createProposer();
  const first = await proposer.propose(proposalRequest());
  const second = await proposer.propose(proposalRequest());
  assert.deepEqual(first, second);
  assert.equal(first.proposals.length, 5);
  assert.equal(new Set(first.proposals.map((item) => item.family)).size, 5);
  assert.equal(
    first.proposals.every((item) => item.provenance.redacted),
    true,
  );
  assert.equal(first.advisory, true);
});

test("proposal ceiling, screening hooks, and live refusal are fail-closed", async () => {
  await assert.rejects(
    () => createProposer().propose({ ...proposalRequest(), maxProposals: 51 }),
    RangeError,
  );
  const result = screenProposals(
    [
      { id: "ok", content: "x" },
      { id: "bad", content: "x" },
    ],
    [(item) => item.id === "ok" || "policy"],
  );
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected[0].reason, "policy");
  assert.throws(() => createProposer({ mode: "live" }), LiveModeRefusedError);
  await assert.rejects(
    () =>
      createProposer({
        transport: () => {
          throw new Error("retry");
        },
        limits: { maxRetries: 1 },
      }).propose(proposalRequest()),
    /retry/,
  );
  await assert.rejects(
    () => createProposer({ limits: { maxInputBytes: 1 } }).propose(proposalRequest()),
    BudgetError,
  );
});
