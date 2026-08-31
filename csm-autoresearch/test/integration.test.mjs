"use strict";

import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createJudge } from "../lib/llm/index.mjs";
import { optimize, evaluateHardGates } from "../lib/optimizer/index.mjs";
import { promote, rollback } from "../lib/population/index.mjs";
import {
  createGeneratedProvider,
  createHostSandboxCapability,
  hash as generatedHash,
  probeSandbox,
} from "../lib/providers/generated.mjs";
import { createRegisteredProvider } from "../lib/providers/registered.mjs";
import { parseLine } from "../lib/protocol/index.mjs";
import { executeCandidate } from "../lib/runtime/index.mjs";
import { contract, policy, request, sourceHash } from "./fixtures/integration/candidates.mjs";

const digest = (value) => `sha256:${value.repeat(64)}`;
const approval = { status: "approved", approver: "integration-test", reason: "synthetic fixture" };
const cleanupToken = Symbol("integration-cleanup");
const hostCapability = createHostSandboxCapability({
  attest: ({ provider, limits, network, mounts, evaluatorAssets, credentials }) => ({
    provider,
    limits: Object.keys(limits),
    network,
    mounts,
    evaluatorAssets,
    credentials,
    networkIsolation: true,
    mountIsolation: true,
    credentialIsolation: true,
    resourceLimits: true,
    processContainment: true,
    descendantContainment: true,
    sourceHashBinding: true,
    cleanupVerification: true,
  }),
  verifyLimits: (evidence, limits) =>
    Object.keys(limits).every((key) => evidence.limits.includes(key)),
  verifyCleanup: (result) => result.cleanup?.token === cleanupToken,
});

test("protocol request crosses provider/runtime and receives a deterministic hard-gate decision", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-integration-runtime-"));
  const provider = createRegisteredProvider({
    registry: {
      integration: {
        sourceHash,
        callable: async ({ value }) => {
          const workspace = root;
          const result = await executeCandidate({
            command: process.execPath,
            args: ["-e", `process.stdout.write(JSON.stringify({score:${value}}))`],
            cwd: root,
            workspace,
            timeoutMs: 1000,
            maxOutputBytes: 1000,
          });
          return result.status === "ok" ? JSON.parse(result.stdout) : { score: -1 };
        },
      },
    },
    evaluatorHash: digest("a"),
    environmentHash: digest("b"),
    limits: request({ id: "x" }, 1).limits,
    approval,
  });
  const result = {
    ...(await provider.evaluate(request({ id: "integration" }, 7))),
    gates: { build: true },
  };
  assert.equal(result.status, "ok");
  assert.deepEqual(result.metrics, { score: 7 });
  assert.deepEqual(evaluateHardGates(result, policy.hardGates), { passed: true, failed: [] });
  await assert.rejects(access(root), /ENOENT/);
});

test("optimizer hard failure remains authoritative over an advisory judge", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-integration-ledger-"));
  const judge = createJudge();
  const advisory = await judge.judge({
    id: "advisory",
    candidates: [{ content: "safe" }, { content: "unsafe" }],
  });
  assert.equal(advisory.advisory, true);
  const result = await optimize({
    contract: { ...contract, runId: "hard-failure-run" },
    ledgerRoot: root,
    policy,
    baseline: { id: "baseline", parentId: null, value: 1 },
    evaluate: async (candidate) => ({
      status: "ok",
      valid: true,
      metrics: { score: candidate.value },
      gates: { build: candidate.id !== "failed-gate" },
    }),
    candidates: [{ id: "failed-gate", parentId: "baseline", value: 100 }],
  });
  assert.equal(result.report.trials[0].decision, "reject");
  assert.deepEqual(result.report.trials[0].diagnostics, ["build"]);
  assert.notEqual(result.incumbent.id, "failed-gate");
});

test("host-attested generated candidates run while the required default probe stays fail-closed", async () => {
  const source = "export default () => ({ score: 1 })";
  let observed;
  const sandbox = {
    name: "synthetic",
    capability: hostCapability,
    execute: async (input) => {
      observed = input;
      return {
        status: "ok",
        metrics: { score: 1 },
        cleanup: { token: cleanupToken },
        attestation: {
          status: "verified",
          provider: "synthetic",
          network: "disabled",
          mounts: [],
          evaluatorAssets: "isolated",
          credentials: "none",
          policyDigest: generatedHash("synthetic-policy"),
          imageDigest: generatedHash("synthetic-image"),
          sourceHash: generatedHash(source),
          controls: {
            networkIsolation: true,
            mountIsolation: true,
            credentialIsolation: true,
            resourceLimits: true,
            processContainment: true,
            descendantContainment: true,
            sourceHashBinding: true,
            cleanupVerification: true,
          },
          limits: ["timeoutMs", "maxOutputBytes", "maxWorkspaceBytes"],
        },
      };
    },
  };
  const provider = createGeneratedProvider({
    sandbox,
    hostCapability,
    evaluatorHash: generatedHash("evaluator"),
    environmentHash: generatedHash("environment"),
    limits: { timeoutMs: 1000, maxOutputBytes: 1000, maxWorkspaceBytes: 1000 },
    approval,
    sandboxProvider: "synthetic",
  });
  const result = await provider.evaluate({
    ...request({ id: "generated" }, 1),
    candidate: { ...request({ id: "generated" }, 1).candidate, sourceHash: generatedHash(source) },
    input: { source, value: 1 },
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.metrics, { score: 1 });
  assert.equal(observed.policy.network, "disabled");
  assert.deepEqual(observed.policy.mounts, []);
  const probe = probeSandbox();
  assert.equal(probe.status, "sandbox_unavailable");
  assert.equal(probe.verified, false);
});

test("malformed, oversized, timed-out, and resource-exhausted candidates fail closed and clean up", async () => {
  assert.throws(() => parseLine("{" + "x".repeat(1024 * 1024) + "}"), /exceeds byte limit/);
  const timeoutRoot = await mkdtemp(join(tmpdir(), "csm-integration-timeout-"));
  const timedOut = await executeCandidate({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 1000)"],
    cwd: timeoutRoot,
    workspace: timeoutRoot,
    timeoutMs: 20,
    maxOutputBytes: 1000,
  });
  assert.equal(timedOut.status, "timed_out");
  assert.equal(timedOut.cleanup.cleaned, true);
  const outputRoot = await mkdtemp(join(tmpdir(), "csm-integration-output-"));
  const exhausted = await executeCandidate({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(10000))"],
    cwd: outputRoot,
    workspace: outputRoot,
    timeoutMs: 1000,
    maxOutputBytes: 10,
  });
  assert.equal(exhausted.status, "resource_exhausted");
  assert.equal(exhausted.cleanup.cleaned, true);
});

test("redacted report, manifest, and ledger retain verifiable artifact linkage", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-integration-artifacts-"));
  const result = await optimize({
    contract: {
      ...contract,
      runId: "artifact-run",
      policy: { ...policy, hardGates: [{ id: "valid", kind: "valid" }] },
    },
    ledgerRoot: root,
    baseline: { id: "baseline", value: 1 },
    candidates: [],
    evaluate: async (candidate) => ({
      status: "ok",
      valid: true,
      metrics: { score: candidate.value },
    }),
  });
  const manifest = JSON.parse(await readFile(result.paths.manifest, "utf8"));
  const report = JSON.parse(await readFile(result.paths.report, "utf8"));
  const ledger = await readFile(result.paths.ledger, "utf8");
  assert.equal(manifest.redacted, true);
  assert.equal(manifest.runId, report.runId);
  assert.equal(manifest.report, result.paths.report.replace(/^\//, ""));
  assert.equal(report.artifactRefs.includes(manifest.ledger), true);
  assert.match(ledger, /"redacted":true/);
  assert.equal(JSON.stringify({ manifest, report }).includes(root), false);
});

test("accepted candidate promotes and rolls back by exact identity", async () => {
  const candidate = {
    id: "promoted",
    parentId: "baseline",
    metrics: { score: 2 },
    hardGatesPassed: true,
    contentHash: digest("c"),
  };
  let state = "baseline";
  const promotion = await promote({
    candidate,
    approval: { approved: true, candidateId: candidate.id },
    read: () => state,
    apply: () => {
      state = "promoted";
    },
    validate: async () => true,
  });
  assert.equal(state, "promoted");
  const result = await rollback({
    promotion,
    candidate,
    restore: (previous) => {
      state = previous;
    },
  });
  assert.equal(result.decision, "rollback");
  assert.equal(state, "baseline");
});
