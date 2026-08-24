"use strict";

import { hash } from "../../../lib/providers/registered.mjs";

const sourceHash = hash("integration-registered-source");
const patchHash = hash("integration-patch");

function request(candidate, value) {
  return {
    format: "csm-autoresearch-evaluator-request/1",
    requestId: `request-${candidate.id}`,
    runId: "integration-run",
    candidate: { id: candidate.id, parentId: candidate.parentId ?? null, sourceHash, patchHash },
    limits: { timeoutMs: 1000, maxOutputBytes: 10000, network: "disabled" },
    input: { value },
  };
}

const contract = {
  runId: "integration-run",
  source: { mode: "registered", id: "integration", sourceHash },
  metric: { name: "score", unit: "points", direction: "maximize", aggregation: "mean" },
  budget: { maxTrials: 3, maxProposals: 3, timeoutMs: 1000 },
  policy: "integration",
};

const policy = {
  mode: "hill-climb",
  hardGates: [
    { id: "valid", kind: "valid" },
    { id: "build", kind: "build" },
  ],
  population: { enabled: true, activateAfterStagnantTrials: 2, maxArchive: 3 },
};

export { contract, patchHash, policy, request, sourceHash };
