"use strict";

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hash } from "../lib/ledger/index.mjs";
import { optimize, evaluateHardGates, targetPassed } from "../lib/optimizer/index.mjs";
import { candidates, evaluate, validate } from "./fixtures/synthetic-optimizer.mjs";

const contract = (runId = "synthetic-run") => ({
  runId,
  source: { mode: "registered", id: "synthetic", sourceHash: "sha256:" + "1".repeat(64) },
  metric: { name: "loss", unit: "points", direction: "minimize", aggregation: "mean" },
  budget: { maxTrials: 3, maxProposals: 10, timeoutMs: 1000 },
  policy: {
    format: "csm-autoresearch-policy/1",
    mode: "hill-climb",
    hardGates: [
      { id: "valid", kind: "valid" },
      { id: "build", kind: "build" },
    ],
    population: { enabled: false, activateAfterStagnantTrials: 2, maxArchive: 2 },
    execution: {
      network: "disabled",
      credentials: "none",
      evaluatorAssets: "isolated",
      isolation: "trusted-in-process",
    },
  },
});
const policy = {
  format: "csm-autoresearch-policy/1",
  mode: "hill-climb",
  hardGates: [
    { id: "valid", kind: "valid" },
    { id: "build", kind: "build" },
  ],
  population: { enabled: false, activateAfterStagnantTrials: 2, maxArchive: 2 },
  execution: {
    network: "disabled",
    credentials: "none",
    evaluatorAssets: "isolated",
    isolation: "trusted-in-process",
  },
};

test("synthetic hill climb establishes baseline and keeps only a materially better gated candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-optimizer-"));
  const result = await optimize({
    contract: contract(),
    policy,
    ledgerRoot: root,
    evaluate,
    validate,
    candidates,
    baseline: { id: "baseline", value: 5 },
    margin: 0.5,
  });
  assert.equal(result.report.baseline.status, "ok");
  assert.equal(result.report.trials[0].decision, "keep");
  assert.equal(result.report.trials[1].decision, "keep");
  assert.equal(result.report.trials[2].decision, "quarantine");
  assert.equal(result.incumbent.id, "candidate-best");
  assert.match(await readFile(result.paths.report, "utf8"), /csm-autoresearch-report/);
});

test("target mode and deterministic hard gates are fail-closed", async () => {
  assert.equal(targetPassed(2, { operator: "<=", value: 2 }), true);
  assert.deepEqual(
    evaluateHardGates({ status: "timed_out", valid: true }, [{ id: "valid", kind: "valid" }]),
    { passed: false, failed: ["valid"] },
  );
  const root = await mkdtemp(join(tmpdir(), "csm-optimizer-"));
  const targetPolicy = { ...policy, mode: "target", target: { operator: "<=", value: 1 } };
  const result = await optimize({
    contract: {
      ...contract("target-run"),
      budget: { maxTrials: 1, maxProposals: 1, timeoutMs: 1000 },
      policy: targetPolicy,
    },
    policy: targetPolicy,
    ledgerRoot: root,
    evaluate,
    candidates: [{ id: "candidate", value: 1 }],
    baseline: { id: "baseline", value: 5 },
  });
  assert.equal(result.report.status, "completed");
});

test("hidden validation is required, finite, and represented in gate diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-optimizer-"));
  const hiddenPolicy = {
    ...policy,
    hardGates: [
      { id: "valid", kind: "valid" },
      { id: "hidden", kind: "hidden-validation" },
    ],
  };
  const result = await optimize({
    contract: { ...contract("hidden-run"), policy: hiddenPolicy },
    policy: hiddenPolicy,
    ledgerRoot: root,
    evaluate: async () => ({
      status: "ok",
      valid: true,
      metrics: { loss: 1 },
      gates: { build: true },
    }),
    validate: async () => ({ status: "ok", valid: true, metrics: { loss: Number.NaN } }),
    candidates: [{ id: "candidate", value: 1 }],
    baseline: { id: "baseline", value: 5 },
  });
  assert.equal(result.report.trials[0].decision, "reject");
  assert.deepEqual(result.report.trials[0].diagnostics, ["hidden"]);
});

test("resume reconstructs the prior incumbent and trial count", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-optimizer-"));
  const options = {
    contract: contract("resume-run"),
    policy,
    ledgerRoot: root,
    evaluate,
    validate,
    candidates: [candidates[0]],
    baseline: { id: "baseline", value: 5 },
  };
  const first = await optimize(options);
  const second = await optimize({ ...options, candidates: [candidates[0], candidates[1]] });
  assert.equal(first.incumbent.id, "candidate-low");
  assert.equal(second.incumbent.id, "candidate-best");
  assert.equal(second.report.trials.filter((trial) => trial.decision === "keep").length, 2);
});

test("sandbox and policy failures are terminal blocked runs, not evaluated trials", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-optimizer-"));
  let calls = 0;
  const options = {
    contract: contract("blocked-run"),
    policy,
    ledgerRoot: root,
    candidates: [{ id: "candidate", value: 1 }],
    baseline: { id: "baseline", value: 5 },
    evaluate: async (candidate) => {
      calls++;
      return candidate.id === "baseline"
        ? { status: "ok", valid: true, metrics: { loss: 5 } }
        : {
            status: "sandbox_unavailable",
            valid: false,
            metrics: {},
            diagnostics: ["sandbox unavailable"],
          };
    },
  };
  const first = await optimize(options);
  assert.equal(first.report.status, "blocked");
  assert.equal(first.report.trials.at(-1).decision, "blocked");
  assert.equal(first.report.trials.at(-1).status, "sandbox_unavailable");
  assert.equal(first.incumbent, null);
  assert.match(await readFile(first.paths.ledger, "utf8"), /"event":"blocked"/);
  const callsAfterFirstRun = calls;
  const second = await optimize(options);
  assert.equal(second.report.status, "blocked");
  assert.equal(calls, callsAfterFirstRun);
});

test("resume refuses changed evaluator, environment, or policy provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-optimizer-provenance-"));
  const options = {
    contract: contract("provenance-run"),
    policy,
    ledgerRoot: root,
    evaluate,
    candidates: [],
    baseline: { id: "baseline", value: 5 },
  };
  await optimize(options);
  await assert.rejects(
    () => optimize({ ...options, evaluatorHash: "sha256:" + "2".repeat(64) }),
    /resume provenance mismatch: evaluatorHash/,
  );
});

test("contract policy is the execution policy and equivalent policies are canonicalized", async () => {
  const equivalentPolicy = JSON.parse(
    await readFile(new URL("./fixtures/policy-equivalent.json", import.meta.url), "utf8"),
  );
  assert.equal(hash(equivalentPolicy), hash(contract().policy));
  const root = await mkdtemp(join(tmpdir(), "csm-optimizer-policy-equivalent-"));
  let calls = 0;
  const result = await optimize({
    contract: contract("equivalent-policy-run"),
    policy: equivalentPolicy,
    ledgerRoot: root,
    baseline: { id: "baseline", value: 5 },
    candidates: [],
    evaluate: async (candidate) => {
      calls++;
      return { status: "ok", valid: true, metrics: { loss: candidate.value } };
    },
  });
  assert.equal(result.report.status, "stopped");
  assert.equal(calls, 1);
});

test("mismatched execution policy refuses before evaluator execution", async () => {
  const mismatchedPolicy = JSON.parse(
    await readFile(new URL("./fixtures/policy-mismatch.json", import.meta.url), "utf8"),
  );
  const root = await mkdtemp(join(tmpdir(), "csm-optimizer-policy-mismatch-"));
  let calls = 0;
  await assert.rejects(
    () =>
      optimize({
        contract: contract("mismatched-policy-run"),
        policy: mismatchedPolicy,
        ledgerRoot: root,
        baseline: { id: "baseline", value: 5 },
        candidates: [{ id: "candidate", value: 1 }],
        evaluate: async () => {
          calls++;
          return { status: "ok", valid: true, metrics: { loss: 1 } };
        },
      }),
    /execution policy mismatch/,
  );
  assert.equal(calls, 0);
});
